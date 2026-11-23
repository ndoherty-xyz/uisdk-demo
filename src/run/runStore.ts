import type { HistoryEntry } from "@ui-sdk/react/history";
import { agent, history, memberIdOfEntry, queryMemberControls } from "../bridge";
import { memberById, type Member } from "../data/members";
import type { Recipe } from "../recipe/schema";
import { scrollToMember } from "../ui/tableVirtualizer";
import { planPutBack, planUndo, type HistoryView, type KeptEntry } from "./revert";

// Every agent change so far, grouped into runs, and which ones were taken back. Lives outside React
// so the sidebar and the voice agent undo through the same rules.

/** One row's share of a run: the history entries the agent made on it. */
type RunTurn = { member: Member; entries: HistoryEntry[] };

/** One recipe run or one voice turn, keyed by when it started. */
type AgentRun = { startedAt: number; title: string; recipe?: Recipe; turns: RunTurn[] };

type RunStore = {
  runs: AgentRun[];
  undoneEntryIds: ReadonlySet<string>;
  undoEntryIds: ReadonlySet<string>;
};

let runStore: RunStore = { runs: [], undoneEntryIds: new Set(), undoEntryIds: new Set() };
const runStoreListeners = new Set<() => void>();

// Store ----------

/**
 * Function to replace part of the store and tell subscribers.
 * @param change The fields to replace.
 */
function updateRunStore(change: Partial<RunStore>) {
  runStore = { ...runStore, ...change };
  for (const listener of runStoreListeners) listener();
}

/**
 * Function to listen for run store changes, for `useSyncExternalStore` with `readRunStore`.
 * @param listener Called after every change.
 * @returns Stops listening.
 */
function subscribeRunStore(listener: () => void): () => void {
  runStoreListeners.add(listener);
  return () => runStoreListeners.delete(listener);
}

/**
 * Function to read the runs and what was taken back. A new object after every change.
 * @returns The store.
 */
function readRunStore(): RunStore {
  return runStore;
}

/**
 * Function to start a new run; turns added after this belong to it.
 * @param title What the card says, e.g. the recipe's audience.
 * @param recipe The recipe, for recipe runs.
 */
function startRun(title: string, recipe?: Recipe) {
  updateRunStore({ runs: [...runStore.runs, { startedAt: Date.now(), title, recipe, turns: [] }] });
}

/**
 * Function to add one row's changes to the newest run, joining that row's earlier changes in it.
 * @param turn The row and the agent's entries on it.
 */
function addRunTurn(turn: RunTurn) {
  const newestRun = runStore.runs.at(-1)!;
  const index = newestRun.turns.findIndex((existing) => existing.member.id === turn.member.id);
  const turns =
    index === -1
      ? [...newestRun.turns, turn]
      : newestRun.turns.with(index, { member: turn.member, entries: [...newestRun.turns[index]!.entries, ...turn.entries] });
  updateRunStore({ runs: runStore.runs.with(-1, { ...newestRun, turns }) });
}

/** Function to forget every run without reverting anything. */
function clearRuns() {
  updateRunStore({ runs: [] });
}

/**
 * Function to view the table's history with what was taken back, for the undo rules.
 * @returns The view.
 */
function readHistoryView(): HistoryView {
  return {
    entries: history.entries(),
    position: history.position(),
    memberIdOf: memberIdOfEntry,
    undoneEntryIds: runStore.undoneEntryIds,
    undoEntryIds: runStore.undoEntryIds,
  };
}

// Undo ----------

/**
 * Function to set entries' controls to their previous or new values, a row at a time, scrolling
 * back to rows that left the screen. The entries this makes are noted as undo's own.
 * @param entries The entries.
 * @param valueKey Which value to set: "previous" to take back, "value" to put back.
 * @returns The entries that couldn't be set.
 */
async function setEntryValues(entries: HistoryEntry[], valueKey: "previous" | "value"): Promise<HistoryEntry[]> {
  const failedEntries: HistoryEntry[] = [];
  for (const [memberId, memberEntries] of Map.groupBy(entries, memberIdOfEntry)) {
    await scrollToMember(memberId, 0);
    // The row may have remounted with new refs, so find its controls again by label.
    const controls = await queryMemberControls(memberById.get(memberId)!.name, memberId);
    const positionBefore = history.position();
    const result = await agent.act({
      steps: memberEntries.map((entry) => ({
        ref: controls.find((control) => control.label === entry.label)!.ref,
        action: entry.key === "checked" ? "setChecked" : "setValue",
        args: [entry[valueKey]],
      })),
    });
    const madeIds = history
      .entries()
      .slice(positionBefore)
      .filter((entry) => entry.source === "agent")
      .map((entry) => entry.id);
    updateRunStore({ undoEntryIds: new Set([...runStore.undoEntryIds, ...madeIds]) });
    // act stops at the first failing step; that one and the rest weren't made.
    if (result.error) failedEntries.push(...memberEntries.slice(result.error.step));
  }
  return failedEntries;
}

/**
 * Function to take back agent entries, newest first, leaving superseded ones.
 * They count as undone from the start, so their own revert entries never show them as superseded.
 * @param entries The agent entries, oldest first.
 * @returns The entries kept because something changed them afterwards.
 */
async function undoEntries(entries: readonly HistoryEntry[]): Promise<KeptEntry[]> {
  const undoPlan = planUndo(entries, readHistoryView());
  const revertIds = undoPlan.revert.map((entry) => entry.id);
  updateRunStore({ undoneEntryIds: new Set([...runStore.undoneEntryIds, ...revertIds]) });
  const failedIds = new Set((await setEntryValues(undoPlan.revert, "previous")).map((entry) => entry.id));
  updateRunStore({ undoneEntryIds: new Set([...runStore.undoneEntryIds].filter((id) => !failedIds.has(id))) });
  return undoPlan.keep;
}

/**
 * Function to put undone agent entries back, unless something changed them after the undo.
 * @param entries The agent entries, oldest first.
 * @returns The entries kept as they are.
 */
async function putBackEntries(entries: readonly HistoryEntry[]): Promise<KeptEntry[]> {
  const putBackPlan = planPutBack(entries, readHistoryView());
  const failedEntries = await setEntryValues(putBackPlan.reapply, "value");
  const reappliedIds = new Set(putBackPlan.reapply.filter((entry) => !failedEntries.includes(entry)).map((e) => e.id));
  updateRunStore({ undoneEntryIds: new Set([...runStore.undoneEntryIds].filter((id) => !reappliedIds.has(id))) });
  return putBackPlan.keep;
}

export { addRunTurn, clearRuns, putBackEntries, readHistoryView, readRunStore, startRun, subscribeRunStore, undoEntries };
export type { AgentRun, RunTurn };
