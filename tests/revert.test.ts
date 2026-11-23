import type { HistoryEntry } from "@ui-sdk/react/history";
import { describe, expect, it } from "vitest";
import { entryStatus, findSupersedingEntry, planPutBack, planUndo, type HistoryView } from "../src/run/revert";

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
 * @param undoneIds Agent entries taken back.
 * @param undoIds Entries made by taking back or putting back.
 * @returns The view.
 */
function viewOf(entries: HistoryEntry[], undoneIds: string[] = [], undoIds: string[] = []): HistoryView {
  return {
    entries,
    position: entries.length,
    memberIdOf: () => "jonah",
    undoneEntryIds: new Set(undoneIds),
    undoEntryIds: new Set(undoIds),
  };
}

describe("findSupersedingEntry", () => {
  it("finds a later person change on the same field and key, even after the row's refs changed", () => {
    const personRole = entry({ id: "p1", ref: "c41", value: "admin", previous: "editor", source: "mouse" });
    expect(findSupersedingEntry(role, viewOf([...turn, personRole]))).toBe(personRole);
    expect(findSupersedingEntry(alerts, viewOf([...turn, personRole]))).toBeUndefined();
  });

  it("ignores reverted and unapplied entries", () => {
    const reverted = entry({ id: "p1", ref: "c5", source: "mouse", reverted: true });
    const undone = entry({ id: "p2", ref: "c5", source: "mouse" });
    const view = { ...viewOf([...turn, reverted, undone]), position: 4 };
    expect(findSupersedingEntry(role, view)).toBeUndefined();
  });
});

describe("planUndo", () => {
  it("reverts newest first, keeps superseded changes and skips removed ones", () => {
    const personRole = entry({ id: "p1", ref: "c5", value: "admin", previous: "editor", source: "mouse" });
    const plan = planUndo(turn, viewOf([...turn, personRole], ["a2"]));
    expect(plan.revert.map((e) => e.id)).toEqual(["a3"]);
    expect(plan.keep).toEqual([{ kept: role, supersededBy: personRole }]);
  });

  it("never reverts redacted entries", () => {
    const redacted = entry({ id: "a4", ref: "c9", redacted: true });
    expect(planUndo([redacted], viewOf([redacted])).revert).toEqual([]);
  });

  it("says whether the person or the agent changed a kept entry", () => {
    const agentRole = entry({ id: "a5", ref: "c5", value: "admin", previous: "editor" });
    expect(planUndo([role], viewOf([...turn, agentRole])).keep[0]!.supersededBy.source).toBe("agent");
  });

  it("doesn't count an undone later change as superseding", () => {
    // A second turn set Role again and was undone; the first turn's Role is current once more.
    const secondRole = entry({ id: "a5", ref: "c5", value: "admin", previous: "editor" });
    const revertSecond = entry({ id: "u1", ref: "c5", value: "editor", previous: "admin" });
    const view = viewOf([...turn, secondRole, revertSecond], ["a5"], ["u1"]);
    expect(entryStatus(role, view)).toBe("applied");
    expect(planUndo([role], view).revert).toEqual([role]);
  });
});

describe("planPutBack", () => {
  // Deploy alerts was undone: its revert entry is undo's own.
  const revertAlerts = entry({ ...alerts, id: "u1", value: true, previous: false });

  it("re-applies an undone entry, and only undone ones", () => {
    const view = viewOf([...turn, revertAlerts], ["a2"], ["u1"]);
    expect(entryStatus(alerts, view)).toBe("undone");
    expect(planPutBack(turn, view)).toEqual({ reapply: [alerts], keep: [] });
  });

  it("keeps an undone entry the person changed after the undo", () => {
    const personAlerts = entry({ ...alerts, id: "p1", value: false, previous: true, source: "mouse" });
    const plan = planPutBack([alerts], viewOf([...turn, revertAlerts, personAlerts], ["a2"], ["u1"]));
    expect(plan).toEqual({ reapply: [], keep: [{ kept: alerts, supersededBy: personAlerts }] });
  });

  it("counts a put-back entry as applied again", () => {
    const reapplyAlerts = entry({ ...alerts, id: "u2" });
    expect(entryStatus(alerts, viewOf([...turn, revertAlerts, reapplyAlerts], [], ["u1", "u2"]))).toBe("applied");
  });
});
