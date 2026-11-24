import { agent, history, queryMemberControls } from "../bridge";
import { fields } from "../data/fields";
import { memberById } from "../data/members";
import { readSettings } from "../data/settingsStore";
import { scrollToMember } from "../ui/tableVirtualizer";
import { addRunTurn, startRun } from "./runStore";

/**
 * Function to stand in for a voice turn during development: six `act` calls on Jonah's and Priya's
 * rows (Role to Editor, both switches flipped), recorded as one run.
 */
async function runScriptedTurn() {
  startRun("Scripted turn");
  for (const memberId of ["jonah", "priya"]) {
    const member = memberById.get(memberId)!;
    await scrollToMember(memberId, 0);
    const controls = await queryMemberControls(member.name, memberId);
    const settings = readSettings(memberId);
    const turnStart = history.position();
    for (const fieldId of ["role", "deployAlerts", "weeklyDigest"] as const) {
      const isSwitch = fields[fieldId].kind === "switch";
      await agent.act({
        steps: [
          {
            ref: controls.find((control) => control.label === fields[fieldId].label)!.ref,
            action: isSwitch ? "setChecked" : "setValue",
            args: [isSwitch ? !settings[fieldId] : "editor"],
          },
        ],
      });
    }
    addRunTurn({ member, entries: history.entries().slice(turnStart).filter((entry) => entry.source === "agent") });
  }
}

export { runScriptedTurn };
