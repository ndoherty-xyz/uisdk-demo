import type { HistoryEntry } from "@ui-sdk/react/history";

/** History as the undo rules see it. */
type HistoryView = {
  entries: readonly HistoryEntry[];
  position: number;
  /** Whose row an entry changed. Refs can't say: a row that scrolls away comes back with new ones. */
  memberIdOf: (entry: HistoryEntry) => string;
  /** Agent entries taken back from the sidebar or by voice. */
  undoneEntryIds: ReadonlySet<string>;
  /** Entries made by taking a change back or putting it back. */
  undoEntryIds: ReadonlySet<string>;
};

/** An agent entry undo or put back left alone, and the later entry that replaced its value. */
type KeptEntry = { kept: HistoryEntry; supersededBy: HistoryEntry };

/** Where an agent entry stands: its value is current, it was taken back, or something replaced it. */
type EntryStatus = "applied" | "undone" | "superseded";

/**
 * Function to find the entry that replaced an entry's value: a later, applied entry on the same
 * member's same field and key. Undone entries and undo's own entries don't count.
 * @param entry The entry to check.
 * @param historyView The history to look through.
 * @returns The newest superseding entry, or undefined if the entry's value is still current.
 */
function findSupersedingEntry(entry: HistoryEntry, historyView: HistoryView): HistoryEntry | undefined {
  const { entries, position, memberIdOf, undoneEntryIds, undoEntryIds } = historyView;
  const later = entries.slice(entries.findIndex((candidate) => candidate.id === entry.id) + 1, position);
  return later.findLast(
    (candidate) =>
      memberIdOf(candidate) === memberIdOf(entry) &&
      candidate.label === entry.label &&
      candidate.key === entry.key &&
      !candidate.reverted &&
      !undoneEntryIds.has(candidate.id) &&
      !undoEntryIds.has(candidate.id),
  );
}

/**
 * Function to tell where an agent entry stands.
 * @param entry The agent's entry.
 * @param historyView The current history.
 * @returns Its status.
 */
function entryStatus(entry: HistoryEntry, historyView: HistoryView): EntryStatus {
  if (historyView.undoneEntryIds.has(entry.id)) return "undone";
  return findSupersedingEntry(entry, historyView) ? "superseded" : "applied";
}

/**
 * Function to work out what undoing some agent entries does: revert each applied one newest first,
 * keep superseded ones, and skip undone or redacted ones.
 * @param undoneEntries The agent entries to undo, oldest first.
 * @param historyView The current history.
 * @returns The entries to revert, newest first, and the ones kept.
 */
function planUndo(
  undoneEntries: readonly HistoryEntry[],
  historyView: HistoryView,
): { revert: HistoryEntry[]; keep: KeptEntry[] } {
  const plan: { revert: HistoryEntry[]; keep: KeptEntry[] } = { revert: [], keep: [] };
  for (const entry of undoneEntries.toReversed()) {
    if (historyView.undoneEntryIds.has(entry.id) || entry.redacted) continue;
    const supersededBy = findSupersedingEntry(entry, historyView);
    if (supersededBy) plan.keep.push({ kept: entry, supersededBy });
    else plan.revert.push(entry);
  }
  return plan;
}

/**
 * Function to work out what putting undone agent entries back does: re-apply each oldest first,
 * unless something changed the field after the undo.
 * @param entries The agent entries to put back, oldest first.
 * @param historyView The current history.
 * @returns The entries to re-apply and the ones kept as they are.
 */
function planPutBack(
  entries: readonly HistoryEntry[],
  historyView: HistoryView,
): { reapply: HistoryEntry[]; keep: KeptEntry[] } {
  const plan: { reapply: HistoryEntry[]; keep: KeptEntry[] } = { reapply: [], keep: [] };
  for (const entry of entries) {
    if (!historyView.undoneEntryIds.has(entry.id)) continue;
    const supersededBy = findSupersedingEntry(entry, historyView);
    if (supersededBy) plan.keep.push({ kept: entry, supersededBy });
    else plan.reapply.push(entry);
  }
  return plan;
}

export { entryStatus, findSupersedingEntry, planPutBack, planUndo };
export type { EntryStatus, HistoryView, KeptEntry };
