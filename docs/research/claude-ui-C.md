# Claude usage UI: clean-room note (wave UI lane C, T-646)

Clean-room note from public docs only, dated 2026-11-02, for wave UI lane C (T-646).
Sources: public documentation and help pages read as a user would. No app code,
bundles, assets or strings were inspected. Everything below is paraphrased.

## 1. What Anthropic's products show

### Claude Code: /usage (session block)
- A per-session block lists total cost, API time versus wall-clock time, lines added
  and removed, and a per-model token breakdown (input, output, cache read, cache write,
  each with its own dollar figure). https://code.claude.com/docs/en/costs
- Cost caveat: the dollar figure is computed on the user's machine from token counts
  at list price. The docs call it an estimate and point to the Console usage page for
  authoritative billing. If an admin configured contracted rates, the line carries a
  short note saying so. https://code.claude.com/docs/en/costs
- Subscribers are told the session dollar figure is not relevant to billing, since
  usage is included in the plan. They see plan bars instead.
  https://code.claude.com/docs/en/costs
- Totals reset when a new session starts after a clear, so "session" is the unit.
  https://code.claude.com/docs/en/costs
- A one-line cache summary covers request count, share of input served from cache,
  misses, and whether the cache is warm or cold (with idle time).
  https://code.claude.com/docs/en/costs

### Claude Code: /usage (plan view)
- Plan bars for the rolling five-hour and weekly windows, plus a usage-credits row
  (spend this month against a user-set limit). https://code.claude.com/docs/en/costs
- An attribution list: share of recent usage by skill, subagent, plugin and tool
  server, as percentages. A toggle switches the window between last 24 hours and
  last 7 days. https://code.claude.com/docs/en/costs
- Recommendation rows, each led by "what share of your usage this applies to"; the
  docs stress that this is applicability, not savings. https://code.claude.com/docs/en/costs
- Honesty about staleness: if the fetch fails, the last known bars are shown with a
  "last-known" note and age, and a retry key. Figures are approximate and local-only
  (other devices are not counted). https://code.claude.com/docs/en/costs

### Claude Code: live signals and reports
- Beside the spinner: elapsed time plus an approximate, live output-token count for
  the current turn only; it resets each turn. https://code.claude.com/docs/en/costs
- /insights writes a report on how you work (friction, suggestions) from recent
  sessions rather than counting tokens. https://code.claude.com/docs/en/costs

### Claude Code: status line
- A persistent bar fed with session data: estimated cost, wall time, API time, lines
  changed, context-window use, session id, and (subscribers only, after first reply)
  percent used and reset time for the five-hour and seven-day windows. Windows can be
  individually absent and are dropped once their reset passes.
  https://code.claude.com/docs/en/statusline
- Refresh model: event-driven, batched with a 300 ms debounce, optional fixed timer
  for idle periods, and a refresh when a limit window reaches its reset time.
  https://code.claude.com/docs/en/statusline
- Docs again flag the cost field as possibly different from the real bill.
  https://code.claude.com/docs/en/statusline

### Claude apps: plan limits
- Usage lives in a settings page. It shows a "current session" meter with time left
  in a five-hour window that starts at the first message, plus weekly limits (all
  models, sometimes a separate model-family limit) and the next reset time. One pool
  covers the web app, Claude Code and the desktop app.
  https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work
- On reaching a limit the user can wait for reset, upgrade, or continue on paid
  usage credits if enabled. (same article)

### Claude Console: usage and cost
- Separate Usage and Cost pages. Usage is tokens split into uncached input, cached
  input, cache creation and output, groupable by model, workspace, key, service tier.
  Time buckets of minute, hour or day. Cost is USD, daily buckets only, groupable by
  workspace or line description. https://platform.claude.com/docs/en/build-with-claude/usage-cost-api
- Freshness: data normally appears within about five minutes of a request.
  Some costs (priority tier) are absent from the cost view and only visible as usage.
  https://platform.claude.com/docs/en/build-with-claude/usage-cost-api
- Org dashboards show per-member spend by day. https://code.claude.com/docs/en/costs

## 2. Patterns worth bringing to Kolux

| Pattern | Why it fits |
|---|---|
| Cost is always labelled an estimate, with a pointer to the authoritative source | Matches our "estimated cost" and keeps trust |
| Tokens broken into input / output / cache read / cache write | Cache reads dominate long sessions; one number hides that |
| Two clocks: wall time and API-busy time | Tells "agent worked" from "agent waited" |
| Windows toggle (24 h / 7 d) over one list | Same idea as our Today / 7 days / All time |
| Last-known data with age, instead of a blank or error | Our panel reads local history; stale beats empty |
| Share-of-usage percentages per source (subagent, plugin) | Could become per-workspace or per-agent share |
| Live count that resets each turn, shown only when it fits | Good model for the "Now" rows |
| Absent values omitted, never shown as zero | Avoids fake $0.00 for unknown |
| Honest scope line: "this machine only" | Our totals only cover panes Kolux saw |

## 3. Suggestions for our panel

1. Put a one-line caveat under the totals: "Estimated from token counts at list price
   on this machine; your provider's bill is authoritative." Show it once, quietly.
2. Add a small token split (input, output, cache read, cache write) to a totals tooltip
   or expandable row, since cache reads usually outweigh the rest.
3. In the "Now" list show two times per agent: how long the pane has been up, and how
   long since its last action, so a stalled agent stands out from a busy one.
4. Show unknowns as a dash, and mark rows whose cost is partial (for example a session
   missing pricing for its model) rather than printing $0.00.
5. When data cannot be refreshed, keep the last numbers and add a muted "updated 4 m
   ago" stamp; add a manual refresh control.
6. Add a per-workspace share bar under the 7-day total (percent of spend), mirroring the
   share-of-usage attribution idea, so the owner sees where spend goes at a glance.
