import { createAgent } from "@ui-sdk/react/agent";
import { createHistory, type HistoryEntry } from "@ui-sdk/react/history";
import { elementOf } from "@ui-sdk/react/observe";
import { members } from "./data/members";
import { readSettings } from "./data/settingsStore";

// Must be imported before the app renders, or the bridge misses the first components.
const agent = createAgent();

const history = createHistory(agent, {
  within: () => document.querySelector<HTMLElement>("[data-team-table]"),
  keys: ["value", "checked"],
});

// For the console and e2e tests. `window.history` is the browser's, so the ui-sdk one is `uiHistory`.
Object.assign(window, { agent, uiHistory: history, memberIdOfRef, members, readSettings });

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

// Entries carry no time, and their row can scroll away later, so note both when each first appears.
const entryTimes = new Map<string, number>();
const memberIdByEntryId = new Map<string, string>();
history.subscribe(() => {
  for (const entry of history.entries()) {
    if (entryTimes.has(entry.id)) continue;
    entryTimes.set(entry.id, Date.now());
    memberIdByEntryId.set(entry.id, memberIdOfRef(entry.ref)!);
  }
});

/**
 * Function to find which member's row a history entry changed, even after the row scrolled away.
 * @param entry The entry.
 * @returns The member id.
 */
function memberIdOfEntry(entry: HistoryEntry): string {
  return memberIdByEntryId.get(entry.id)!;
}

/**
 * Function to find the on-page controls in one member's row.
 * @param memberName The member's name, which is in their row's text.
 * @param memberId The member's id, to drop other rows whose text shares a word.
 * @returns The row's components.
 */
async function queryMemberControls(memberName: string, memberId: string) {
  const found = await agent.query({ text: memberName });
  return "error" in found ? [] : found.filter((component) => memberIdOfRef(component.ref) === memberId);
}

export { agent, entryTimes, history, memberIdOfEntry, memberIdOfRef, queryMemberControls };
