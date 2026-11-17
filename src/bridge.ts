import { createAgent } from "@ui-sdk/react/agent";
import { createHistory } from "@ui-sdk/react/history";
import { elementOf } from "@ui-sdk/react/observe";
import { fieldIdOfLabel, fields, type Settings } from "./data/fields";

// Must be imported before the app renders, or the bridge misses the first components.
const agent = createAgent();

const history = createHistory(agent, {
  within: () => document.querySelector<HTMLElement>("[data-team-table]"),
  keys: ["value", "checked"],
});

// `window.history` is the browser's, so the ui-sdk history goes on `uiHistory`.
Object.assign(window, { agent, uiHistory: history });

/**
 * Function to find which member's row a component sits in, via the row's `data-member-id`.
 * @param ref Component ref from a snapshot or history entry.
 * @returns The member id, or undefined if the component isn't on the page.
 */
function memberIdOfRef(ref: string): string | undefined {
  // Typed as always returning an element, but it's undefined for a ref that left the page.
  const element = elementOf(ref) as HTMLElement | undefined;
  return element?.closest("tr")?.dataset.memberId;
}

/**
 * Function to read every member's current settings from a fresh snapshot.
 * @returns Settings by member id.
 */
function readSettingsByMember(): Map<string, Settings> {
  const settingsByMember = new Map<string, Settings>();
  for (const component of agent.snapshot()) {
    const memberId = memberIdOfRef(component.ref)!;
    const fieldId = fieldIdOfLabel(component.label!);
    const settings = settingsByMember.get(memberId) ?? ({} as Settings);
    settingsByMember.set(memberId, Object.assign(settings, { [fieldId]: component[fields[fieldId].key] }));
  }
  return settingsByMember;
}

export { agent, history, memberIdOfRef, readSettingsByMember };
