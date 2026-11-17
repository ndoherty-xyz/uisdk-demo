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

// Nudge ----------

/** Hand-made changes further apart than this belong to different bursts. */
const burstGapMs = 30_000;

/**
 * Function to find two rows whose latest burst of hand-made changes set the same fields to the
 * same values: the person doing the same thing twice.
 * @param entries History entries, oldest first.
 * @param timeOf When an entry was made, in ms.
 * @param memberIdOf Resolves a component ref to its member id.
 * @param offeredKeys Change sets already offered; they don't count again.
 * @returns The change set's key and the two recordings, oldest burst first, or undefined.
 */
function findRepeatedChange(
  entries: readonly HistoryEntry[],
  timeOf: (entryId: string) => number,
  memberIdOf: (ref: string) => string | undefined,
  offeredKeys: ReadonlySet<string>,
): { key: string; recordings: [Recording, Recording] } | undefined {
  const latestBursts: { key: string; recording: Recording; endedAt: number }[] = [];
  for (const [memberId, memberEntries] of groupPersonEntriesByMember(entries, memberIdOf)) {
    let burstStart = memberEntries.length - 1;
    while (
      burstStart > 0 &&
      timeOf(memberEntries[burstStart]!.id) - timeOf(memberEntries[burstStart - 1]!.id) <= burstGapMs
    ) {
      burstStart--;
    }
    const recording = recordingFromEntries(memberId, memberEntries.slice(burstStart));
    // Fields put back where they started leave nothing to repeat.
    if (recording.changes.length === 0) continue;
    const key = recording.changes
      .map((change) => `${change.field}=${JSON.stringify(change.to)}`)
      .sort()
      .join(" ");
    latestBursts.push({ key, recording, endedAt: timeOf(memberEntries.at(-1)!.id) });
  }
  latestBursts.sort((a, b) => a.endedAt - b.endedAt);
  for (const [index, burst] of latestBursts.entries()) {
    if (offeredKeys.has(burst.key)) continue;
    const later = latestBursts.slice(index + 1).findLast((candidate) => candidate.key === burst.key);
    if (later) return { key: burst.key, recordings: [burst.recording, later.recording] };
  }
  return undefined;
}

export { findRepeatedChange, groupPersonEntriesByMember, recordingFromEntries };
export type { RecordedChange, Recording };
