import type { AgentComponent } from "@ui-sdk/react/agent";
import { describe, expect, it } from "vitest";
import { memberById } from "../src/data/members";
import { plan } from "../src/recipe/plan";
import type { Recipe } from "../src/recipe/schema";

// Two rows with identical labels, as in the real table: only the row tells them apart.
const snapshot: AgentComponent[] = [
  { ref: "c1", component: "select", label: "Role", value: "viewer", actions: ["setValue"] },
  { ref: "c3", component: "switch", label: "Deploy alerts", checked: true, value: "on", actions: ["setChecked"] },
  { ref: "c4", component: "switch", label: "Weekly digest", checked: false, value: "on", actions: ["setChecked"] },
  { ref: "c5", component: "select", label: "Role", value: "editor", actions: ["setValue"] },
  { ref: "c7", component: "switch", label: "Deploy alerts", checked: true, value: "on", actions: ["setChecked"] },
];
const memberIdByRef: Record<string, string> = { c1: "maya", c3: "maya", c4: "maya", c5: "jonah", c7: "jonah" };
const memberIdOfRef = (ref: string) => memberIdByRef[ref];

const recipe: Pick<Recipe, "steps"> = {
  steps: [
    { field: "role", value: "editor" },
    { field: "deployAlerts", value: false },
  ],
};

describe("plan", () => {
  it("resolves each field to the control in that member's row", () => {
    expect(plan(recipe, memberById.get("maya")!, snapshot, memberIdOfRef)).toEqual([
      { field: "role", ref: "c1", action: "setValue", args: ["editor"], before: "viewer" },
      { field: "deployAlerts", ref: "c3", action: "setChecked", args: [false], before: true },
    ]);
  });

  it("drops no-op steps, reading current values from the snapshot", () => {
    expect(plan(recipe, memberById.get("jonah")!, snapshot, memberIdOfRef)).toEqual([
      { field: "deployAlerts", ref: "c7", action: "setChecked", args: [false], before: true },
    ]);
  });

  it("leaves the ref undefined when the row has no such control", () => {
    const digestOn: Pick<Recipe, "steps"> = { steps: [{ field: "weeklyDigest", value: true }] };
    expect(plan(digestOn, memberById.get("jonah")!, snapshot, memberIdOfRef)).toEqual([
      { field: "weeklyDigest", ref: undefined, action: "setChecked", args: [true], before: undefined },
    ]);
  });
});
