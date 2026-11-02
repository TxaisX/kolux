//! SKILL-031: `kolux skills install` and `kolux skills update` for a terminal, through the
//! community skills installer. This file holds every rule; the CLI lane's `local_cli.rs` and
//! `cli.rs` only route to it (evidence/skills-T-198-b-cli.patch). The installer is swappable, so
//! tests use a fake and never start a real one.
//!
//! install: `--skill a,b` or `--all` (never both; neither lists what is on offer), `--agent a,b`
//! (a comma list; `universal` aims at the shared folder only), `--local` (this project instead of
//! the whole computer), `--dry-run` (prints the command). A real run is unattended: the agents it
//! names are the ones detected on this computer (or the ones given) plus the shared folder, and
//! `--json` is refused because the installer prints its own text. update: the same flags except
//! `--agent`, and only for skills already installed.
#![allow(dead_code)] // reached from the CLI routes that evidence/skills-T-198-b-cli.patch adds

use super::installer::{self, Cmd, Installer};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::atomic::AtomicBool;

#[derive(Debug)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
    pub data: Value,
}

fn fail(code: &'static str, message: impl Into<String>) -> Failure {
    Failure { code, message: message.into(), data: Value::Null }
}

fn args_err(message: impl Into<String>) -> Failure {
    fail("invalid_arguments", message)
}

/// Kolux's agent id, the installer's name for it, and whether the shared folder already serves it
/// (so naming it separately would only install a second copy). An agent not listed has no known
/// installer name and is never guessed at. The installer names are an assumption to be checked
/// against a live installer (kolux-rs-after.md).
const AGENTS: &[(&str, &str, bool)] = &[
    ("claude", "claude-code", false),
    ("codex", "codex", true),
    ("cline", "cline", true),
    ("kimi", "kimi-cli", true),
    ("pi", "pi", true),
    ("amp", "amp", false),
    ("antigravity", "antigravity", false),
    ("aug", "augment", false),
    ("openclaw", "openclaw", false),
    ("continue", "continue", false),
    ("crush", "crush", false),
    ("cursor", "cursor", false),
    ("droid", "droid", false),
    ("gemini", "gemini-cli", false),
    ("copilot", "github-copilot", false),
    ("goose", "goose", false),
    ("kilo", "kilo", false),
    ("kiro", "kiro-cli", false),
    ("qwen-code", "qwen-code", false),
];

/// The flags of either command.
#[derive(Clone, Debug, Default)]
pub struct Req {
    pub update: bool,
    pub skill: Option<String>,
    pub all: bool,
    pub agent: Option<String>,
    pub local: bool,
    pub dry_run: bool,
}

fn flag(a: &Map<String, Value>, k: &str) -> bool {
    a.get(k) == Some(&Value::Bool(true))
}

pub fn req_of(command: &str, a: &Map<String, Value>) -> Req {
    let s = |k: &str| a.get(k).and_then(Value::as_str).map(str::to_string);
    // The CLI collects a repeated --skill into a list; a, b and a,b mean the same.
    let skill = match a.get("skill") {
        Some(Value::Array(v)) => Some(v.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(",")),
        _ => s("skill"),
    };
    Req { update: command == "skills.update", skill, all: flag(a, "all"), agent: s("agent"), local: flag(a, "local"), dry_run: flag(a, "dry-run") }
}

/// `--json` on a real run is refused: the installer prints its own text and Kolux would have to
/// hide it. Listing what is on offer and `--dry-run` may be JSON. Called by the CLI before `run`;
/// the CLI passes `--json` in as the `json` argument.
pub fn json_refusal(command: &str, a: &Map<String, Value>) -> Option<Failure> {
    let r = req_of(command, a);
    (matches!(command, "skills.install" | "skills.update") && flag(a, "json") && !r.dry_run && (r.all || r.skill.is_some())).then(|| args_err("--json cannot be used with a real install or update: the installer prints its own text. Add --dry-run to see the command as JSON"))
}

/// What the command knows about this computer.
pub struct Ctx<'a> {
    /// The Kolux skills the repository offers.
    pub bundled: Vec<String>,
    /// Kolux skills with a copy installed somewhere.
    pub installed: Vec<String>,
    /// Of those, the ones the installer may update (recorded, unchanged, out of date).
    pub updatable: Vec<String>,
    /// Kolux agent ids installed on this computer.
    pub detected: Vec<String>,
    pub app_dir: &'a Path,
    pub repo: &'a str,
}

