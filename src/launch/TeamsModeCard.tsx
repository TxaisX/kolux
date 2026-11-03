// The Agent Teams mode preference for Settings > Agents: Off (the default), In-process or Native
// panes. On Windows and WSL the help says teammates always run in-process and the picker has no
// Agent Teams entry; the choice is kept for when the same profile runs elsewhere.
import { effectiveMode, pickableModes, teamsMode, TEAMS_MODE_KEY, TEAMS_MODE_LABEL, type TeamsHost } from "./teams";

type Props = {
  settings: Record<string, unknown>;
  save: (patch: Record<string, unknown>) => unknown;
  host: TeamsHost | null;
};

export default function TeamsModeCard({ settings, save, host }: Props) {
  const mode = teamsMode(settings);
  const blocked = !!host && (host.windows || host.wsl);
  return (
    <section className="conn-card" data-section="agent-teams">
      <h2 className="conn-name">Claude Agent Teams</h2>
      <select aria-label="Agent Teams mode" className="field" value={mode} onChange={(e) => save({ [TEAMS_MODE_KEY]: e.target.value })}>
        {pickableModes(mode).map((m) => (
          <option key={m} value={m}>
            {TEAMS_MODE_LABEL[m]}
          </option>
        ))}
      </select>
      <p className="conn-detail">
        When on, the agent picker offers Claude Agent Teams: Claude Code starts as a team lead that can spawn teammates, inside the same session. Native panes, with teammates as panes beside the lead, is not built yet: for now it runs teammates in-process too. It needs Claude Code and the Kolux command line installed.
      </p>
      {blocked && (
        <p className="conn-detail warn">
          {`${host!.windows ? "On Windows" : "On WSL"} Agent Teams is not offered in the picker, and teammates always run in-process${mode === "native" && effectiveMode(mode, host!) !== mode ? ", so Native panes acts as In-process here" : ""}.`}
        </p>
      )}
    </section>
  );
}
