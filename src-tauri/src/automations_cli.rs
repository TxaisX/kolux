//! CLI-028 / CLI-029 (AUTO-020): the `automations` command group. `list`, `show` and `runs` read
//! what the Automations page shows; `create`, `edit`, `remove` and `run` change it through the
//! same checks the page's dialog goes through, and the page follows along. An id is given bare
//! (`automations show auto-3`) or as `--id`. `--missed-run-grace-minutes` sets AUTO-007's grace
//! window (T-175), `--precheck` and `--precheck-timeout` (seconds) AUTO-008's precheck.
//! `--reuse-session` and `--fresh-session` (T-197-c) are AUTO-009's choice for an existing
//! worktree. AUTO-028 cuts source context. An automation saved with another host's name as its
//! owner (this Kolux has no hosts) shows as orphaned, can be read and removed but not edited or
//! run, and says how to recover (CLI-004, CLI-028, CLI-029).

use super::{pick_project, pick_worktree, Ctx, Fail, Request};
use super::args::switched_on;
use crate::automations;
use serde_json::{json, Map, Value};

const FIELDS: &[&str] = &["name", "trigger", "schedule", "time", "day", "timezone", "prompt", "provider", "repo", "workspace", "workspace-mode", "missed-run-grace-minutes", "precheck", "precheck-timeout", "reuse-session", "fresh-session", "enabled", "disabled"];
const EDIT: &[&str] = &["id", "name", "trigger", "schedule", "time", "day", "timezone", "prompt", "provider", "repo", "workspace", "workspace-mode", "missed-run-grace-minutes", "precheck", "precheck-timeout", "reuse-session", "fresh-session", "enabled", "disabled"];
pub(super) const COMMANDS: &[(&str, &str, &[&str])] = &[
    ("automations list", "automations.list", &[]),
    ("automations show", "automations.show", &["id"]),
    ("automations runs", "automations.runs", &["id", "limit"]),
    ("automations create", "automations.create", FIELDS),
    ("automations edit", "automations.edit", EDIT),
    ("automations remove", "automations.remove", &["id"]),
    ("automations run", "automations.run", &["id"]),
];
/// Every one of these is a timetable: anything else given to `--trigger` is a cron line or RRULE.
const PRESETS: &[&str] = &["hourly", "daily", "weekdays", "weekly"];

/// Checked before the app is asked, so a bad day or a clash of flags never reaches it.
pub(super) fn check(command: &str, flags: &Map<String, Value>) -> Result<Map<String, Value>, Fail> {
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim);
    if let Some(k) = flags.keys().find(|k| text(k).is_some_and(str::is_empty)) {
        return Err(Fail::args(format!("--{k} cannot be empty")));
    }
    let trigger = match (text("trigger"), text("schedule")) {
        (Some(a), Some(b)) if a != b => return Err(Fail::args("--schedule is another name for --trigger; give one of them")),
        (a, b) => a.or(b),
    };
    if command != "automations.list" && command != "automations.create" && text("id").is_none() {
        return Err(Fail::args("name the automation: its id, like auto-3, bare or as --id"));
    }
    if let Some(t) = text("time") {
        let ok = t.split_once(':').is_some_and(|(h, m)| m.len() == 2 && h.parse::<u8>().is_ok_and(|h| h < 24) && m.parse::<u8>().is_ok_and(|m| m < 60));
        if !ok {
            return Err(Fail::args(format!("--time takes HH:MM on a 24-hour clock, like 09:00, not {t}")));
        }
    }
    if let Some(d) = text("day") {
        if !d.parse::<u8>().is_ok_and(|d| d <= 6) {
            return Err(Fail::args(format!("--day takes 0 to 6, with Sunday as 0, not {d}")));
        }
    }
    if let Some(m) = text("workspace-mode") {
        if !["existing", "new-per-run"].contains(&m) {
            return Err(Fail::args("--workspace-mode takes existing or new-per-run"));
        }
    }
    if let Some(g) = text("missed-run-grace-minutes") {
        if !g.parse::<u64>().is_ok_and(|g| automations::GRACE_MINUTES.contains(&g)) {
            return Err(Fail::args("--missed-run-grace-minutes takes 0, 30, 60, 180, 720, 1440 or 2880"));
        }
    }
    if let Some(t) = text("precheck-timeout") {
        if !t.parse::<u64>().is_ok_and(|t| automations::PRECHECK_SECONDS.contains(&t)) {
            return Err(Fail::args("--precheck-timeout takes 60, 120, 300 or 600 seconds: a precheck may take 1, 2, 5 or 10 minutes"));
        }
    }
    if flags.contains_key("repo") && flags.contains_key("workspace") {
        return Err(Fail::args("give --repo or --workspace, not both"));
    }
    if switched_on(flags, "enabled") && switched_on(flags, "disabled") {
        return Err(Fail::args("give --enabled or --disabled, not both"));
    }
    // AUTO-009: one session across runs is for an existing worktree only; asking for both ways is
    // refused here, and a reuse that cannot apply is told before the app is contacted.
    if switched_on(flags, "reuse-session") && switched_on(flags, "fresh-session") {
        return Err(Fail::args("give --reuse-session or --fresh-session, not both"));
    }
    if switched_on(flags, "reuse-session") {
        let existing = text("workspace-mode") == Some("existing") || (text("workspace-mode").is_none() && flags.contains_key("workspace"));
        if text("workspace-mode") == Some("new-per-run") || (command == "automations.create" && !existing) {
            return Err(Fail::args("--reuse-session keeps one session in an existing worktree: give --workspace <selector> or --workspace-mode existing, not a new worktree for every run"));
        }
    }
    if let Some(l) = text("limit") {
        if !l.parse::<u64>().is_ok_and(|n| n > 0) {
            return Err(Fail::args("--limit takes a number above zero"));
        }
    }
    if command == "automations.create" {
        for (k, what) in [("name", ""), ("prompt", ": what the agent starts with")] {
            if text(k).is_none() {
                return Err(Fail::args(format!("--{k} is required{what}")));
            }
        }
        if trigger.is_none() {
            return Err(Fail::args("--trigger is required: hourly, daily, weekdays, weekly, a cron line or an RRULE"));
        }
    }
    if command == "automations.edit" && trigger.is_none() {
        if let Some(k) = ["time", "day", "timezone"].into_iter().find(|k| flags.contains_key(*k)) {
            return Err(Fail::args(format!("--{k} changes the timetable; give --trigger with it")));
        }
    }
    let mut args = Map::new();
    for (k, v) in flags {
        let key = match k.as_str() {
            "schedule" => "trigger",
            "workspace-mode" => "workspaceMode",
            "missed-run-grace-minutes" => "missedRunGraceMinutes",
            "precheck-timeout" => "precheckTimeoutSeconds",
            "reuse-session" | "fresh-session" => {
                // C26-R4-01: `=false` is off, so it says nothing about the choice at all.
                if v == &Value::Bool(false) {
                    continue;
                }
                args.insert("reuseSession".into(), json!(k == "reuse-session"));
                continue;
            }
            other => other,
        };
        args.insert(key.to_string(), v.clone());
    }
    Ok(args)
}

