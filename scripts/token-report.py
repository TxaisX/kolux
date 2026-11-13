#!/usr/bin/env python3
"""Local token and spend audit for the Kolux project.

Reads the local agent transcripts, dedupes API messages, prices them at current
list rates, and (with --write) updates docs/history/token-usage-ledger.md.

This is a local audit tool, not part of the app build. It does not call any
network service.

Sources:
  - OpenCode: <opencode data>/opencode.db, table session_v2
  - Claude Code: ~/.claude/projects/**/*.jsonl
  - Codex: ~/.codex/sessions/**/*.jsonl

The scope is deliberately explicit:
  - any Claude/OpenCode working directory containing "kolux"
  - the Txais Brain Claude sessions listed in TX_KOLUX_SESSIONS
  - the Txais Brain OpenCode sessions whose title or first prompt is Kolux work

If a new Txais Brain session is clearly Kolux work, add its 8-character
session id to TX_KOLUX_SESSIONS so the next report includes it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

HOME = Path.home()
DEFAULT_CLAUDE = HOME / ".claude" / "projects"
DEFAULT_CODEX = HOME / ".codex" / "sessions"
DEFAULT_OPENCODE = Path(
    os.environ.get("OPENCODE_DB", r"G:\Dev\AI\.local\share\opencode\opencode.db")
)
LEDGER = Path(__file__).resolve().parent.parent / "docs" / "history" / "token-usage-ledger.md"

TX_PROJECT = "G--Dev-Projects-Txais-Brain"
TX_KOLUX_SESSIONS = {
    "6d0018f4",  # build remaining tasks / "what is left in this build now?"
    "d134e328",  # Opus orchestrator routing for Kolux
    "4845f59c",  # continued build session
    "9da075e7",  # build coordinator cross-session
    "c03d3fa2",  # kolux-pane-memory-merge
    "63a401df",  # Kolux crash report 0.1.0 + workspace UI work
    "f5418839",  # reclaim old Kolux / install Kolux
    "8ac2ad36",  # Kolux crash report 0.1.1
    "c508234f",  # Kolux install status
    "e7eca09a",  # kolux rx cmd popup fix
    "4216ba16",  # Kolux error log triage
}

# Titles that are Kolux work but do not contain the word "kolux" in the title
# or first prompt.
OC_EXTRA_TITLES = {
    "Workspace cost and token usage",
    "Artifacts button accessibility",
}

# $/MTok: input, output, cache_read, cache_write_5m, cache_write_1h
CLAUDE_PRICE = {
    "claude-opus-5-5": (4.0, 20.0, 0.20, 5.0, 8.0),
    "claude-sonnet-5-5": (2.0, 10.0, 0.10, 2.5, 4.0),
    "claude-haiku-5-5": (0.1, 0.5, 0.01, 0.125, 0.2),
    "claude-haiku-4-5-20251001": (1.0, 5.0, 0.10, 1.25, 2.0),
}

# $/MTok: input, output, cache_read, cache_write
CODEX_PRICE = {
    "gpt-6-sol": (2.0, 10.0, 0.2, 2.5),
    "gpt-6.1-sol": (2.0, 10.0, 0.1, 2.5),
    "gpt-5.6-sol": (5.0, 30.0, 0.5, 6.25),
}


def claude_price(model: str):
    m = (model or "").lower()
    if "opus" in m:
        return CLAUDE_PRICE["claude-opus-5-5"]
    if "haiku-4-5" in m:
        return CLAUDE_PRICE["claude-haiku-4-5-20251001"]
    if "haiku" in m:
        return CLAUDE_PRICE["claude-haiku-5-5"]
    if "sonnet" in m:
        return CLAUDE_PRICE["claude-sonnet-5-5"]
    return None


def codex_price(model: str):
    return CODEX_PRICE.get(model or "", (2.0, 10.0, 0.2, 2.5))


def fmt_tokens(n: float) -> str:
    n = float(n)
    if n >= 1e9:
        return f"{n / 1e9:.2f}B"
    if n >= 1e6:
        return f"{n / 1e6:.1f}M"
    if n >= 1e3:
        return f"{n / 1e3:.1f}K"
    return f"{int(n)}"


def fmt_money(n: float) -> str:
    return f"${n:,.2f}"


def claude_location(project: str) -> str:
    if project == "G--Dev-Kolux-kolux":
        return "Old Electron Kolux"
    if "dusky-marlin" in project:
        return "dusky-marlin worktree"
    if "hazel-nautilus" in project:
        return "hazel-nautilus worktree"
    if "capricorn" in project:
        return "capricorn worktree"
    if "velvet-ray" in project:
        return "velvet-ray worktree"
    if "kolux-writer" in project:
        return "temp writer dirs"
    # The developer's folder is G:\Dev\kolux-rs today and will become G:\Dev\kolux; accept both Claude project folders.
    if project in ("G--Dev-kolux-rs", "G--Dev-kolux"):
        return "kolux direct"
    if project == TX_PROJECT:
        return "Txais Brain orchestration"
    return project


def text_from_claude_message(obj: dict) -> str:
    msg = obj.get("message") or {}
    content = msg.get("content")
    out = []
    if isinstance(content, str):
        out.append(content)
    elif isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                out.append(part.get("text") or "")
    return "\n".join(out)


def scan_claude(root: Path):
    rows = []
    seen = set()
    if not root.exists():
        return rows

    for project_dir in sorted(root.iterdir()):
        if not project_dir.is_dir():
            continue
        project = project_dir.name
        is_kolux = "kolux" in project.lower()
        if not is_kolux and project != TX_PROJECT:
            continue

        paths = []
        if project == TX_PROJECT:
            for sid in TX_KOLUX_SESSIONS:
                paths.extend(project_dir.glob(f"{sid}*.jsonl"))
                paths.extend(project_dir.glob(f"{sid}*/**/*.jsonl"))
        else:
            paths = list(project_dir.rglob("*.jsonl"))

        for path in paths:
            rel = path.relative_to(project_dir)
            parts = rel.parts
            sid = parts[0].removesuffix(".jsonl") if parts else "?"
            try:
                fh = path.open(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            with fh:
                for line in fh:
                    if '"usage"' not in line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    msg = obj.get("message") or {}
                    usage = msg.get("usage")
                    if not usage:
                        continue
                    price = claude_price(msg.get("model"))
                    if not price:
                        continue
                    mid = msg.get("id") or ""
                    rid = obj.get("requestId") or ""
                    if mid and rid:
                        key = (mid, rid)
                    else:
                        key = (
                            str(path),
                            obj.get("timestamp"),
                            msg.get("model"),
                            hashlib.md5(
                                json.dumps(usage, sort_keys=True).encode()
                            ).hexdigest(),
                        )
                    if key in seen:
                        continue
                    seen.add(key)
                    ts = obj.get("timestamp")
                    if not ts:
                        continue
                    inp = usage.get("input_tokens", 0) or 0
                    out = usage.get("output_tokens", 0) or 0
                    cr = usage.get("cache_read_input_tokens", 0) or 0
                    cc = usage.get("cache_creation") or {}
                    w5 = cc.get("ephemeral_5m_input_tokens", 0) or 0
                    w1 = cc.get("ephemeral_1h_input_tokens", 0) or 0
                    if not cc:
                        w5 = usage.get("cache_creation_input_tokens", 0) or 0
                    cw = w5 + w1
                    i, o, r, cw5p, cw1p = price
                    cost = (
                        inp * i + out * o + cr * r + w5 * cw5p + w1 * cw1p
                    ) / 1e6
                    rows.append(
                        {
                            "source": "Claude Code",
                            "location": claude_location(project),
                            "sid": sid,
                            "t": ts,
                            "model": msg.get("model"),
                            "inp": inp,
                            "out": out,
                            "cr": cr,
                            "cw": cw,
                            "rea": 0,
                            "cost": cost,
                        }
                    )
    return rows


def scan_codex(root: Path):
    rows = []
    seen = set()
    if not root.exists():
        return rows
    for path in root.rglob("*.jsonl"):
        try:
            with path.open(encoding="utf-8", errors="ignore") as fh:
                first = fh.readline()
            meta = json.loads(first)
        except Exception:
            continue
        payload = meta.get("payload") or {}
        cwd = payload.get("cwd") or ""
        if "kolux" not in cwd.lower():
            continue
        sid = payload.get("id") or path.stem
        if "capricorn" in cwd.lower():
            location = "capricorn worktree"
        elif "coral-manta" in cwd.lower():
            location = "coral-manta worktree"
        else:
            location = Path(cwd).name or "Codex"

        turn_model = {}
        records = []
        try:
            with path.open(encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    typ = obj.get("type")
                    data = obj.get("payload") or {}
                    if typ == "turn_context":
                        tid = data.get("turn_id")
                        if tid:
                            turn_model[tid] = data.get("model")
                    elif typ == "token_usage_record":
                        usage = data.get("usage") or {}
                        rid = data.get("response_id") or ""
                        tid = data.get("turn_id") or ""
                        if rid and rid not in seen:
                            seen.add(rid)
                            records.append((rid, tid, usage, obj.get("timestamp")))
        except OSError:
            continue

        for rid, tid, usage, ts in records:
            model = turn_model.get(tid)
            i, o, cr, cwp = codex_price(model)
            inp = usage.get("input_tokens", 0) or 0
            cached = usage.get("cached_input_tokens", 0) or 0
            cw = usage.get("cache_write_input_tokens", 0) or 0
            out = usage.get("output_tokens", 0) or 0
            reasoning = usage.get("reasoning_output_tokens", 0) or 0
            uncached = max(inp - cached - cw, 0)
            cost = (uncached * i + cached * cr + cw * cwp + out * o) / 1e6
            rows.append(
                {
                    "source": "Codex",
                    "location": location,
                    "sid": sid,
                    "t": ts or "",
                    "model": model,
                    "inp": inp,
                    "out": out,
                    "cr": cached,
                    "cw": cw,
                    "rea": reasoning,
                    "cost": cost,
                }
            )
    return rows


def scan_opencode(db: Path):
    rows = []
    if not db.exists():
        return rows
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    sessions = cur.execute("select * from session_v2").fetchall()

    core = [s for s in sessions if "kolux" in (s["directory"] or "").lower()]
    core_ids = {s["id"] for s in core}

    adjacent_ids = set()
    for s in sessions:
        if s["parent_id"] is not None:
            continue
        if "kolux" in (s["directory"] or "").lower():
            continue
        title = (s["title"] or "").strip()
        first = ""
        msg = cur.execute(
            "select data from session_message where session_id=? and type='user' order by seq limit 1",
            (s["id"],),
        ).fetchone()
        if msg:
            try:
                first = (json.loads(msg["data"]).get("text") or "").strip()
            except Exception:
                pass
        if title in OC_EXTRA_TITLES or "kolux" in (title + "\n" + first).lower():
            adjacent_ids.add(s["id"])

    # include descendants of adjacent top-level sessions
    for sid in list(adjacent_ids):
        stack = [sid]
        while stack:
            parent = stack.pop()
            for child in cur.execute(
                "select id from session_v2 where parent_id=?", (parent,)
            ).fetchall():
                if child["id"] not in adjacent_ids:
                    adjacent_ids.add(child["id"])
                    stack.append(child["id"])

    selected = [s for s in sessions if s["id"] in core_ids or s["id"] in adjacent_ids]
    for s in selected:
        directory = s["directory"] or ""
        if "dusky-marlin" in directory:
            location = "dusky-marlin worktree"
        elif "hazel-nautilus" in directory:
            location = "hazel-nautilus worktree"
        elif "capricorn" in directory:
            location = "capricorn worktree"
        elif directory.lower().replace("\\", "/").endswith(("g:/dev/kolux-rs", "g:/dev/kolux")):
            location = "kolux direct"
        elif "kolux" in directory.lower():
            location = "other Kolux dir"
        else:
            location = "Txais Brain orchestration"
        rows.append(
            {
                "source": "OpenCode",
                "location": location,
                "sid": s["id"],
                "t": datetime.fromtimestamp(
                    (s["time_created"] or 0) / 1000
                ).strftime("%Y-%m-%d"),
                "model": s["model"],
                "inp": s["tokens_input"] or 0,
                "out": s["tokens_output"] or 0,
                "cr": s["tokens_cache_read"] or 0,
                "cw": s["tokens_cache_write"] or 0,
                "rea": s["tokens_reasoning"] or 0,
                "cost": s["cost"] or 0,
                "title": s["title"] or "",
                "parent": s["parent_id"],
            }
        )
    con.close()
    return rows


def row_tokens(r):
    # Codex input already contains cached input, and reasoning is inside output.
    if r["source"] == "Codex":
        return r["inp"] + r["out"] + r["cw"]
    return r["inp"] + r["out"] + r["cr"] + r["cw"] + r["rea"]


def total(rows):
    return {
        "cost": sum(r["cost"] for r in rows),
        "inp": sum(r["inp"] for r in rows),
        "out": sum(r["out"] for r in rows),
        "cr": sum(r["cr"] for r in rows),
        "cw": sum(r["cw"] for r in rows),
        "rea": sum(r["rea"] for r in rows),
        "n": len(rows),
    }


def build_report(claude_rows, codex_rows, oc_rows):
    sources = [
        (
            "Claude Code — Kolux dirs",
            [r for r in claude_rows if r["location"] != "Txais Brain orchestration"],
        ),
        (
            "Claude Code — Txais Brain Kolux sessions",
            [r for r in claude_rows if r["location"] == "Txais Brain orchestration"],
        ),
        (
            "OpenCode — Kolux dirs",
            [r for r in oc_rows if r["location"] != "Txais Brain orchestration"],
        ),
        (
            "OpenCode — Txais Brain Kolux sessions",
            [r for r in oc_rows if r["location"] == "Txais Brain orchestration"],
        ),
        ("Codex — Kolux dirs", codex_rows),
    ]

    source_rows = []
    for name, rows in sources:
        s = total(rows)
        source_rows.append((name, s, sum(row_tokens(r) for r in rows)))

    grand_cost = sum(s["cost"] for _, s, _ in source_rows)
    grand_tokens = sum(t for _, _, t in source_rows)

    locations = defaultdict(lambda: {"cost": 0.0, "tokens": 0.0, "n": 0})
    session_cost = defaultdict(float)
    session_tokens = defaultdict(float)
    for _, rows in sources:
        for r in rows:
            loc = locations[r["location"]]
            loc["cost"] += r["cost"]
            loc["tokens"] += row_tokens(r)
            loc["n"] += 1
            key = (r["location"], r["sid"][:8])
            session_cost[key] += r["cost"]
            session_tokens[key] += row_tokens(r)

    top_sessions = sorted(session_cost.items(), key=lambda kv: -kv[1])[:5]

    tin = sum(total(rows)["inp"] for _, rows in sources)
    tout = sum(total(rows)["out"] for _, rows in sources)
    tcr = sum(total(rows)["cr"] for _, rows in sources)
    tcw = sum(total(rows)["cw"] for _, rows in sources)
    open_code_rea = sum(r["rea"] for r in oc_rows)
    codex_cached = sum(r["cr"] for r in codex_rows)
    noncached_input = tin - codex_cached

    recorded = sum(r["cost"] for r in oc_rows)
    return {
        "source_rows": source_rows,
        "grand": {"cost": grand_cost},
        "grand_tokens": grand_tokens,
        "locations": locations,
        "top_sessions": top_sessions,
        "session_tokens": session_tokens,
        "tin": noncached_input,
        "tout": tout,
        "tcr": tcr,
        "tcw": tcw,
        "trea": open_code_rea,
        "recorded": recorded,
    }


def render(report):
    lines = []
    lines.append(f"_Updated {datetime.now().strftime('%Y-%m-%d %H:%M')} local._")
    lines.append("")
    lines.append("| Source | Tokens | Cost (API-equivalent) |")
    lines.append("|---|---:|---:|")
    for name, s, tokens in report["source_rows"]:
        lines.append(f"| {name} | {fmt_tokens(tokens)} | {fmt_money(s['cost'])} |")
    lines.append(
        f"| **Total** | **{fmt_tokens(report['grand_tokens'])}** | **{fmt_money(report['grand']['cost'])}** |"
    )
    lines.append("")
    lines.append("| Location | Tokens | Cost |")
    lines.append("|---|---:|---:|")
    for loc, v in sorted(
        report["locations"].items(), key=lambda kv: -kv[1]["cost"]
    ):
        lines.append(
            f"| {loc} | {fmt_tokens(v['tokens'])} | {fmt_money(v['cost'])} |"
        )
    lines.append("")
    lines.append("**Token mix**")
    lines.append("")
    lines.append("| Category | Tokens | Share |")
    lines.append("|---|---:|---:|")
    total_tokens = report["grand_tokens"]
    for label, value in [
        ("Cache reads", report["tcr"]),
        ("Cache writes", report["tcw"]),
        ("Non-cached input", report["tin"]),
        ("Output", report["tout"]),
        ("OpenCode reasoning", report["trea"]),
    ]:
        share = (value / total_tokens * 100) if total_tokens else 0
        lines.append(f"| {label} | {fmt_tokens(value)} | {share:.1f}% |")
    lines.append("")
    lines.append("**Top sessions**")
    lines.append("")
    for (loc, sid), cost in report["top_sessions"]:
        tokens = report["session_tokens"][(loc, sid)]
        lines.append(
            f"- `{sid}` — {loc} — {fmt_money(cost)} ({fmt_tokens(tokens)})"
        )
    lines.append("")
    lines.append(
        f"Recorded pay-per-token spend (OpenCode): **{fmt_money(report['recorded'])}**. "
        f"Claude Code and Codex are subscription-weighted list prices, not cash charges."
    )
    return "\n".join(lines)


def update_ledger(report):
    snapshot = render(report)
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    if not LEDGER.exists():
        LEDGER.write_text(
            "# Token usage and spend ledger\n\n"
            "<!-- TOKEN-SNAPSHOT:START -->\n<!-- TOKEN-SNAPSHOT:END -->\n\n"
            "## Snapshot history\n\n"
            "<!-- TOKEN-HISTORY:START -->\n"
            "| Date | Tokens | API-equivalent | Recorded spend | Top driver |\n"
            "|---|---:|---:|---:|---|\n"
            "<!-- TOKEN-HISTORY:END -->\n",
            encoding="utf-8",
        )
    text = LEDGER.read_text(encoding="utf-8")
    text = re.sub(
        r"<!-- TOKEN-SNAPSHOT:START -->.*?<!-- TOKEN-SNAPSHOT:END -->",
        f"<!-- TOKEN-SNAPSHOT:START -->\n{snapshot}\n<!-- TOKEN-SNAPSHOT:END -->",
        text,
        flags=re.S,
    )

    top_driver = max(
        report["locations"].items(), key=lambda kv: kv[1]["cost"]
    )[0]
    row = (
        f"| {datetime.now().strftime('%Y-%m-%d')} | "
        f"{fmt_tokens(report['grand_tokens'])} | "
        f"{fmt_money(report['grand']['cost'])} | "
        f"{fmt_money(report['recorded'])} | {top_driver} |"
    )
    history = re.search(
        r"<!-- TOKEN-HISTORY:START -->(.*?)<!-- TOKEN-HISTORY:END -->",
        text,
        flags=re.S,
    )
    if history:
        block = history.group(1)
        lines = [ln for ln in block.splitlines() if ln.strip()]
        header = [
            ln
            for ln in lines
            if ln.startswith("| Date") or ln.startswith("|---")
        ]
        dated = [ln for ln in lines if re.match(r"^\| 20\d\d-\d\d-\d\d \|", ln)]
        today = datetime.now().strftime("%Y-%m-%d")
        dated = [ln for ln in dated if not ln.startswith(f"| {today} |")]
        dated.append(row)
        dated.sort(key=lambda ln: ln.split("|")[1].strip())
        new_block = "\n" + "\n".join(header + dated) + "\n"
        text = text[: history.start(1)] + new_block + text[history.end(1) :]
    LEDGER.write_text(text, encoding="utf-8")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--claude-root", type=Path, default=DEFAULT_CLAUDE)
    parser.add_argument("--codex-root", type=Path, default=DEFAULT_CODEX)
    parser.add_argument("--opencode-db", type=Path, default=DEFAULT_OPENCODE)
    parser.add_argument("--write", action="store_true", help="update the ledger")
    parser.add_argument(
        "--json", action="store_true", help="print JSON instead of Markdown"
    )
    args = parser.parse_args()

    claude_rows = scan_claude(args.claude_root)
    codex_rows = scan_codex(args.codex_root)
    oc_rows = scan_opencode(args.opencode_db)
    report = build_report(claude_rows, codex_rows, oc_rows)

    if args.json:
        print(
            json.dumps(
                {
                    "tokens": report["grand_tokens"],
                    "cost": report["grand"]["cost"],
                    "recorded": report["recorded"],
                    "sources": {
                        name: {"tokens": tokens, "cost": s["cost"]}
                        for name, s, tokens in report["source_rows"]
                    },
                    "locations": {
                        k: {"tokens": v["tokens"], "cost": v["cost"]}
                        for k, v in report["locations"].items()
                    },
                },
                indent=2,
            )
        )
    else:
        print(render(report))

    if args.write:
        update_ledger(report)
        print(f"\nUpdated {LEDGER}", file=sys.stderr)


if __name__ == "__main__":
    main()
