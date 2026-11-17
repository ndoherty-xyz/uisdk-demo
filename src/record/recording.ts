import type { HistoryEntry } from "@ui-sdk/react/history";
import { fieldIdOfLabel, type FieldId, type Settings } from "../data/fields";

type RecordedChange = { field: FieldId; from: unknown; to: unknown };
type Recording = { memberId: string; changes: RecordedChange[] };

/**
 * Function to group the person's history entries by the row they changed, dropping agent
 * changes and entries `undoSource` reverted.
 * @param entries History entries from the recording window.
 * @param memberIdOf Resolves an entry to the member whose row it changed.
 * @returns Entries per member id, oldest first, in the order rows were first touched.
 */
function groupPersonEntriesByMember(
  entries: readonly HistoryEntry[],
  memberIdOf: (entry: HistoryEntry) => string | undefined,
): Map<string, HistoryEntry[]> {
  const entriesByMember = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    if (entry.source === "agent" || entry.reverted) continue;
    const memberId = memberIdOf(entry);
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
 * Function to find two rows whose latest bursts of hand-made changes left them in the same end
 * state: every field either row changed has the same value in both. One row may already have had
 * a value the other was given; its recording then gets that field too, unchanged, so both
 * examples carry the whole change.
 * @param entries History entries, oldest first.
 * @param timeOf When an entry was made, in ms.
 * @param memberIdOf Resolves an entry to the member whose row it changed.
 * @param settingsOf A member's current settings, which are the end state of their latest burst.
 * @param offeredKeys Change sets already offered; they don't count again.
 * @returns The change set's key and the two recordings, oldest burst first, or undefined.
 */
function findRepeatedChange(
  entries: readonly HistoryEntry[],
  timeOf: (entryId: string) => number,
  memberIdOf: (entry: HistoryEntry) => string | undefined,
  settingsOf: (memberId: string) => Settings,
  offeredKeys: ReadonlySet<string>,
): { key: string; recordings: [Recording, Recording] } | undefined {
  const latestBursts: { recording: Recording; endedAt: number }[] = [];
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
    latestBursts.push({ recording, endedAt: timeOf(memberEntries.at(-1)!.id) });
  }
  latestBursts.sort((a, b) => a.endedAt - b.endedAt);
  // Each burst pairs with the latest later one that ended in the same state.
  for (const [index, { recording }] of latestBursts.entries()) {
    for (const { recording: laterRecording } of latestBursts.slice(index + 1).reverse()) {
      const settings = settingsOf(recording.memberId);
      const laterSettings = settingsOf(laterRecording.memberId);
      const changedFields = [
        ...new Set([...recording.changes, ...laterRecording.changes].map((change) => change.field)),
      ].sort();
      if (changedFields.some((field) => settings[field] !== laterSettings[field])) continue;
      const key = changedFields.map((field) => `${field}=${JSON.stringify(settings[field])}`).join(" ");
      if (offeredKeys.has(key)) continue;
      const withEveryField = (example: Recording, exampleSettings: Settings): Recording => ({
        ...example,
        changes: changedFields.map(
          (field) =>
            example.changes.find((change) => change.field === field) ?? {
              field,
              from: exampleSettings[field],
              to: exampleSettings[field],
            },
        ),
      });
      return { key, recordings: [withEveryField(recording, settings), withEveryField(laterRecording, laterSettings)] };
    }
  }
  return undefined;
}

export { findRepeatedChange, groupPersonEntriesByMember, recordingFromEntries };
export type { RecordedChange, Recording };