/// The timetable the flags describe, over `form` (what the automation had) on edit.
fn schedule(a: &Value, form: &Value, zone: &str) -> Value {
    let s = |k: &str| a[k].as_str().map(str::trim).map(String::from);
    let trigger = s("trigger").unwrap_or_default();
    let preset = if PRESETS.contains(&trigger.as_str()) { trigger.clone() } else { "custom".into() };
    let custom = if preset == "custom" { trigger } else { String::new() };
    let day = s("day").and_then(|d| d.parse::<u8>().ok()).map(Value::from).unwrap_or_else(|| form["day"].clone());
    let time = s("time").or_else(|| form["time"].as_str().filter(|t| !t.is_empty()).map(String::from)).unwrap_or_else(|| "09:00".into());
    json!({ "preset": preset, "time": time, "day": if day.is_null() { json!(1) } else { day }, "custom": custom, "timezone": s("timezone").unwrap_or_else(|| zone.to_string()) })
}

/// The saved automation `id`, as the page shows it.
fn find(ctx: &Ctx, id: &str) -> Result<Value, Fail> {
    let store = ctx.store.lock().map_err(|e| e.to_string())?;
    let all = automations::list(&store)?;
    all["automations"].as_array().and_then(|l| l.iter().find(|a| a["id"] == id)).cloned().ok_or_else(|| Fail { code: "not_found", message: format!("no automation is called {id}"), data: json!({ "hint": "kolux-dev automations list shows them" }) })
}

/// CLI-004: a value in a next-step command the way the current shell expects, so the line pastes
/// and runs as printed. A plain selector stays bare; Windows (PowerShell and cmd) takes double
/// quotes, anywhere else single quotes. A value holding a character a shell would act on even inside
/// quotes gives none: the caller leaves that step out rather than offer it unsafe.
pub(super) fn shell_word(v: &str, windows: bool) -> Option<String> {
    if !v.is_empty() && v.chars().all(|c| c.is_alphanumeric() || "-_.:/+".contains(c)) {
        return Some(v.to_string());
    }
    if v.is_empty() || v.chars().any(char::is_control) {
        return None;
    }
    if windows {
        (!v.chars().any(|c| "\";&|$<>^%`!".contains(c))).then(|| format!("\"{v}\""))
    } else {
        Some(format!("'{}'", v.replace('\'', "'\\''")))
    }
}

/// CLI-004: what to do about an automation another host owns, as commands that run as printed.
fn recovery(a: &Value, windows: bool) -> Vec<String> {
    let cli = crate::orchestration::CLI;
    let Some(id) = a["id"].as_str().and_then(|i| shell_word(i, windows)) else { return Vec::new() };
    let mut steps = vec![format!("{cli} automations show {id}"), format!("{cli} automations remove {id}")];
    if let Some(name) = a["name"].as_str().and_then(|n| shell_word(n, windows)) {
        steps.push(format!("{cli} automations create --name {name} --trigger <schedule> --prompt <text>"));
    }
    steps
}

/// The refusal for an automation another host owns: `code` owned_elsewhere (it was so when read)
/// or owner_conflict (it changed hands while an edit was being made).
fn elsewhere(code: &'static str, a: &Value, what: &str) -> Fail {
    let (id, name, owner) = (a["id"].as_str().unwrap_or_default(), a["name"].as_str().unwrap_or_default(), automations::owner_of(a));
    let steps = recovery(a, cfg!(windows));
    let message = if code == "owner_conflict" {
        format!("{id} ({name}) is owned by host {owner} now, not by the host the edit read it from; nothing was saved")
    } else {
        format!("{id} ({name}) is owned by host {owner}, and this Kolux has no such host, so it cannot be {what} here")
    };
    let hint = format!("to recover: remove it here and make it again, or leave it for {owner}\n  {}", steps.join("\n  "));
    Fail { code, message, data: json!({ "id": id, "owner": owner, "action": what, "steps": steps, "hint": hint }) }
}

