import { createAgent } from "@ui-sdk/react/agent";
import { createHistory } from "@ui-sdk/react/history";
import { elementOf } from "@ui-sdk/react/observe";

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

export { agent, history, memberIdOfRef };