pub fn live_ctx(app_dir: &Path) -> Ctx<'_> {
    let env = super::Env::current();
    let report = super::update::fresh(&env, None);
    Ctx {
        bundled: crate::cli::bundled_skills().iter().map(|b| b.0.to_string()).collect(),
        installed: report.rows.iter().map(|r| r.name.clone()).collect(),
        updatable: report.rows.iter().filter(|r| r.state == "available").map(|r| r.name.clone()).collect(),
        detected: crate::agents::agent_list().into_iter().filter(|a| a.installed).map(|a| a.id).collect(),
        app_dir,
        repo: installer::OFFICIAL_REPO,
    }
}

/// The installer names to aim at. Given by the user: a comma list of Kolux ids or installer names.
/// Otherwise the detected agents the shared folder does not already serve, each with a known name.
fn agents(req: &Req, ctx: &Ctx) -> Result<Vec<String>, Failure> {
    if let Some(list) = &req.agent {
        let mut out = vec![];
        for item in list.split(',') {
            if item.is_empty() || item != item.trim() {
                return Err(args_err("--agent takes a comma list with no blanks, like claude,gemini"));
            }
            let name = if item == installer::SHARED_AGENT {
                item.to_string()
            } else if let Some(a) = AGENTS.iter().find(|a| a.0 == item || a.1 == item) {
                a.1.to_string()
            } else {
                let known: Vec<&str> = AGENTS.iter().map(|a| a.0).collect();
                return Err(args_err(format!("{item} is not an agent this installer knows; use {} or universal for the shared folder", known.join(", "))));
            };
            if !out.contains(&name) {
                out.push(name);
            }
        }
        return Ok(out);
    }
    if ctx.detected.is_empty() {
        return Err(args_err("no AI was found on this computer: name an agent with --agent, or universal for the shared folder"));
    }
    let mut out: Vec<String> = ctx.detected.iter().filter_map(|id| AGENTS.iter().find(|a| a.0 == id && !a.2).map(|a| a.1.to_string())).collect();
    out.sort();
    out.dedup();
    Ok(out)
}

fn pick(req: &Req, ctx: &Ctx) -> Result<Option<Vec<String>>, Failure> {
    if req.all && req.skill.is_some() {
        return Err(args_err("--skill and --all cannot be combined: name the skills or take them all"));
    }
    let pool = if req.update { &ctx.updatable } else { &ctx.bundled };
    if req.all {
        if pool.is_empty() {
            return Err(fail("not_found", if req.update { "no installed Kolux skill has an update the installer may apply" } else { "there is no Kolux skill to install" }));
        }
        return Ok(Some(pool.clone()));
    }
    let Some(list) = &req.skill else { return Ok(None) };
    let mut names = vec![];
    for n in list.split(',') {
        if !installer::safe_name(n.trim()) {
            return Err(args_err(format!("{n:?} is not a skill name: names hold letters, digits, dots, dashes and underscores only")));
        }
        let n = n.trim().to_string();
        if !ctx.bundled.contains(&n) {
            return Err(Failure { code: "not_found", message: format!("there is no Kolux skill called {n}; the skills are {}", ctx.bundled.join(", ")), data: json!({ "skills": ctx.bundled }) });
        }
        if req.update && !ctx.installed.contains(&n) {
            return Err(fail("not_installed", format!("{n} is not installed, so there is nothing to update; run skills install --skill {n}")));
        }
        if req.update && !ctx.updatable.contains(&n) {
            return Err(fail("not_updatable", format!("{n} is up to date, or its copy was changed or not recorded by the installer, so the installer will not touch it")));
        }
        names.push(n);
    }
    Ok(Some(names))
}