/// Edits carry the owner they read: under the store lock, the automation must still exist and still
/// have that owner. A target that is gone is told plainly, with no retry to offer.
fn same_owner(store: &crate::state::Store, id: &str, read: &str) -> Result<(), Fail> {
    let all = automations::list(store)?;
    match all["automations"].as_array().and_then(|l| l.iter().find(|a| a["id"] == id)) {
        None => Err(Fail { code: "not_found", message: format!("{id} was removed while the edit was being made; nothing was saved"), data: json!({}) }),
        Some(now) if automations::owner_of(now) != read => Err(elsewhere("owner_conflict", now, "edited")),
        Some(_) => Ok(()),
    }
}

/// A row as the command line prints it: the page's fields plus the project's name, the owning host
/// and, for a host this Kolux does not have, that it is orphaned and why (reading never needs the
/// host to exist).
fn row(ctx: &Ctx, a: &Value) -> Value {
    let mut a = a.clone();
    let project = ctx.store.lock().ok().and_then(|s| crate::projects::load_projects(&s).into_iter().find(|p| a["projectId"] == p.id.as_str()));
    a["project"] = json!(project.map(|p| p.name));
    let owner = automations::owner_of(&a).to_string();
    let orphaned = owner != automations::LOCAL_HOST;
    a["host"] = json!(owner);
    a["orphaned"] = json!(orphaned);
    if orphaned {
        a["orphanedWhy"] = json!(format!("host {owner} is not part of this Kolux, so nothing here can run it"));
        a["recovery"] = json!(recovery(&a, cfg!(windows)));
    }
    if let Some(o) = a.as_object_mut() {
        o.remove("requestId");
    }
    a
}

/// Tells the Automations page to read the list again.
fn changed(ctx: &Ctx, id: &str) {
    (ctx.notify)(json!({ "emit": automations::EVENT, "payload": { "id": id } }));
}

pub(super) fn dispatch(ctx: &Ctx, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let id = text("id").unwrap_or_default();
    match req.command.as_str() {
        "automations.list" => {
            let all = {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                automations::list(&store)?
            };
            let rows: Vec<Value> = all["automations"].as_array().cloned().unwrap_or_default().iter().map(|x| row(ctx, x)).collect();
            Ok(json!({ "automations": rows, "runsError": all["runsError"] }))
        }
        "automations.show" => {
            let one = row(ctx, &find(ctx, &id)?);
            let all = automations::list(&*ctx.store.lock().map_err(|e| e.to_string())?)?;
            let runs = all["runs"].as_array().map(|r| r.iter().filter(|r| r["automationId"] == id.as_str()).count());
            Ok(json!({ "automation": one, "runs": if all["runsError"].is_null() { json!(runs) } else { Value::Null } }))
        }
        "automations.runs" => {
            find(ctx, &id)?;
            let all = automations::list(&*ctx.store.lock().map_err(|e| e.to_string())?)?;
            if let Some(e) = all["runsError"].as_str() {
                return Err(Fail::new("failed", e.to_string()));
            }
            let mut runs: Vec<Value> = all["runs"].as_array().cloned().unwrap_or_default().into_iter().filter(|r| r["automationId"] == id.as_str()).collect();
            runs.sort_by_key(|r| std::cmp::Reverse(r["number"].as_u64().unwrap_or(0)));
            runs.truncate(text("limit").and_then(|l| l.parse().ok()).unwrap_or(usize::MAX));
            Ok(json!({ "id": id, "runs": runs }))
        }
        "automations.create" | "automations.edit" => {
            let old = if req.command == "automations.edit" { Some(find(ctx, &id)?) } else { None };
            if let Some(o) = old.as_ref().filter(|o| automations::owner_of(o) != automations::LOCAL_HOST) {
                return Err(elsewhere("owned_elsewhere", o, "edited"));
            }
            let mut input = json!({ "requestId": if old.is_some() { String::new() } else { req.id.clone() } });
            if let Some(o) = &old {
                for k in ["id", "name", "prompt", "provider", "projectId", "workspaceMode", "workspace", "baseBranch", "missedRunGraceMinutes", "enabled"] {
                    input[k] = o[k].clone();
                }
            }
            for k in ["name", "prompt", "provider", "missedRunGraceMinutes", "precheck", "precheckTimeoutSeconds"] {
                if let Some(v) = text(k) {
                    input[k] = json!(v);
                }
            }
            // The target: the worktree it was run in, unless --repo or --workspace says otherwise;
            // a new worktree for every run unless asked (--workspace alone means that one).
            let retarget = old.is_none() || ["repo", "workspace", "workspaceMode"].iter().any(|k| text(k).is_some());
            if retarget {
                let (project, here) = match (text("workspace"), text("repo")) {
                    (Some(sel), _) => pick_worktree(ctx, &sel, &req.cwd).map(|(p, w)| (p, Some(w.path)))?,
                    (None, Some(sel)) => (pick_project(ctx, Some(&sel), &req.cwd)?, None),
                    (None, None) if old.is_some() => (pick_project(ctx, Some(&format!("id:{}", input["projectId"].as_str().unwrap_or_default())), &req.cwd)?, input["workspace"].as_str().map(String::from)),
                    (None, None) => pick_worktree(ctx, "current", &req.cwd).map(|(p, w)| (p, Some(w.path)))?,
                };
                let mode = text("workspaceMode").unwrap_or_else(|| if text("workspace").is_some() { "existing".into() } else { "new-per-run".into() });
                input["projectId"] = json!(project.id);
                input["workspace"] = json!(if mode == "existing" { here.unwrap_or_default() } else { String::new() });
                input["workspaceMode"] = json!(mode);
            }
            if let Some(b) = a["reuseSession"].as_bool() {
                input["reuseSession"] = json!(b);
            }
            let form = old.as_ref().map(|o| o["form"].clone()).unwrap_or(Value::Null);
            let zone = old.as_ref().and_then(|o| o["trigger"]["timezone"].as_str()).unwrap_or("").to_string();
            input["schedule"] = if text("trigger").is_some() {
                schedule(a, &form, &zone)
            } else {
                // Unchanged: the timetable it had, read back as the page reads it.
                json!({ "preset": form["preset"], "time": form["time"], "day": form["day"], "custom": if form["preset"] == "custom" { old.as_ref().map(|o| o["trigger"]["cron"].clone()).unwrap_or_default() } else { json!("") }, "timezone": zone })
            };
            // C26-R4-01: an explicit value is a choice either way: `--enabled=false` disables and
            // `--disabled=false` enables; a switch left out changes nothing.
            if let Some(on) = a["enabled"].as_bool() {
                input["enabled"] = json!(on);
            } else if let Some(off) = a["disabled"].as_bool() {
                input["enabled"] = json!(!off);
            }
            let saved = {
                let store = ctx.store.lock().map_err(|e| e.to_string())?;
                if let Some(o) = &old {
                    same_owner(&store, &id, automations::owner_of(o))?;
                }
                automations::save_automation(&store, &input, automations::now_ms() as i64)?
            };
            changed(ctx, saved["id"].as_str().unwrap_or_default());
            Ok(row(ctx, &saved))
        }
        "automations.remove" => {
            let gone = find(ctx, &id)?;
            automations::delete(&*ctx.store.lock().map_err(|e| e.to_string())?, &id)?;
            changed(ctx, &id);
            Ok(json!({ "id": id, "name": gone["name"], "removed": true }))
        }
        "automations.run" => {
            let one = find(ctx, &id)?;
            if automations::owner_of(&one) != automations::LOCAL_HOST {
                return Err(elsewhere("owned_elsewhere", &one, "run"));
            }
            let installed = |agent: &str| crate::agents::agent_list().iter().any(|x| x.id == agent && x.installed);
            let notify = |event: &str, v: Value| {
                if event == super::EVENT {
                    (ctx.notify)(v)
                } else {
                    (ctx.notify)(json!({ "emit": event, "payload": v }))
                }
            };
            let launch = automations::Launch { git: ctx.git, store: ctx.store, claude_config: ctx.claude_config.clone(), installed: &installed, notify: &notify };
            Ok(automations::run_manual(&launch, &id)?)
        }
        other => Err(Fail::args(format!("unknown command {other}"))),
    }
}

