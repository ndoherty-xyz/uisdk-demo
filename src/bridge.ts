import { createAgent } from "@ui-sdk/react/agent";
import { createHistory } from "@ui-sdk/react/history";

// Must be imported before the app renders, or the bridge misses the first components.
const agent = createAgent();

const history = createHistory(agent, {
  within: () => document.querySelector<HTMLElement>("[data-team-table]"),
  keys: ["value", "checked"],
});

// `window.history` is the browser's, so the ui-sdk history goes on `uiHistory`.
Object.assign(window, { agent, uiHistory: history });

export { agent, history };
