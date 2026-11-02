//! The plain-text answer of every command, for a call without `--json`.
//!
//! Split out of `cli.rs` with no behaviour change; see docs/research/rust-cli-split.md.

use super::*;

/// CLI-041: bytes the way the status bar and the Resource Manager show them ("717.9 MB", GB with
/// two decimals past 1024 MB); a figure the app could not read is a dash.
pub(super) fn memory_figure(v: &Value) -> String {
    let Some(bytes) = v.as_u64() else { return "– MB".into() };
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 {
        format!("{:.2} GB", mb / 1024.0)
    } else {
        format!("{mb:.1} MB")
    }
}

/// CLI-041: the Resource Manager's breakdown as text: the app, then each terminal session (its
/// whole process tree), then the total, resident and committed side by side, then free memory.
/// T-287-c: a row or total with processes that could not be read shows a dash for committed and
/// says how many, never a partial sum as if it were the whole.
pub(super) fn memory_text(r: &Value) -> String {
    let row = |name: &str, u: &Value, tail: &str| {
        let n = u["processes"].as_u64().unwrap_or(0);
        let lost = u["unreadable"].as_u64().unwrap_or(0);
        let note = if lost > 0 { format!("  ({lost} of {n} could not be read)") } else { String::new() };
        format!("  {name:<34} {:>10}  {:>10}  {n:>3} process{}{note}{tail}", memory_figure(&u["bytes"]), memory_figure(&u["committed"]), if n == 1 { "" } else { "es" })
    };
    let mut out = vec![format!("  {:<34} {:>10}  {:>10}", "", "resident", "committed"), row("Kolux", &r["app"], "")];
    let sessions = r["sessions"].as_array().cloned().unwrap_or_default();
    for s in &sessions {
        let name = format!("Session {}{}", s["id"], s["pid"].as_u64().map(|p| format!(" · pid {p}")).unwrap_or_default());
        out.push(row(&name, s, &s["dir"].as_str().map(|d| format!("  {d}")).unwrap_or_default()));
    }
    if sessions.is_empty() {
        out.push("  No terminal sessions are running.".into());
    }
    let all: Vec<&Value> = std::iter::once(&r["app"]).chain(sessions.iter()).collect();
    // The app's own total and count when it sends them (T-287-c); an older app's rows are summed
    // here, the total unknown as soon as a row with processes has no figure.
    let counted = |u: &Value| u["processes"].as_u64().unwrap_or(0) > 0;
    let (committed, unreadable) = match r.get("committed_total") {
        Some(t) => (t.clone(), r["unreadable"].clone()),
        None if all.iter().filter(|u| counted(u)).all(|u| u["committed"].is_u64()) => (json!(all.iter().filter_map(|u| u["committed"].as_u64()).sum::<u64>()), Value::Null),
        None => (Value::Null, Value::Null),
    };
    let sum = json!({
        "bytes": all.iter().filter_map(|u| u["bytes"].as_u64()).sum::<u64>(),
        "committed": committed,
        "unreadable": unreadable,
        "processes": all.iter().filter_map(|u| u["processes"].as_u64()).sum::<u64>(),
    });
    out.push(row("Total", &sum, ""));
    out.push(match (r["free"].is_null(), r["total"].is_null()) {
        (true, _) => "  Free memory unknown".into(),
        (false, true) => format!("  {} free", memory_figure(&r["free"])),
        (false, false) => format!("  {} free of {}", memory_figure(&r["free"]), memory_figure(&r["total"])),
    });
    out.join("\n")
}

/// CLI-012: the one line `kolux status` prints for a state.
pub(super) fn status_line(r: &Value) -> String {
    let pid = r["pid"].as_u64().map(|p| format!("pid {p}")).unwrap_or_else(|| "pid unknown".into());
    match r["state"].as_str().unwrap_or_default() {
        "running" if r["detail"] == STATUS_BUSY => {
            let how = r["busyMs"].as_u64().map(|ms| format!(" for {}{}", span(ms), r["busyCommand"].as_str().map(|c| format!(" ({c})")).unwrap_or_default())).unwrap_or_default();
            let more = r["busyQueued"].as_u64().map(|n| format!(", {n} more waiting")).unwrap_or_default();
            format!("running: Kolux is up, {STATUS_BUSY}{how}{more} ({pid})")
        }
        "running" => format!("running: Kolux is up and ready ({pid})"),
        "graph-not-ready" => format!("graph-not-ready: Kolux answers but is still loading its workspaces ({pid})"),
        "stale" => format!("stale: Kolux left its startup file behind but nothing answers ({pid}); run {} open to start it again", crate::orchestration::CLI),
        _ => "not-running: Kolux is not running".into(),
    }
}