/// What a success looks like without `--json`.
pub(super) fn text(command: &str, r: &Value) -> Option<String> {
    let s = |v: &Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    let line = |a: &Value| {
        let target = if a["workspaceMode"] == "existing" { format!("in {}", s(a, "workspace")) } else { "a new worktree every run".into() };
        let state = if a["enabled"] == true { a["nextRunLabel"].as_str().map(|n| format!("next {n}")).unwrap_or_else(|| "on".into()) } else { "paused".into() };
        let session = if a["reuseSession"] == true { " · keeps one session across runs" } else { "" };
        let orphan = if a["orphaned"] == true { format!(" · ORPHANED: {}", s(a, "orphanedWhy")) } else { String::new() };
        format!("{}  {}  {} · {} · {} ({}){} · host {} · {}{}", s(a, "id"), s(a, "name"), a["timetable"].as_str().unwrap_or("waits for events"), s(a, "provider"), a["project"].as_str().unwrap_or("project gone"), target, session, s(a, "host"), state, orphan)
    };
    let run = |r: &Value| format!("#{}  {}  {}{}", r["number"], s(r, "trigger"), s(r, "status"), r["detail"].as_str().or(r["cause"].as_str()).map(|d| format!(" ({d})")).unwrap_or_default());
    Some(match command {
        "automations.list" => {
            let rows = r["automations"].as_array().cloned().unwrap_or_default();
            if rows.is_empty() {
                "no automations yet; make one with kolux-dev automations create".into()
            } else {
                rows.iter().map(line).collect::<Vec<_>>().join("\n")
            }
        }
        "automations.show" => format!("{}\nruns: {}\nprompt:\n{}", line(&r["automation"]), r["runs"].as_u64().map(|n| n.to_string()).unwrap_or_else(|| "unknown (the run history could not be read)".into()), s(&r["automation"], "prompt")),
        "automations.runs" => {
            let rows = r["runs"].as_array().cloned().unwrap_or_default();
            if rows.is_empty() {
                format!("{} has not run yet", s(r, "id"))
            } else {
                rows.iter().map(run).collect::<Vec<_>>().join("\n")
            }
        }
        "automations.create" | "automations.edit" => format!("saved {}", line(r)),
        "automations.remove" => format!("removed {} ({})", s(r, "id"), s(r, "name")),
        "automations.run" => format!("started {}", run(r)),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::super::{dispatch as app, parse, Ctx, Request};
    use crate::git::Git;
    use crate::state::Store;
    use crate::terminal::Terminals;
    use serde_json::{json, Value};
    use std::path::Path;
    use std::process::Command;
    use std::sync::Mutex;

    fn words(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn automation_flags_are_checked_before_the_app_is_asked() {
        let ok = |s: &str| parse(&words(s)).1.unwrap().unwrap();
        let refused = |s: &str| parse(&words(s)).1.unwrap_err().message;
        // An id bare or by flag.
        let p = ok("automations show auto-3");
        assert_eq!((p.command.as_str(), &p.args["id"]), ("automations.show", &json!("auto-3")));
        assert_eq!(ok("automations runs --id auto-3 --limit 5").args["id"], "auto-3");
        assert!(refused("automations show auto-3 --id auto-4").contains("twice"));
        assert!(refused("automations remove").contains("auto-3"));
        // --schedule is --trigger.
        assert_eq!(ok("automations create --name r --schedule daily --time 09:00 --prompt review --provider claude").args["trigger"], "daily");
        assert!(refused("automations create --name r --trigger daily --schedule weekly --prompt p").contains("another name"));
        assert!(refused("automations create --name r --prompt p").contains("--trigger is required"));
        assert!(refused("automations create --trigger daily --prompt p").contains("--name"));
        // CLI-029: a bad day never reaches the app, and modifiers need a schedule on edit.
        assert!(refused("automations edit auto-1 --day 7").contains("0 to 6"));
        assert!(refused("automations edit auto-1 --time 09:00").contains("give --trigger"));
        assert!(refused("automations create --name r --trigger daily --time 9:5 --prompt p").contains("HH:MM"));
        assert!(refused("automations create --name r --trigger daily --time 24:00 --prompt p").contains("HH:MM"));
        assert!(refused("automations create --name r --trigger daily --prompt p --repo name:a --workspace name:b").contains("not both"));
        assert!(refused("automations create --name r --trigger daily --prompt p --enabled --disabled").contains("not both"));
        assert!(refused("automations create --name r --trigger daily --prompt p --workspace-mode sometimes").contains("existing or new-per-run"));
        assert_eq!(ok("automations edit auto-1 --trigger weekly --day 0 --disabled").args["disabled"], true);
        assert!(refused("automations frobnicate").contains("unknown command"));
        // AUTO-008's limit, in seconds: the dialog's 1, 2, 5 or 10 minutes and nothing else.
        let pc = parse(&["automations", "create", "--name", "r", "--trigger", "daily", "--prompt", "p", "--precheck", "git diff --quiet", "--precheck-timeout", "300"].map(String::from)).1.unwrap().unwrap();
        assert_eq!((&pc.args["precheck"], &pc.args["precheckTimeoutSeconds"]), (&json!("git diff --quiet"), &json!("300")));
        assert!(refused("automations edit auto-1 --precheck-timeout 90").contains("60, 120, 300 or 600"));
        assert!(refused("automations edit auto-1 --precheck-timeout 900").contains("10 minutes"));
        // AUTO-028 cuts source context.
        assert!(parse(&words("automations create --name r --trigger daily --prompt p --source-context {}")).1.is_err());
        for (name, _, _) in super::COMMANDS {
            assert!(super::super::HELP.contains(&format!("kolux-dev {name} ")), "{name} has no help line");
        }
    }

    /// C26-R4-01: an automation switch written `=false` is off. `--reuse-session=false` must not save
    /// a reuse, `--enabled=false` must really disable, `--disabled=false` must enable, and a false
    /// switch must not clash with its pair.
    #[test]
    fn c26r4_01_automation_switches_written_false_are_off() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-autocli-c26r401-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&repo).output().unwrap().status.success(), "{args:?}");
        git(&["init", "-q", "-b", "main"]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"]);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        crate::projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let call = |line: &str| {
            let p = parse(&words(line)).1.unwrap().unwrap();
            app(&ctx, &Request { id: format!("r-{line}"), token: String::new(), command: p.command, cwd: repo.display().to_string(), args: Value::Object(p.args), pane: None, cli: crate::cli::VERSION.into(), arrived: None })
        };
        let made = call("automations create --name r --trigger daily --prompt p --provider claude --workspace-mode existing --reuse-session=false").unwrap();
        assert_eq!(made["reuseSession"], json!(false), "a false reuse-session never saves a reuse");
        let id = made["id"].as_str().unwrap().to_string();
        assert_eq!(call(&format!("automations edit {id} --enabled=false")).unwrap()["enabled"], json!(false), "a false enabled disables");
        assert_eq!(call(&format!("automations edit {id} --disabled=false")).unwrap()["enabled"], json!(true), "a false disabled enables");
        // a false switch is off for the clash guard too, so its pair may be given
        assert_eq!(call(&format!("automations edit {id} --enabled=false --disabled")).unwrap()["enabled"], json!(false));
        assert_eq!(call(&format!("automations edit {id} --reuse-session=false --fresh-session")).unwrap()["reuseSession"], json!(false));
        drop(ctx);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// T-197-c: a store with one project (a throwaway repo) and the command line over it.
    fn with_cli(tag: &str, f: impl FnOnce(&Ctx, &Mutex<Store>, &Path, &dyn Fn(&str, Value) -> Result<Value, super::Fail>)) {
        let dir = std::env::temp_dir().join(format!("kolux-rs-autocli-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&repo).output().unwrap().status.success(), "{args:?}");
        git(&["init", "-q", "-b", "main"]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"]);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        crate::projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        let notify = |_: Value| {};
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        // The flags go through the same check the parser applies, then to the app.
        let call = |command: &str, flags: Value| {
            let args = super::check(command, flags.as_object().unwrap())?;
            app(&ctx, &Request { id: format!("r-{command}-{flags}"), token: String::new(), command: command.into(), cwd: repo.display().to_string(), args: Value::Object(args), pane: None, cli: crate::cli::VERSION.into(), arrived: None })
        };
        f(&ctx, &store, &repo, &call);
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn t197c_reuse_and_fresh_session_flags() {
        with_cli("reuse", |_, _, _, call| {
            let base = json!({ "name": "r", "trigger": "daily", "prompt": "review", "provider": "claude", "timezone": "UTC" });
            let with = |extra: Value| {
                let mut m = base.clone();
                for (k, v) in extra.as_object().unwrap() {
                    m[k] = v.clone();
                }
                m
            };
            // CLI-029: both ways at once, or a reuse with a new worktree for every run, is refused
            // before the app is asked.
            let refused = |c: &str, f: Value| call(c, f).unwrap_err();
            let both = refused("automations.create", with(json!({ "reuse-session": true, "fresh-session": true, "workspace-mode": "existing" })));
            assert!(both.message.contains("not both") && both.code == "invalid_arguments", "{}", both.message);
            assert!(refused("automations.create", with(json!({ "reuse-session": true, "workspace-mode": "new-per-run" }))).message.contains("existing worktree"));
            assert!(refused("automations.create", with(json!({ "reuse-session": true }))).message.contains("--workspace"), "a new worktree is the default, so a bare reuse is told how");
            assert!(refused("automations.edit", json!({ "id": "auto-1", "reuse-session": true, "workspace-mode": "new-per-run" })).message.contains("existing worktree"));
            let made = call("automations.create", with(json!({ "reuse-session": true, "workspace-mode": "existing" }))).unwrap();
            let id = made["id"].as_str().unwrap().to_string();
            assert_eq!((&made["reuseSession"], &made["workspaceMode"]), (&json!(true), &json!("existing")));
            assert!(super::text("automations.create", &made).unwrap().contains("keeps one session across runs"));
            // An edit that says nothing keeps the choice; --fresh-session turns it off; a plain create is off.
            assert_eq!(call("automations.edit", json!({ "id": id, "name": "renamed" })).unwrap()["reuseSession"], json!(true));
            let fresh = call("automations.edit", json!({ "id": id, "fresh-session": true })).unwrap();
            assert_eq!((&fresh["reuseSession"], &fresh["name"]), (&json!(false), &json!("renamed")));
            assert!(!super::text("automations.edit", &fresh).unwrap().contains("keeps one session"));
            assert_eq!(call("automations.edit", json!({ "id": id, "reuse-session": true })).unwrap()["reuseSession"], json!(true));
            // Back to a new worktree for every run on a reuse automation: the back end drops the reuse.
            let moved = call("automations.edit", json!({ "id": id, "workspace-mode": "new-per-run" })).unwrap();
            assert_eq!((&moved["workspaceMode"], &moved["reuseSession"]), (&json!("new-per-run"), &json!(false)));
            // A new-worktree automation asked to reuse without changing its mode is refused by the back end.
            assert_eq!(call("automations.edit", json!({ "id": id, "reuse-session": true })).unwrap_err().code, "failed");
            assert_eq!(call("automations.create", with(json!({}))).unwrap()["reuseSession"], json!(false));
        });
    }

    #[test]
    fn t197c_an_automation_owned_by_another_host_is_orphaned_and_says_how_to_recover() {
        with_cli("owner", |ctx, store, repo, call| {
            let base = json!({ "name": "nightly check", "trigger": "daily", "prompt": "review", "provider": "claude", "timezone": "UTC" });
            let id = call("automations.create", base.clone()).unwrap()["id"].as_str().unwrap().to_string();
            // Made here: owned here, not orphaned, no recovery to offer.
            let mine = call("automations.show", json!({ "id": id })).unwrap();
            assert_eq!((&mine["automation"]["host"], &mine["automation"]["orphaned"], mine["automation"]["recovery"].is_null()), (&json!("local"), &json!(false), true));
            // The same automation saved under a host this Kolux has not got.
            let own = |host: Option<&str>| {
                let s = store.lock().unwrap();
                let mut all: Vec<Value> = serde_json::from_str(&s.get(crate::automations::KEY).unwrap().unwrap()).unwrap();
                all[0]["ownerHost"] = host.map(|h| json!(h)).unwrap_or(Value::Null);
                s.set(crate::automations::KEY, &Value::Array(all).to_string()).unwrap();
            };
            own(Some("build-box"));
            // CLI-028: reading never needs the host; the row says orphaned and why, with the way out.
            let l = call("automations.list", json!({})).unwrap();
            let row = &l["automations"][0];
            assert_eq!((&row["host"], &row["orphaned"]), (&json!("build-box"), &json!(true)));
            assert!(row["orphanedWhy"].as_str().unwrap().contains("build-box"), "{row}");
            let steps: Vec<&str> = row["recovery"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
            assert!(steps.iter().any(|s| s.ends_with(&format!("automations remove {id}"))), "{steps:?}");
            assert!(steps.iter().any(|s| s.contains("automations create --name")), "{steps:?}");
            let line = super::text("automations.list", &l).unwrap();
            assert!(line.contains("host build-box") && line.contains("ORPHANED"), "{line}");
            assert!(call("automations.runs", json!({ "id": id })).is_ok(), "its runs are readable");
            // CLI-029: edit and run are turned away with the owner and the steps; nothing changes.
            for (cmd, what, flags) in [("automations.edit", "edited", json!({ "id": id, "name": "x" })), ("automations.run", "run", json!({ "id": id }))] {
                let e = call(cmd, flags).unwrap_err();
                assert_eq!(e.code, "owned_elsewhere", "{cmd}: {}", e.message);
                assert_eq!((&e.data["owner"], &e.data["action"], e.data["steps"].as_array().map(Vec::len)), (&json!("build-box"), &json!(what), Some(3)), "{cmd}");
                assert!(e.data["hint"].as_str().unwrap().contains("to recover"));
            }
            assert_eq!(call("automations.show", json!({ "id": id })).unwrap()["automation"]["name"], json!("nightly check"));
            // A timed run does not start it either: it is logged skipped, saying why.
            let yes = |_: &str| true;
            let quiet = |_: &str, _: Value| {};
            let launch = crate::automations::Launch { git: ctx.git, store, claude_config: repo.join("c.json"), installed: &yes, notify: &quiet };
            let skipped = crate::automations::run(&launch, &id, "schedule").unwrap();
            assert_eq!((&skipped["status"], &skipped["cause"]), (&json!("skipped"), &json!("unavailable")));
            assert!(skipped["detail"].as_str().unwrap().contains("build-box"), "{skipped}");
            // Edits carry the owner they read: the same owner passes; another owner is a conflict that
            // explains itself; a removed target is told plainly with no steps to retry.
            assert!(super::same_owner(&store.lock().unwrap(), &id, "build-box").is_ok());
            let c = super::same_owner(&store.lock().unwrap(), &id, "local").unwrap_err();
            assert_eq!((c.code, c.data["owner"].clone()), ("owner_conflict", json!("build-box")));
            assert!(c.message.contains("nothing was saved") && !c.data["steps"].as_array().unwrap().is_empty());
            own(None);
            assert!(super::same_owner(&store.lock().unwrap(), &id, "local").is_ok(), "an owner that is back is the one it was");
            // Remove works on an orphan (and on a local one): it is the way out.
            own(Some("build-box"));
            assert_eq!(call("automations.remove", json!({ "id": id })).unwrap()["removed"], true);
            let gone = super::same_owner(&store.lock().unwrap(), &id, "build-box").unwrap_err();
            assert_eq!(gone.code, "not_found");
            assert!(gone.message.contains("removed") && gone.data.as_object().unwrap().is_empty(), "no retry is offered for a target that is gone");
        });
    }

    #[test]
    fn t197c_next_step_values_are_quoted_the_way_the_shell_expects() {
        use super::shell_word as w;
        // Plain selectors stay bare in every shell.
        for plain in ["auto-3", "name:repo", "C:/work/a.b", "1.2+3"] {
            assert_eq!((w(plain, true).as_deref(), w(plain, false).as_deref()), (Some(plain), Some(plain)));
        }
        // A space needs quotes: double for PowerShell and cmd, single elsewhere.
        assert_eq!(w("nightly check", true).as_deref(), Some("\"nightly check\""));
        assert_eq!(w("nightly check", false).as_deref(), Some("'nightly check'"));
        // `@` and `,` are acted on by PowerShell outside quotes, so they are quoted too.
        assert_eq!(w("a@b,c", true).as_deref(), Some("\"a@b,c\""));
        // A single quote inside is closed, escaped and reopened for sh; fine inside double quotes.
        assert_eq!(w("it's", false).as_deref(), Some("'it'\\''s'"));
        assert_eq!(w("it's", true).as_deref(), Some("\"it's\""));
        // A character the Windows shells act on even inside quotes (quote, ; & | $ < > ^ % ` !) gives
        // none; so does an empty value or a line break.
        for bad in ["a\"b", "a;b", "a&b", "a|b", "$HOME", "a>b", "50%", "a^b", "a`b", "hi!"] {
            assert_eq!(w(bad, true), None, "{bad}");
        }
        assert_eq!((w("", true), w("", false), w("a\nb", true), w("a\nb", false)), (None, None, None, None));
        assert_eq!(w("$HOME", false).as_deref(), Some("'$HOME'"), "single quotes stop sh's expansion");
        // The recovery steps use it: a name with a space is quoted, one with a `;` leaves that step out.
        let a = json!({ "id": "auto-3", "name": "nightly check" });
        let steps = super::recovery(&a, true);
        assert!(steps.iter().any(|s| s.contains("--name \"nightly check\"")), "{steps:?}");
        assert_eq!(super::recovery(&json!({ "id": "auto-3", "name": "a;b" }), true).len(), 2);
        assert!(super::recovery(&json!({ "id": "a b;c", "name": "n" }), true).is_empty());
    }

    #[test]
    fn automations_are_made_changed_listed_and_removed_from_the_command_line() {
        let dir = std::env::temp_dir().join(format!("kolux-rs-autocli-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&repo).output().unwrap().status.success(), "{args:?}");
        git(&["init", "-q", "-b", "main"]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"]);
        let git_ = Git::detect().unwrap();
        let store = Mutex::new(Store::open(&dir.join("data")).unwrap());
        crate::projects::add_project(&git_, &store.lock().unwrap(), &repo).unwrap();
        let seen = Mutex::new(Vec::<Value>::new());
        let notify = |v: Value| seen.lock().unwrap().push(v);
        let terminals = Terminals::default();
        let ctx = Ctx { claude_config: dir.join(".claude.json"), git: &git_, store: &store, terminals: &terminals, notify: &notify, front: &|| Ok(()) };
        let call_words = |w: Vec<String>, cwd: &Path| {
            let p = parse(&w).1.unwrap().unwrap();
            app(&ctx, &Request { id: format!("r-{}", w.join(" ")), token: String::new(), command: p.command, cwd: cwd.display().to_string(), args: Value::Object(p.args), pane: None, cli: crate::cli::VERSION.into(), arrived: None })
        };
        let call = |line: &str, cwd: &Path| call_words(words(line), cwd);

        // CLI-029's example: a daily 9:00 automation in the repo it was run in, a new worktree each run.
        let made = call("automations create --name r --trigger daily --time 09:00 --prompt review --provider claude --timezone UTC", &repo).unwrap();
        let id = made["id"].as_str().unwrap().to_string();
        assert_eq!((&made["trigger"]["cron"], &made["workspaceMode"], &made["host"], &made["enabled"]), (&json!("0 9 * * *"), &json!("new-per-run"), &json!("local"), &json!(true)));
        assert_eq!(made["project"], "repo");
        assert!(seen.lock().unwrap().iter().any(|v| v["emit"] == crate::automations::EVENT), "the page is told");

        // Edit: the timetable with its modifiers; the rest is kept.
        let ed = call(&format!("automations edit {id} --trigger weekly --day 2 --time 10:30 --disabled"), &repo).unwrap();
        assert_eq!((&ed["trigger"]["cron"], &ed["trigger"]["timezone"], &ed["enabled"], &ed["prompt"]), (&json!("30 10 * * 2"), &json!("UTC"), &json!(false), &json!("review")));
        let ed = call(&format!("automations edit {id} --name renamed --workspace-mode existing"), &repo).unwrap();
        assert_eq!((&ed["name"], &ed["trigger"]["cron"], &ed["workspaceMode"]), (&json!("renamed"), &json!("30 10 * * 2"), &json!("existing")));
        assert!(Path::new(ed["workspace"].as_str().unwrap()).ends_with("repo"), "{ed}");
        // AUTO-007's grace window; anything off the list is refused before the app is asked.
        let g = call(&format!("automations edit {id} --missed-run-grace-minutes 30"), &repo).unwrap();
        assert_eq!((&g["missedRunGraceMinutes"], &g["name"]), (&json!(30), &json!("renamed")));
        assert!(parse(&words("automations edit auto-1 --missed-run-grace-minutes 45")).1.is_err());
        // AUTO-008's precheck and its limit; an edit that leaves them out keeps them.
        let pc = call_words(["automations", "edit", &id, "--precheck", "exit 1", "--precheck-timeout", "120"].map(String::from).to_vec(), &repo).unwrap();
        assert_eq!((&pc["precheck"], &pc["precheckTimeoutSeconds"]), (&json!("exit 1"), &json!(120)));
        assert_eq!(call(&format!("automations edit {id} --name renamed"), &repo).unwrap()["precheck"], json!("exit 1"));
        // A cron line is a timetable too.
        assert_eq!(call(&format!("automations edit {id} --trigger */15 --enabled"), &repo).unwrap_err().code, "failed");
        let cron = call_words(["automations", "edit", &id, "--trigger", "0 9 * * 1-5"].map(String::from).to_vec(), &repo).unwrap();
        assert_eq!((&cron["trigger"]["cron"], &cron["enabled"]), (&json!("0 9 * * 1-5"), &json!(false)));

        // list, show and runs read what the page shows.
        let l = call("automations list", &dir).unwrap();
        assert_eq!(l["automations"].as_array().unwrap().len(), 1);
        assert_eq!(l["automations"][0]["id"], id.as_str());
        let sh = call(&format!("automations show {id}"), &dir).unwrap();
        assert_eq!((&sh["automation"]["name"], &sh["runs"]), (&json!("renamed"), &json!(0)));
        assert_eq!(call(&format!("automations runs {id}"), &dir).unwrap()["runs"], json!([]));
        // CLI-028: a timed run the precheck stopped is listed as skipped, with its exit code.
        let yes = |_: &str| true;
        let quiet = |_: &str, _: Value| {};
        let launch = crate::automations::Launch { git: &git_, store: &store, claude_config: dir.join(".claude.json"), installed: &yes, notify: &quiet };
        assert_eq!(crate::automations::run(&launch, &id, "schedule").unwrap()["cause"], json!("precheck"));
        let runs = call(&format!("automations runs {id}"), &dir).unwrap();
        assert_eq!((&runs["runs"][0]["status"], &runs["runs"][0]["exitCode"]), (&json!("skipped"), &json!(1)));
        assert!(super::text("automations.runs", &runs).unwrap().contains("exit code 1"), "{runs}");
        assert!(super::text("automations.list", &l).unwrap().contains("host local"));
        assert_eq!(call("automations show auto-99", &dir).unwrap_err().code, "not_found");

        // Outside every project, create needs --repo; remove then empties the list.
        assert_eq!(call("automations create --name x --trigger daily --prompt p --provider claude", &dir).unwrap_err().code, "not_found");
        assert_eq!(call(&format!("automations remove {id}"), &dir).unwrap()["removed"], true);
        assert_eq!(call("automations list", &dir).unwrap()["automations"], json!([]));
        drop(ctx);
        drop(store);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_command_line_run_is_refused_while_the_same_automation_is_still_running() {
        with_cli("busy", |_, store, _, call| {
            let made = call("automations.create", json!({ "name": "r", "trigger": "daily", "prompt": "review", "provider": "claude", "timezone": "UTC" })).unwrap();
            let id = made["id"].as_str().unwrap();
            // A run of it is still going (as if the window's Run now had just started it).
            let busy = json!([{ "id": "run-1", "automationId": id, "number": 1, "status": "dispatched", "terminal": "pane-1" }]);
            store.lock().unwrap().set(crate::automations::RUNS_KEY, &busy.to_string()).unwrap();
            let why = call("automations.run", json!({ "id": id })).unwrap_err().message;
            assert!(why.contains("already running") && why.contains("#1"), "{why}");
            let runs = store.lock().unwrap().get(crate::automations::RUNS_KEY).unwrap().unwrap();
            assert_eq!(serde_json::from_str::<Value>(&runs).unwrap().as_array().unwrap().len(), 1, "no second run was made");
        });
    }
}
