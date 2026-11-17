import type { HistoryEntry } from "@ui-sdk/react/history";
import { fieldIdOfLabel, type FieldId } from "../data/fields";

type RecordedChange = { field: FieldId; from: unknown; to: unknown };
type Recording = { memberId: string; changes: RecordedChange[] };

/**
 * Function to group the person's history entries by the row they changed, dropping agent
 * changes and entries `undoSource` reverted.
 * @param entries History entries from the recording window.
 * @param memberIdOf Resolves a component ref to its member id.
 * @returns Entries per member id, oldest first, in the order rows were first touched.
 */
function groupPersonEntriesByMember(
  entries: readonly HistoryEntry[],
  memberIdOf: (ref: string) => string | undefined,
): Map<string, HistoryEntry[]> {
  const entriesByMember = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    if (entry.source === "agent" || entry.reverted) continue;
    const memberId = memberIdOf(entry.ref);
    if (!memberId) continue;
    entriesByMember.set(memberId, [...(entriesByMember.get(memberId) ?? []), entry]);
  }
  return entriesByMember;
}

/**
 * Function to collapse one member's entries to one change per field: the value before the first
 * entry to the value after the last. Fields that ended where they started are dropped.
 * @param memberId The member the entries belong to.
 * @param entries That member's entries, oldest first.
 * @returns The recording.
 */
function recordingFromEntries(memberId: string, entries: readonly HistoryEntry[]): Recording {
  const changeByField = new Map<FieldId, RecordedChange>();
  for (const entry of entries) {
    const field = fieldIdOfLabel(entry.label);
    const from = changeByField.get(field)?.from ?? entry.previous;
    changeByField.set(field, { field, from, to: entry.value });
  }
  const changes = [...changeByField.values()].filter((change) => change.from !== change.to);
  return { memberId, changes };
}

export { groupPersonEntriesByMember, recordingFromEntries };
export type { RecordedChange, Recording };
