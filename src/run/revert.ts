import type { HistoryEntry } from "@ui-sdk/react/history";

/** History as the undo rules see it. */
type HistoryView = {
  entries: readonly HistoryEntry[];
  position: number;
  /** Whose row an entry changed. Refs can't say: a row that scrolls away comes back with new ones. */
  memberIdOf: (entry: HistoryEntry) => string;
};

/** An agent entry undo left alone, and the later entry that replaced its value. */
type KeptEntry = { kept: HistoryEntry; supersededBy: HistoryEntry };

/**
 * Function to find the entry that replaced an entry's value: a later, applied, non-reverted entry
 * on the same member's same field and key.
 * @param entry The entry to check.
 * @param historyView The history to look through.
 * @returns The newest superseding entry, or undefined if the entry's value is still current.
 */
function findSupersedingEntry(entry: HistoryEntry, historyView: HistoryView): HistoryEntry | undefined {
  const { entries, position, memberIdOf } = historyView;
  const later = entries.slice(entries.findIndex((candidate) => candidate.id === entry.id) + 1, position);
  return later.findLast(
    (candidate) =>
      memberIdOf(candidate) === memberIdOf(entry) &&
      candidate.label === entry.label &&
      candidate.key === entry.key &&
      !candidate.reverted,
  );
}

/**
 * Function to work out what undoing some agent entries does: revert each one newest first, except
 * already removed or redacted ones, and keep superseded ones.
 * @param undoneEntries The agent entries to undo, oldest first.
 * @param historyView The current history.
 * @param removedEntryIds Entries already reverted one by one.
 * @returns The entries to revert, newest first, and the ones kept.
 */
function planUndo(
  undoneEntries: readonly HistoryEntry[],
  historyView: HistoryView,
  removedEntryIds: ReadonlySet<string>,
): { revert: HistoryEntry[]; keep: KeptEntry[] } {
  const plan: { revert: HistoryEntry[]; keep: KeptEntry[] } = {
    revert: [],
    keep: [],
  };
  for (const entry of undoneEntries.toReversed()) {
    if (removedEntryIds.has(entry.id) || entry.redacted) continue;
    const supersededBy = findSupersedingEntry(entry, historyView);
    if (supersededBy) plan.keep.push({ kept: entry, supersededBy });
    else plan.revert.push(entry);
  }
  return plan;
}

export { findSupersedingEntry, planUndo };
export type { HistoryView, KeptEntry };