pub fn run(req: &Req, ctx: &Ctx, inst: &dyn Installer) -> Result<Value, Failure> {
    let verb = if req.update { "update" } else { "install" };
    if req.update && req.agent.is_some() {
        return Err(args_err("--agent is not taken by skills update: it updates the copies where they are"));
    }
    let Some(names) = pick(req, ctx)? else {
        let pool = if req.update { &ctx.updatable } else { &ctx.bundled };
        return Ok(json!({ "action": verb, "offer": true, "skills": pool, "ran": false }));
    };
    let (cmd, agent_names): (Cmd, Vec<String>) = if req.update {
        {
            let mut c = installer::update_cmd(&names).map_err(args_err)?;
            if req.local {
                c.args.retain(|a| a != "-g");
            }
            (c, vec![])
        }
    } else {
        let a = agents(req, ctx)?;
        (installer::add_cmd(ctx.repo, &names, &a, !req.local, true).map_err(args_err)?, a)
    };
    let scope = if req.local { "project" } else { "computer" };
    let mut out = json!({ "action": verb, "scope": scope, "skills": names, "agents": agent_names, "command": cmd.line(), "dryRun": req.dry_run, "ran": false });
    if req.dry_run {
        return Ok(out);
    }
    // Nothing else may change the skills folders while the installer runs.
    let _lock = super::super::skill_delete::lock(ctx.app_dir).map_err(|e| match e {
        super::super::skill_delete::LockError::Busy => fail("busy", "another skill change is under way; try again when it has finished"),
        super::super::skill_delete::LockError::Failed(m) => fail("failed", format!("the skills folders could not be locked: {m}")),
    })?;
    let done = inst.run(&cmd, &AtomicBool::new(false)).map_err(|e| fail("installer_unavailable", e))?;
    out["ran"] = json!(true);
    out["exitCode"] = json!(done.code);
    out["log"] = json!(done.log);
    if done.code != Some(0) {
        let code = done.code.map_or("none".to_string(), |c| c.to_string());
        out["hint"] = json!(done.log.trim_end());
        return Err(Failure { code: "installer_failed", message: format!("the community skills installer exited with status {code}"), data: out });
    }
    Ok(out)
}

