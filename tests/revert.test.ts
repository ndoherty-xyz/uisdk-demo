import type { HistoryEntry } from "@ui-sdk/react/history";
import { describe, expect, it } from "vitest";
import { findSupersedingEntry, planUndo, type HistoryView } from "../src/run/revert";

/**
 * Function to build a history entry with sensible defaults.
 * @param overrides Fields to set on the entry.
 * @returns The entry.
 */
function entry(overrides: Partial<HistoryEntry> & Pick<HistoryEntry, "id" | "ref">): HistoryEntry {
  return {
    label: "Role",
    key: "value",
    value: "editor",
    previous: "viewer",
    source: "agent",
    reason: "agent",
    ...overrides,
  };
}

// Jonah's run turn: Role, Deploy alerts, Weekly digest.
const role = entry({ id: "a1", ref: "c5" });
const alerts = entry({ id: "a2", ref: "c7", label: "Deploy alerts", key: "checked", value: false, previous: true });
const digest = entry({ id: "a3", ref: "c8", label: "Weekly digest", key: "checked", value: true, previous: false });
const turn = [role, alerts, digest];

/**
 * Function to view a history with everything applied.
 * @param entries The entries, oldest first.
 * @param ignoredEntryIds Entries that never supersede.
 * @returns The view.
 */
function viewOf(entries: HistoryEntry[], ignoredEntryIds: string[] = []): HistoryView {
  return { entries, position: entries.length, ignoredEntryIds: new Set(ignoredEntryIds) };
}

describe("findSupersedingEntry", () => {
  it("finds a later person change on the same control and key", () => {
    const personRole = entry({ id: "p1", ref: "c5", value: "admin", previous: "editor", source: "mouse" });
    expect(findSupersedingEntry(role, viewOf([...turn, personRole]))).toBe(personRole);
    expect(findSupersedingEntry(alerts, viewOf([...turn, personRole]))).toBeUndefined();
  });

  it("ignores reverted, unapplied and ignored entries", () => {
    const reverted = entry({ id: "p1", ref: "c5", source: "mouse", reverted: true });
    const preview = entry({ id: "s1", ref: "c5" });
    const undone = entry({ id: "p2", ref: "c5", source: "mouse" });
    const view = { ...viewOf([...turn, reverted, preview, undone], ["s1"]), position: 5 };
    expect(findSupersedingEntry(role, view)).toBeUndefined();
  });
});

describe("planUndo", () => {
  it("reverts newest first, keeps superseded changes and skips removed ones", () => {
    const personRole = entry({ id: "p1", ref: "c5", value: "admin", previous: "editor", source: "mouse" });
    const plan = planUndo(turn, viewOf([...turn, personRole]), new Set(["a2"]));
    expect(plan.revert.map((e) => e.id)).toEqual(["a3"]);
    expect(plan.keep).toEqual([{ kept: role, supersededBy: personRole }]);
  });

  it("never reverts redacted entries", () => {
    const redacted = entry({ id: "a4", ref: "c9", redacted: true });
    expect(planUndo([redacted], viewOf([redacted]), new Set()).revert).toEqual([]);
  });
});
