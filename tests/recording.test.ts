import type { HistoryEntry } from "@ui-sdk/react/history";
import { describe, expect, it } from "vitest";
import { findRepeatedChange, groupPersonEntriesByMember, recordingFromEntries } from "../src/record/recording";

const memberIdByRef: Record<string, string> = {
  c1: "maya",
  c3: "maya",
  c4: "maya",
  c5: "jonah",
  c7: "jonah",
  c8: "jonah",
};
const memberIdOf = (ref: string) => memberIdByRef[ref];

/**
 * Function to build a history entry with sensible defaults.
 * @param overrides Fields to set on the entry.
 * @returns The entry.
 */
function entry(overrides: Partial<HistoryEntry> & Pick<HistoryEntry, "id" | "ref" | "label">): HistoryEntry {
  return { key: "value", value: null, previous: null, source: "mouse", reason: "press", ...overrides };
}

describe("groupPersonEntriesByMember", () => {
  it("drops agent and reverted entries and groups the rest by row", () => {
    const entries = [
      entry({ id: "e1", ref: "c1", label: "Role", value: "editor", previous: "viewer" }),
      entry({ id: "e2", ref: "c5", label: "Role", value: "admin", previous: "viewer", source: "agent" }),
      entry({
        id: "e3",
        ref: "c3",
        label: "Deploy alerts",
        key: "checked",
        value: false,
        previous: true,
        reverted: true,
      }),
      entry({ id: "e4", ref: "c5", label: "Role", value: "editor", previous: "admin", source: "keyboard" }),
    ];
    const grouped = groupPersonEntriesByMember(entries, memberIdOf);
    expect([...grouped.keys()]).toEqual(["maya", "jonah"]);
    expect(grouped.get("maya")!.map((e) => e.id)).toEqual(["e1"]);
    expect(grouped.get("jonah")!.map((e) => e.id)).toEqual(["e4"]);
  });
});

describe("recordingFromEntries", () => {
  it("collapses repeated changes on a field to first previous → last value", () => {
    const recording = recordingFromEntries("maya", [
      entry({ id: "e1", ref: "c1", label: "Role", value: "editor", previous: "viewer" }),
      entry({ id: "e2", ref: "c4", label: "Weekly digest", key: "checked", value: true, previous: false }),
      entry({ id: "e3", ref: "c1", label: "Role", value: "admin", previous: "editor" }),
    ]);
    expect(recording).toEqual({
      memberId: "maya",
      changes: [
        { field: "role", from: "viewer", to: "admin" },
        { field: "weeklyDigest", from: false, to: true },
      ],
    });
  });

  it("drops a field that ended where it started", () => {
    const recording = recordingFromEntries("maya", [
      entry({ id: "e1", ref: "c3", label: "Deploy alerts", key: "checked", value: false, previous: true }),
      entry({ id: "e2", ref: "c3", label: "Deploy alerts", key: "checked", value: true, previous: false }),
    ]);
    expect(recording.changes).toEqual([]);
  });
});

describe("findRepeatedChange", () => {
  const mayaEntries = [
    entry({ id: "m1", ref: "c1", label: "Role", value: "editor", previous: "viewer" }),
    entry({ id: "m2", ref: "c4", label: "Weekly digest", key: "checked", value: true, previous: false }),
  ];
  const jonahEntries = [
    entry({ id: "j1", ref: "c8", label: "Weekly digest", key: "checked", value: true, previous: false }),
    entry({ id: "j2", ref: "c5", label: "Role", value: "editor", previous: "admin" }),
  ];
  const secondsApart = (entryId: string) => [...mayaEntries, ...jonahEntries].findIndex((e) => e.id === entryId) * 1000;

  it("matches two rows given the same values in any order, oldest first", () => {
    const repeated = findRepeatedChange([...mayaEntries, ...jonahEntries], secondsApart, memberIdOf, new Set());
    expect(repeated?.key).toBe('role="editor" weeklyDigest=true');
    expect(repeated?.recordings.map((recording) => recording.memberId)).toEqual(["maya", "jonah"]);
  });

  it("skips change sets already offered", () => {
    const offered = new Set(['role="editor" weeklyDigest=true']);
    expect(findRepeatedChange([...mayaEntries, ...jonahEntries], secondsApart, memberIdOf, offered)).toBeUndefined();
  });

  it("only counts each row's latest burst", () => {
    const minutesApart = (entryId: string) => (entryId === "m2" ? 60_000 : secondsApart(entryId));
    expect(findRepeatedChange([...mayaEntries, ...jonahEntries], minutesApart, memberIdOf, new Set())).toBeUndefined();
  });

  it("matches a single field", () => {
    const oneField = [mayaEntries[0]!, jonahEntries[1]!];
    expect(findRepeatedChange(oneField, secondsApart, memberIdOf, new Set())?.key).toBe('role="editor"');
  });
});