/// The command's words for a person.
pub fn text(r: &Value) -> String {
    let verb = r["action"].as_str().unwrap_or("install");
    if r["offer"] == true {
        let names: Vec<&str> = r["skills"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        return if names.is_empty() {
            format!("Nothing is installed to {verb}.")
        } else {
            format!("Skills to {verb}: {}\nName some with --skill a,b, or take them all with --all.", names.join(", "))
        };
    }
    if r["ran"] == true {
        return r["log"].as_str().unwrap_or_default().trim_end().to_string();
    }
    format!("Would run: {}", r["command"].as_str().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::installer::Outcome;
    use crate::test_dir::temp;
    use std::sync::Mutex;

    struct Fake {
        seen: Mutex<Vec<String>>,
        code: Option<i32>,
        err: Option<String>,
    }

    impl Fake {
        fn ok() -> Fake {
            Fake { seen: Mutex::new(vec![]), code: Some(0), err: None }
        }
    }

    impl Installer for Fake {
        fn run(&self, cmd: &Cmd, _: &AtomicBool) -> Result<Outcome, String> {
            self.seen.lock().unwrap().push(cmd.line());
            match &self.err {
                Some(e) => Err(e.clone()),
                None => Ok(Outcome { code: self.code, log: "installed it\n".into(), stopped: false }),
            }
        }
    }

    fn ctx(dir: &Path) -> Ctx<'_> {
        let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        Ctx { bundled: v(&["kolux-cli", "orchestration", "koluxward"]), installed: v(&["orchestration", "koluxward"]), updatable: v(&["orchestration"]), detected: v(&["gemini", "claude", "codex", "mystery"]), app_dir: dir, repo: "kolux/skills" }
    }

    fn req<R>(update: bool, f: impl FnOnce(&mut Req) -> R) -> Req {
        let mut r = Req { update, ..Req::default() };
        f(&mut r);
        r
    }

    fn err(r: Result<Value, Failure>) -> Failure {
        match r {
            Err(f) => f,
            Ok(v) => panic!("expected an error, got {v}"),
        }
    }

    #[test]
    fn a_dry_run_prints_the_unattended_command_for_the_detected_agents_and_runs_nothing() {
        let t = temp("cli-dry");
        let f = Fake::ok();
        let r = run(&req(false, |r| (r.skill = Some("orchestration,kolux-cli".into()), r.dry_run = true)), &ctx(&t), &f).unwrap();
        // gemini and claude get their installer names; codex is served by the shared folder; an agent with no known name is never guessed at.
        assert_eq!(r["command"], "npx --yes skills add kolux/skills --skill kolux-cli --skill orchestration --agent claude-code gemini-cli universal -y -g");
        assert_eq!((r["ran"].clone(), r["scope"].clone()), (json!(false), json!("computer")));
        assert!(f.seen.lock().unwrap().is_empty());
        assert_eq!(text(&r), format!("Would run: {}", r["command"].as_str().unwrap()));
    }

    #[test]
    fn skill_and_all_together_are_an_error_and_neither_lists_what_is_on_offer() {
        let t = temp("cli-offer");
        let f = Fake::ok();
        let e = err(run(&req(false, |r| (r.skill = Some("orchestration".into()), r.all = true)), &ctx(&t), &f));
        assert_eq!(e.code, "invalid_arguments");
        assert!(e.message.contains("cannot be combined"));
        let o = run(&req(false, |_| ()), &ctx(&t), &f).unwrap();
        assert_eq!((o["offer"].clone(), o["skills"].clone()), (json!(true), json!(["kolux-cli", "orchestration", "koluxward"])));
        assert!(text(&o).contains("--skill a,b") && text(&o).contains("--all"));
        assert!(f.seen.lock().unwrap().is_empty());
        // --all takes every skill on offer.
        let a = run(&req(false, |r| (r.all = true, r.dry_run = true)), &ctx(&t), &f).unwrap();
        assert_eq!(a["skills"], json!(["kolux-cli", "orchestration", "koluxward"]));
    }

    /// The install offer is the bundled table, so every skill that joins it (video, DT-C64) is
    /// also a folder the official repo must carry before the release ships; this pins which names
    /// the installer is handed so a new bundled skill cannot slip into `--all` unnoticed.
    #[test]
    fn install_all_offers_every_bundled_skill_against_the_official_repo() {
        let t = temp("cli-all-bundled");
        let f = Fake::ok();
        let bundled: Vec<String> = crate::cli::bundled_skills().iter().map(|b| b.0.to_string()).collect();
        assert!(bundled.contains(&"video".to_string()), "{bundled:?}");
        let mut c = ctx(&t);
        c.bundled = bundled.clone();
        c.repo = installer::OFFICIAL_REPO;
        let a = run(&req(false, |r| (r.all = true, r.dry_run = true)), &c, &f).unwrap();
        let line = a["command"].as_str().unwrap();
        assert!(line.starts_with("npx --yes skills add kolux/skills "), "{line}");
        let mut named: Vec<&str> = line.split(" --skill ").skip(1).map(|s| s.split(' ').next().unwrap()).collect();
        named.sort_unstable();
        let mut want: Vec<&str> = bundled.iter().map(String::as_str).collect();
        want.sort_unstable();
        assert_eq!(named, want);
        assert!(f.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn unknown_names_and_names_holding_shell_syntax_are_refused() {
        let t = temp("cli-names");
        let f = Fake::ok();
        for bad in ["nope", "a;b", "x y", "$(calc)", "orchestration,", ""] {
            assert!(run(&req(false, |r| (r.skill = Some(bad.into()), r.dry_run = true)), &ctx(&t), &f).is_err(), "{bad:?}");
        }
        assert_eq!(err(run(&req(false, |r| r.skill = Some("nope".into())), &ctx(&t), &f)).code, "not_found");
        assert!(f.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn agent_takes_a_comma_list_and_universal_aims_only_at_the_shared_folder() {
        let t = temp("cli-agent");
        let f = Fake::ok();
        let go = |a: &str| run(&req(false, |r| (r.skill = Some("orchestration".into()), r.agent = Some(a.into()), r.dry_run = true)), &ctx(&t), &f);
        assert_eq!(go("universal").unwrap()["agents"], json!(["universal"]));
        assert_eq!(go("claude,gemini-cli").unwrap()["agents"], json!(["claude-code", "gemini-cli"]));
        for bad in ["claude,,gemini", "claude, gemini", ",claude", "nonesuch"] {
            assert_eq!(err(go(bad)).code, "invalid_arguments", "{bad:?}");
        }
    }

    #[test]
    fn no_detected_ai_and_none_named_asks_for_an_agent() {
        let t = temp("cli-noai");
        let mut c = ctx(&t);
        c.detected.clear();
        let e = err(run(&req(false, |r| (r.skill = Some("orchestration".into()), r.dry_run = true)), &c, &Fake::ok()));
        assert!(e.message.contains("name an agent"));
        assert!(run(&req(false, |r| (r.skill = Some("orchestration".into()), r.agent = Some("universal".into()), r.dry_run = true)), &c, &Fake::ok()).is_ok());
    }

    #[test]
    fn local_drops_the_global_flag() {
        let t = temp("cli-local");
        let f = Fake::ok();
        let i = run(&req(false, |r| (r.skill = Some("orchestration".into()), r.local = true, r.dry_run = true)), &ctx(&t), &f).unwrap();
        assert!(i["command"].as_str().unwrap().ends_with("universal -y") && i["scope"] == "project", "{i}");
        let u = run(&req(true, |r| (r.skill = Some("orchestration".into()), r.local = true, r.dry_run = true)), &ctx(&t), &f).unwrap();
        assert_eq!(u["command"], "npx --yes skills update orchestration -y");
    }

    #[test]
    fn update_takes_only_installed_skills_and_no_agent_flag() {
        let t = temp("cli-update");
        let f = Fake::ok();
        let u = run(&req(true, |r| (r.skill = Some("orchestration".into()), r.dry_run = true)), &ctx(&t), &f).unwrap();
        assert_eq!(u["command"], "npx --yes skills update orchestration -y -g");
        assert_eq!(err(run(&req(true, |r| (r.skill = Some("kolux-cli".into()), r.dry_run = true)), &ctx(&t), &f)).code, "not_installed");
        assert_eq!(err(run(&req(true, |r| (r.skill = Some("koluxward".into()), r.dry_run = true)), &ctx(&t), &f)).code, "not_updatable");
        assert!(err(run(&req(true, |r| (r.skill = Some("orchestration".into()), r.agent = Some("claude".into()))), &ctx(&t), &f)).message.contains("--agent"));
        let o = run(&req(true, |_| ()), &ctx(&t), &f).unwrap();
        assert_eq!(o["skills"], json!(["orchestration"]));
        let mut none = ctx(&t);
        none.updatable.clear();
        assert_eq!(err(run(&req(true, |r| r.all = true), &none, &f)).code, "not_found");
        assert!(text(&run(&req(true, |_| ()), &none, &f).unwrap()).contains("Nothing is installed"));
    }

    #[test]
    fn a_real_run_goes_through_the_installer_under_the_lock_and_passes_its_exit_status_on() {
        let t = temp("cli-real");
        let f = Fake::ok();
        let r = run(&req(true, |r| r.skill = Some("orchestration".into())), &ctx(&t), &f).unwrap();
        assert_eq!((r["ran"].clone(), r["exitCode"].clone()), (json!(true), json!(0)));
        assert_eq!(text(&r), "installed it");
        assert_eq!(f.seen.lock().unwrap().as_slice(), ["npx --yes skills update orchestration -y -g"]);
        assert!(crate::skill_delete::lock(&t).is_ok(), "the lock was let go");
        // A failing installer: its status is in the error's data.
        let bad = Fake { seen: Mutex::new(vec![]), code: Some(3), err: None };
        let e = err(run(&req(true, |r| r.skill = Some("orchestration".into())), &ctx(&t), &bad));
        assert_eq!((e.code, e.data["exitCode"].clone()), ("installer_failed", json!(3)));
        assert_eq!(e.data["hint"], "installed it");
        assert!(e.message.contains("status 3"));
        // One that cannot start at all.
        let none = Fake { seen: Mutex::new(vec![]), code: None, err: Some("Node.js was not found".into()) };
        assert_eq!(err(run(&req(true, |r| r.skill = Some("orchestration".into())), &ctx(&t), &none)).code, "installer_unavailable");
        // Another skill change holds the lock.
        let held = crate::skill_delete::lock(&t).unwrap();
        assert_eq!(err(run(&req(true, |r| r.skill = Some("orchestration".into())), &ctx(&t), &f)).code, "busy");
        drop(held);
        assert_eq!(f.seen.lock().unwrap().len(), 1, "the refused runs never reached the installer");
    }

    #[test]
    fn json_is_refused_on_a_real_run_but_not_on_a_dry_run_or_a_listing() {
        let m = |v: Value| v.as_object().unwrap().clone();
        assert!(json_refusal("skills.install", &m(json!({ "skill": "orchestration", "json": true }))).unwrap().message.contains("--dry-run"));
        assert!(json_refusal("skills.update", &m(json!({ "all": true, "json": true }))).is_some());
        assert!(json_refusal("skills.install", &m(json!({ "skill": "orchestration", "dry-run": true, "json": true }))).is_none());
        assert!(json_refusal("skills.install", &m(json!({ "skill": "orchestration" }))).is_none(), "no --json, no refusal");
        assert!(json_refusal("skills.install", &m(json!({ "json": true }))).is_none());
        assert!(json_refusal("skills.get", &m(json!({ "all": true, "json": true }))).is_none());
        let r = req_of("skills.update", &m(json!({ "skill": "a", "all": true, "local": true, "dry-run": true, "agent": "x" })));
        assert!(r.update && r.all && r.local && r.dry_run && r.skill.as_deref() == Some("a") && r.agent.as_deref() == Some("x"));
    }
}