/// T-076-c: a running time as people read it: "4 s", "3 min 12 s", "1 h 5 min".
pub(super) fn span(ms: u64) -> String {
    let s = ms / 1000;
    match s {
        0..=59 => format!("{s} s"),
        60..=3599 => format!("{} min {} s", s / 60, s % 60),
        _ => format!("{} h {} min", s / 3600, s % 3600 / 60),
    }
}

/// What a success looks like without `--json`. cli FIX-9: a late worker note (`lateWorker`) is
/// printed under any answer that carries one, with the command that closes it.
pub(super) fn text_of(command: &str, r: &Value) -> String {
    let mut text = text_core(command, r);
    for n in r["lateWorker"].as_array().into_iter().flatten() {
        text.push_str(&format!("\nwarning: {}; next: {}", n["note"].as_str().unwrap_or_default(), n["next"].as_str().unwrap_or_default()));
    }
    text
}

pub(super) fn text_core(command: &str, r: &Value) -> String {
    if let Some(t) = local_cli::text(command, r) {
        return t;
    }
    if let Some(t) = crate::browser::cli::text(command, r) {
        return t;
    }
    if let Some(t) = automations_cli::text(command, r) {
        return t;
    }
    if let Some(t) = crate::orchestration::runtime::text(command, r) {
        return t;
    }
    if command.starts_with("file.") {
        return file_cli::text_of(r);
    }
    if let Some(t) = query_text(command, r).or_else(|| terminal_text(command, r)) {
        return t;
    }
    let s = |k: &str| r[k].as_str().unwrap_or_default().to_string();
    match command {
        MEMORY => memory_text(r),
        c if c.starts_with("account.") => cli_accounts::text(c, r),
        "terminal.read" => {
            let strs = |v: &Value| v.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>();
            if r["screen"] == Value::Bool(true) {
                return strs(&r["rows"]).join("\n").trim_end().to_string();
            }
            let mut out: Vec<String> = r["lines"].as_array().into_iter().flatten().filter_map(|l| l["text"].as_str().map(str::to_string)).collect();
            if let Some(p) = r["pending"].as_str().filter(|p| !p.is_empty()) {
                out.push(p.to_string());
            }
            out.push(format!("-- cursor {}", r["cursor"]));
            out.join("\n")
        }
        "terminal.send" => {
            let what = r["delivered"].as_array().into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join("+");
            let tail = match r["receipt"].as_str() {
                Some("turn_began") => ": the prompt was taken (the agent began a turn)".to_string(),
                Some(rc) => format!(": {rc}; {}", r["next"].as_str().map(|n| format!("look with {n}")).unwrap_or_default()),
                None => String::new(),
            };
            format!("sent {what} to {}{}", s("terminal"), tail.trim_end_matches("; "))
        }
        "terminal.wait" => format!("{} is {}", s("terminal"), s("state")),
        "worktree.create" => {
            let mut line = format!("created {} at {} (from {})", if s("name").is_empty() { s("branch") } else { s("name") }, s("path"), s("base"));
            if let Some(n) = r["note"].as_str() {
                line.push_str("\nnote: ");
                line.push_str(n);
            }
            line
        }
        WORKER_START => {
            let model = r["model"].as_str().map(|m| format!(", {m}")).unwrap_or_default();
            let term = r["terminals"][0]["id"].as_u64().map(|t| format!(" in terminal {t}")).unwrap_or_default();
            let how = if s("launch") == "reused_terminal" { ", reused" } else { "" };
            let how = if r["joined"] == true { format!("{how}; joined the same start already under way") } else { how.to_string() };
            let mut line = format!("worker {}: {} for {} in {} ({}{}){}{how}", s("status"), s("dispatchId"), s("taskId"), r["worktree"]["path"].as_str().unwrap_or_default(), s("agent"), model, term);
            if let Some(h) = r["reveal"].as_str() {
                line.push_str(&format!("\n{h}"));
            }
            line
        }
        "orchestration.run-create" | "orchestration.run-use" => format!("Run {}: {}\nthis terminal ({}) is tied to it", r["run"]["id"].as_str().unwrap_or_default(), r["run"]["objective"].as_str().unwrap_or_default(), r["binding"]["terminal"].as_str().unwrap_or_default()),
        "orchestration.run-current" => match r["runId"].as_str() {
            Some(id) => format!("{} is tied to Run {id}: {}", s("terminal"), r["run"]["objective"].as_str().unwrap_or_default()),
            None => format!("{} is not tied to a Run; run-create or run-use ties it", s("terminal")),
        },
        "orchestration.run-list" => {
            let mut out: Vec<String> = r["runs"].as_array().into_iter().flatten().map(|x| format!("{}  {}", x["id"].as_str().unwrap_or_default(), x["objective"].as_str().unwrap_or_default())).collect();
            if out.is_empty() {
                out.push("no Runs".into());
            }
            if let Some(c) = r["nextCursor"].as_str() {
                out.push(format!("more: --cursor {c}"));
            }
            out.join("\n")
        }
        "orchestration.run-show" => format!("Run {}: {}\nhome terminal {}; tied terminals {}\nmessages {} ({} not acknowledged)", s("id"), s("objective"), s("home"), r["terminals"], r["messages"], r["unacknowledged"]),
        "orchestration.request-show" => match s("state").as_str() {
            "completed" => format!("request {} completed and took effect ({}); a retry with it hands back the same result", s("request"), s("command")),
            "pending" if r["interrupted"] == true => format!("request {} ({}) was cut short when Kolux stopped; its outcome is unknown, so check before trying again", s("request"), s("command")),
            "pending" => format!("request {} ({}) is still under way", s("request"), s("command")),
            _ => format!("request {} is absent: Kolux has no record of it, so a retry runs it fresh", s("request")),
        },
        "orchestration.reply" => format!("sent {} to {} on thread {}", r["messageIds"][0].as_str().unwrap_or_default(), s("to"), s("threadId")),
        ASK => match s("status").as_str() {
            "answered" => format!("answer from {} (to {}): {}", s("answeredBy"), s("messageId"), s("answer")),
            _ if r["handedBack"] == true => format!("handing control back (exit status {HANDED_BACK}) while question {id} stays open (asked of {}); resume the wait with: {} orchestration ask --resume {id}", s("to"), crate::orchestration::CLI, id = s("messageId")),
            _ => format!("question {id} is still open (asked of {}); wait again with: {} orchestration ask --resume {id}", s("to"), crate::orchestration::CLI, id = s("messageId")),
        },
        "orchestration.gate-create" => {
            let choices: Vec<&str> = r["options"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let choices = if choices.is_empty() { String::new() } else { format!(" (choices: {})", choices.join(", ")) };
            format!("{} holds {}, now blocked: {}{choices}", s("id"), s("task"), s("question"))
        }
        "orchestration.gate-resolve" => format!("{} resolved: {}; {} is {}", s("id"), s("resolution"), s("task"), s("taskStatus")),
        "orchestration.gate-list" => {
            let mut out: Vec<String> = Vec::new();
            for g in r["gates"].as_array().into_iter().flatten() {
                let f = |k: &str| g[k].as_str().unwrap_or_default().to_string();
                out.push(format!("{}  {}  {}  {}", f("id"), f("status"), f("task"), f("question")));
                if let Some(res) = g["resolution"].as_str() {
                    out.push(format!("  decided: {res}"));
                }
            }
            if out.is_empty() {
                out.push("no gates".into());
            }
            out.join("\n")
        }
        "orchestration.inbox" => {
            let msgs = r["messages"].as_array().cloned().unwrap_or_default();
            let mut out = vec![if msgs.is_empty() { "no mail".to_string() } else { format!("{} newest message(s) for {}", msgs.len(), s("terminal")) }];
            mail_lines(&msgs, &mut out);
            out.join("\n")
        }
        "orchestration.task-create" => {
            let deps: Vec<&str> = r["deps"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            if s("status") == "pending" { format!("{} is pending: it waits on {}", s("id"), deps.join(", ")) } else { format!("{} is {}", s("id"), s("status")) }
        }
        "orchestration.task-list" => {
            let rows = r["tasks"].as_array().cloned().unwrap_or_default();
            let mut out = Vec::new();
            for t in &rows {
                let g = |k: &str| t[k].as_str().unwrap_or_default().to_string();
                let deps: Vec<&str> = t["deps"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
                let waits = if deps.is_empty() { String::new() } else { format!(" (waits on {})", deps.join(", ")) };
                let worker = t["worker"]["dispatchId"].as_str().map(|d| format!(" [{d} in {}]", t["worker"]["terminal"].as_str().unwrap_or("?"))).unwrap_or_default();
                // ORCH-035 (T-279-d): a held task shows "held (3 failures)", not the bare word.
                let state = t["held"].as_str().map_or_else(|| g("status"), str::to_string);
                out.push(format!("{}  {state}  {}{waits}{worker}", g("id"), g("name")));
                if r["brief"] == true {
                    out.push(format!("  {}", g("spec")));
                }
            }
            if out.is_empty() {
                out.push(match r["runId"].as_str() { Some(run) => format!("no tasks in {run}"), None => "no tasks outside a Run".into() });
            }
            out.join("\n")
        }
        "orchestration.dispatch" => {
            let how = if s("mode") == "inject" { "the brief is typed in" } else { "context only, nothing typed" };
            let mut line = if r["dryRun"] == true && r["to"].is_null() {
                format!("dry run: the opening text for {} ({} is still {}); nothing was handed on", s("taskId"), s("taskId"), s("taskStatus"))
            } else if r["dryRun"] == true {
                format!("dry run: would hand {} to {} ({}) as {}, {how}; {} is still {}", s("taskId"), s("to"), s("agent"), s("dispatchId"), s("taskId"), s("taskStatus"))
            } else {
                format!("{}: {} handed to {} ({}), {how}", s("dispatchId"), s("taskId"), s("to"), s("agent"))
            };
            if let Some(p) = r["preamble"].as_str() {
                line.push_str("\n\n");
                line.push_str(p);
            }
            line
        }
        "orchestration.dispatch-show" => {
            let mut line = format!("{}: {} on {} ({}), {}, {}", s("id"), s("taskId"), s("handle"), s("agent"), if s("mode").is_empty() { "worker" } else { r["mode"].as_str().unwrap_or_default() }, s("status"));
            if let Some(p) = r["preamble"].as_str() {
                line.push_str("\n\n");
                line.push_str(p);
            }
            line
        }
        TASK_RESET => match r["cleared"].as_u64() {
            Some(0) | None => format!("{} had no counted failures; it is {}", s("id"), s("status")),
            Some(n) => format!("{} released: {n} failed hand-out{} no longer counted; it lists {} again", s("id"), if n == 1 { " is" } else { "s are" }, s("status")),
        },
        UPDATE => {
            let mut line = format!("{} is {} (was {})", s("taskId"), s("status"), s("previous"));
            if !s("dispatchStatus").is_empty() {
                line += &format!("; {} settled as {}", s("dispatchId"), s("dispatchStatus"));
            }
            line
        }
        STOP => {
            let term = if s("terminal").is_empty() { "its terminal".to_string() } else { s("terminal") };
            let how = match r["process"].as_str() {
                Some("unverifiable") => format!("Kolux has lost touch with {term}, so whether its agent ended cannot be verified"),
                _ => format!("its agent terminal {term} has ended"),
            };
            let warn = r["warning"].as_str().map(|w| format!("\nwarning: {w}")).unwrap_or_default();
            format!("{} stopped: {how}; the worktree {} stays; {} is {}{warn}", s("dispatchId"), s("worktree"), s("taskId"), s("taskStatus"))
        }
        WORKER_LIST => {
            let scope = match (r["scope"]["from"].as_str(), r["scope"]["run"].as_str()) {
                (Some("named"), Some(run)) => format!("workers in {run} (named with --run)"),
                (_, Some(run)) => format!("workers in {run} (this terminal's Run)"),
                _ => "workers in every Run (this terminal is tied to none)".to_string(),
            };
            let rows = r["workers"].as_array().cloned().unwrap_or_default();
            let mut out = vec![format!("{scope}: {}", rows.len())];
            for w in &rows {
                let g = |k: &str| w[k].as_str().unwrap_or("-").to_string();
                let next = w["next"].as_str().map(|n| format!("; next: {n}")).unwrap_or_default();
                // cli FIX-12 (council FIX-SOON 3 on 28f3eb7a): a left-open terminal is closed with terminal close
                // (a release would leave it open again); any other pending row is closed by worker-release.
                // worker-show only ends the alarm, on a later show, and never names the way out.
                let left_open = w["terminalLeftOpen"].as_str().filter(|why| !why.is_empty());
                let late = match (w["latePending"] == true, w["lateAfter"].as_str(), left_open) {
                    (true, Some(status), Some(why)) => format!("; its agent came up late, after the dispatch was {status}, and its terminal is left open ({why}): close it with {} terminal close --terminal {}", crate::orchestration::CLI, g("terminal")),
                    (true, Some(status), None) => format!("; its agent came up late, after the dispatch was {status}: close it with {} orchestration worker-release --dispatch {}", crate::orchestration::CLI, g("dispatchId")),
                    (false, Some(status), _) => format!("; its agent came up late, after the dispatch was {status}"),
                    _ if w["lateStamp"] == true => "; its agent came up late".to_string(),
                    _ => String::new(),
                };
                out.push(format!("{} {} (task {}) terminal {} {}{late}{next}", g("dispatchId"), g("terminalState"), g("taskStatus"), g("terminal"), g("worktree")));
            }
            if let Some(c) = r["nextCursor"].as_str() {
                out.push(format!("more: --cursor {c}"));
            }
            out.join("\n")
        }
        RELEASE => match r["terminalState"].as_str() {
            Some("released") if r["alreadyReleased"] == true => format!("{} was already released", s("dispatchId")),
            Some("released") if !s("archive").is_empty() => format!("{} released: its output is saved at {} and its terminal is closed; the worktree {} stays", s("dispatchId"), s("archive"), s("worktree")),
            // cli FIX-3 (b): a terminal that is not the worker's to close is left open, and why.
            Some("released") if !s("terminalLeftOpen").is_empty() => format!("{} released: its terminal {} is left open ({}); the worktree {} stays", s("dispatchId"), s("terminal"), s("terminalLeftOpen"), s("worktree")),
            Some("released") => format!("{} released: its terminal was already gone; the worktree {} stays", s("dispatchId"), s("worktree")),
            _ => format!("{} release unknown: {}; next: {}", s("dispatchId"), s("error"), s("next")),
        },
        WORKER_SHOW => {
            // cli FIX-9: a session recorded after the start gave up, and the status the row had when it came.
            let late = match (r["lateStamp"] == true, r["lateAfter"].as_str()) {
                (_, Some(status)) => format!("; its agent came up late, after the dispatch was {status}"),
                (true, None) => "; its agent came up late".to_string(),
                _ => String::new(),
            };
            format!("{} {} (task {}) terminal {} {}; waiting on a person: {} ({}){late}", s("dispatchId"), s("terminalState"), s("taskStatus"), s("terminal"), s("worktree"), s("waiting"), s("waitingWhy"))
        }
        RETAIN => match r["alreadyRetained"] == true {
            true => format!("{} was already kept", s("dispatchId")),
            false => format!("{} kept: its terminal {} stays open until it is released", s("dispatchId"), s("terminal")),
        },
        ABANDON => {
            let term = if s("terminal").is_empty() { "its terminal".to_string() } else { s("terminal") };
            format!("{} abandoned: its worker can no longer report on it; {term} stays open; {} is {}", s("dispatchId"), s("taskId"), s("taskStatus"))
        }
        SEND => {
            let sent = format!("sent {} to {}", r["messageIds"].as_array().into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join(", "), s("to"));
            let k = &r["settled"];
            match (k["status"].as_str(), k["why"].as_str()) {
                (Some(st), _) => format!("{sent}\n{} is {st}", k["taskId"].as_str().unwrap_or_default()),
                (_, Some(why)) => format!("{sent}\n{why}"),
                _ => sent,
            }
        }
        CHECK => {
            let msgs = r["messages"].as_array().cloned().unwrap_or_default();
            let mut out = Vec::new();
            match (r["deliveryId"].as_str(), msgs.is_empty()) {
                (_, true) if r["timedOut"] == true => out.push("no mail before the timeout".to_string()),
                (_, true) => out.push("no mail".to_string()),
                (Some(d), false) => out.push(format!("delivery {d}: {} message(s); acknowledge with --ack {d}", msgs.len())),
                (None, false) => out.push(format!("{} message(s), {}", msgs.len(), s("mode"))),
            }
            mail_lines(&msgs, &mut out);
            out.join("\n")
        }
        "orchestration.reset" => {
            // ORCH-031: what each scope took and what it left
            let what = match s("scope").as_str() {
                "tasks" => "the tasks, workers and gates went; Runs and mail are kept",
                "messages" => "the mail and delivery positions went; Runs and tasks are kept",
                _ => "everything went; ids keep counting up",
            };
            format!("cleared {}: {} task(s), {} dispatch(es), {} message(s), {} run(s); {what}", s("scope"), r["tasks"], r["dispatches"], r["messages"], r["runs"])
        }
        "app.open" if r["started"] == Value::Bool(true) => "Kolux started and is ready".into(),
        // CLI-011 box 2: "in front" is claimed only when the raise did not say otherwise.
        "app.open" if r["raised"] == Value::Bool(false) => "Kolux is ready; its window was restored, but Windows kept another window in front".into(),
        "app.open" => "Kolux is ready; its window is in front".into(),
        _ if r["branchKept"] == true => format!("removed {}; branch {} kept", s("path"), s("branch")),
        _ => format!("removed {}", s("path")),
    }
}

/// One line per message, its body under it, and the command that answers it (ORCH-006).
/// ORCH-009: each message as a banner: a HIGH or URGENT tag, its kind and id, the sender (agent
/// name and handle), subject, body, payload and the reply command, then its own dividing line.
pub(super) fn mail_lines(msgs: &[Value], out: &mut Vec<String>) {
    for m in msgs {
        let g = |k: &str| m[k].as_str().unwrap_or_default();
        let tag = match g("priority") {
            "high" => "[HIGH] ",
            "urgent" => "[URGENT] ",
            _ => "",
        };
        let from = match g("fromAgent") {
            "" => g("from").to_string(),
            name => format!("{name} ({})", g("from")),
        };
        out.push(format!("{tag}{} {} from {from}: {}", g("type"), g("id"), g("subject")));
        out.extend(g("body").lines().map(|l| format!("  {l}")));
        if !m["payload"].is_null() {
            out.push(format!("  payload: {}", m["payload"]));
        }
        // ORCH-015: a done report shows how it ended, the files it touched and its report.
        let files = m["filesModified"].as_array().into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join(", ");
        for (k, v) in [("outcome", g("outcome").to_string()), ("files", files), ("report", g("reportPath").to_string())] {
            if !v.is_empty() {
                out.push(format!("  {k}: {v}"));
            }
        }
        if !g("reply").is_empty() {
            out.push(format!("  reply: {}", g("reply")));
        }
        out.push("-".repeat(60));
    }
}

/// The readable form of the terminal commands' answers.
pub(super) fn terminal_text(command: &str, r: &Value) -> Option<String> {
    let s = |v: &Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    let list = |k: &str| r[k].as_array().cloned().unwrap_or_default().iter().filter_map(|h| h.as_str().map(String::from)).collect::<Vec<_>>();
    let mut lines: Vec<String> = Vec::new();
    match command {
        "terminal.list" => {
            let rows = r["terminals"].as_array().cloned().unwrap_or_default();
            if rows.is_empty() {
                lines.push(format!("no terminals open in {}", r["scope"].as_str().unwrap_or("any worktree")));
            } else if let Some(trees) = r["layouts"].as_array() {
                for w in trees {
                    lines.push(w["worktree"].as_str().unwrap_or("(outside every worktree)").to_string());
                    for p in w["panes"].as_array().into_iter().flatten() {
                        lines.push(p["pane"].as_u64().map_or("  (not in the window yet)".into(), |n| format!("  pane {n}")));
                        for t in p["tabs"].as_array().into_iter().flatten() {
                            lines.push(format!("    {}  {}{}", s(t, "handle"), s(t, "title"), if t["shown"] == true { "  (in view)" } else { "" }));
                        }
                    }
                }
            } else {
                lines.extend(rows.iter().map(|t| format!("{}  {}  {}", s(t, "handle"), s(t, "title"), t["worktree"].as_str().unwrap_or("-"))));
            }
            if r["truncated"] == true {
                lines.push("(more not shown; raise --limit)".into());
            }
            lines.push("hosts covered: local; none left out".into());
        }
        "terminal.show" => {
            lines.push(format!("{}  {}", s(r, "handle"), s(r, "title")));
            lines.push(format!("worktree {} · pane {} tab {} · host {}{}", r["worktree"].as_str().unwrap_or("none"), r["pane"], r["tab"], s(r, "host"), if r["shown"] == true { " · in view" } else { "" }));
        }
        "terminal.create" => lines.push(format!("opened {} in {}{}", s(r, "handle"), s(r, "worktree"), if r["focused"] == true { " and brought it into view" } else { " in the background" })),
        "terminal.split" => lines.push(format!("split {}: {} opened {}", s(r, "from"), s(r, "handle"), if s(r, "direction") == "horizontal" { "below it" } else { "beside it" })),
        "terminal.rename" => lines.push(if r["default"] == true { format!("{} has its default name back: {}", s(r, "handle"), s(r, "title")) } else { format!("{} is now called {}", s(r, "handle"), s(r, "title")) }),
        "terminal.switch" => lines.push(format!("{} is in view", s(r, "handle"))),
        "terminal.close" => {
            let closed = list("closed");
            lines.push(if closed.is_empty() { "nothing was open there to close".into() } else { format!("closed and confirmed stopped: {}", closed.join(", ")) });
            let mine = list("leftOpen");
            if !mine.is_empty() {
                lines.push(format!("left open: {} (the terminal this command runs in)", mine.join(", ")));
            }
        }
        _ => return None,
    }
    if let Some(n) = r["note"].as_str() {
        lines.push(format!("note: {n}"));
    }
    Some(lines.join("\n"))
}

/// The text of the lookups above, one line per row.
pub(super) fn query_text(command: &str, r: &Value) -> Option<String> {
    let s = |v: &Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    let repo = |v: &Value| format!("{}  {}  ({}{})", s(v, "name"), s(v, "path"), s(v, "selector"), v["baseRef"].as_str().map(|b| format!(", base {b}")).unwrap_or_default());
    let label = |v: &Value| v["name"].as_str().or(v["branch"].as_str()).unwrap_or("(detached)").to_string();
    let rows = |k: &str| r[k].as_array().cloned().unwrap_or_default();
    Some(match command {
        "repo.list" | "project.list" => {
            let list = rows(if command == "repo.list" { "repos" } else { "projects" });
            if list.is_empty() {
                format!("no repos yet; add one with {} repo add --path <folder>", crate::orchestration::CLI)
            } else {
                list.iter().map(repo).collect::<Vec<_>>().join("\n")
            }
        }
        "repo.add" => format!("added {}", repo(r)),
        "repo.set-base-ref" => format!("{}: new worktrees start from {}", s(r, "name"), s(r, "baseRef")),
        "repo.show" => format!("{}\nbase {}; {} worktree(s)", repo(r), r["base"].as_str().unwrap_or("none found"), r["worktrees"]),
        "repo.search-refs" => {
            let list = rows("refs");
            if list.is_empty() {
                "no refs match".into()
            } else {
                list.iter().map(|x| format!("{:<7} {}", s(x, "kind"), s(x, "name"))).collect::<Vec<_>>().join("\n")
            }
        }
        "worktree.list" | "worktree.ps" => {
            let mut out: Vec<String> = rows("worktrees")
                .iter()
                .map(|w| {
                    let mut line = format!("{}  [{}]  {}  ({}){}", label(w), w["branch"].as_str().unwrap_or("detached"), s(w, "path"), s(w, "selector"), if w["degraded"] == true { "  [last known]" } else { "" });
                    for x in w["workers"].as_array().into_iter().flatten() {
                        line.push_str(&format!("\n    worker {} on {} · {}{}", s(x, "dispatchId"), s(x, "taskId"), s(x, "status"), x["terminal"].as_str().map(|t| format!(" ({t})")).unwrap_or_default()));
                    }
                    if let Some(list) = w["sessions"].as_array().filter(|l| !l.is_empty()) {
                        line.push_str(&format!("\n    {}", list.iter().map(|x| format!("{} {}", s(x, "terminal"), x["program"].as_str().unwrap_or("shell"))).collect::<Vec<_>>().join(", ")));
                    }
                    line
                })
                .collect();
            if out.is_empty() {
                out.push(if command == "worktree.ps" { "no sessions or workers are running".into() } else { "no worktrees".into() });
            }
            for x in rows("unreadable") {
                out.push(format!("{}: not listed, its folder could not be read ({})", s(&x, "repo"), s(&x, "error")));
            }
            if r["truncated"] == true {
                out.push("(more rows; raise --limit)".into());
            }
            if r["unchanged"] == true {
                return Some(format!("no change since this terminal's last ps (snapshot {})", s(r, "snapshot")));
            }
            if let Some(scope) = r.get("scope") {
                let repos = scope["repos"].as_array().cloned().unwrap_or_default();
                let n = |v: &Value| v.as_u64().unwrap_or(0);
                let mut line = format!("scope: {} repo{}, {} worktrees, {} with work", repos.len(), if repos.len() == 1 { "" } else { "s" }, n(&scope["worktrees"]), n(&scope["shown"]));
                for x in repos.iter().filter(|x| x["scan"] == "degraded") {
                    line.push_str(&format!("; {}: last known list ({})", s(x, "name"), s(x, "error")));
                }
                out.push(line + "; this computer only");
            }
            out.push("hosts covered: local; none left out".into());
            out.join("\n")
        }
        "worktree.changes" => {
            let mut out = vec![match r["base"].as_str() {
                Some(b) => format!("{} against {b}:", s(r, "worktree")),
                None => format!("{}: no base branch found, so only uncommitted work is shown:", s(r, "worktree")),
            }];
            let list = rows("files");
            out.extend(list.iter().map(|f| format!("  {} {}", s(f, "status"), s(f, "path"))));
            if list.is_empty() {
                out.push("  nothing changed".into());
            }
            out.join("\n")
        }
        "worktree.overlap" => {
            let mut out = vec![format!("{} touches {} file(s) against {}", s(r, "worktree"), r["files"], r["base"].as_str().unwrap_or("no base"))];
            for sib in rows("siblings") {
                let clash = match sib["clash"].as_str().unwrap_or_default() {
                    "clean" => "committed work merges cleanly".to_string(),
                    "conflict" => format!("committed work would conflict in {}", sib["conflicts"].as_array().map(|c| c.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default()),
                    _ => format!("merge unverifiable: {}", sib["why"].as_str().unwrap_or("git could not check it")),
                };
                let files: Vec<String> = sib["files"].as_array().map(|f| f.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                out.push(format!("  {} [{}] also touches {}; {clash}", s(&sib, "path"), sib["branch"].as_str().unwrap_or("detached"), files.join(", ")));
            }
            for u in rows("unreadable") {
                out.push(format!("  could not read the changes of {}: {}", s(&u, "path"), s(&u, "why")));
            }
            if rows("siblings").is_empty() {
                out.push(if r["complete"] == true { "  no other worktree touches these files".into() } else { "  could not verify that no other worktree touches these files".into() });
            } else if r["complete"] != true {
                out.push("  the scan was incomplete; other overlaps may be missing".into());
            }
            out.join("\n")
        }
        SET => {
            let mut out = vec![format!("updated {}  [{}]  {}", label(r), r["branch"].as_str().unwrap_or("detached"), s(r, "path"))];
            out.push(r["number"].as_u64().map_or("no linked issue".into(), |n| format!("linked #{n}")));
            if let Some(c) = r["comment"].as_str() {
                out.push(format!("comment {c}"));
            }
            out.push(r["parent"].as_str().map_or("no parent".into(), |p| format!("parent {p}")));
            out.join("\n")
        }
        "worktree.show" | "worktree.current" => {
            let mut out = vec![format!("{}  [{}]  {}", label(r), r["branch"].as_str().unwrap_or("detached"), s(r, "path")), format!("selector {}", s(r, "selector"))];
            if let Some(p) = r["parent"].as_str() {
                out.push(format!("parent {p}"));
            }
            for c in rows("children") {
                out.push(format!("child {}", c.as_str().unwrap_or_default()));
            }
            for (p, u) in r["usage"].as_object().into_iter().flatten() {
                let n = |k: &str| u[k].as_u64().unwrap_or(0);
                out.push(if u["tracked"] == true {
                    format!("tokens {p}: in {} out {} cache read {} cache write {} in {} sessions", n("input"), n("output"), n("cacheRead"), n("cacheWrite"), u["sessions"].as_array().map_or(0, Vec::len))
                } else {
                    format!("tokens {p}: not tracked (turn it on in Token analytics)")
                });
            }
            out.join("\n")
        }
        _ => return None,
    })
}
