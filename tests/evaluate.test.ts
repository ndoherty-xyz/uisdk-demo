import { describe, expect, it } from "vitest";
import { initialSettings, memberById, members } from "../src/data/members";
import { changesFor, matches, stepsFor } from "../src/recipe/evaluate";
import type { Recipe } from "../src/recipe/schema";

const maya = memberById.get("maya")!;
const priya = memberById.get("priya")!;

/**
 * Function to list the ids of members a filter selects.
 * @param filter The recipe filter.
 * @returns Matching member ids, in table order.
 */
function matchedIds(filter: Recipe["filter"]): string[] {
  return members.filter((member) => matches({ filter }, member)).map((member) => member.id);
}

describe("matches", () => {
  it("selects everyone for a null filter", () => {
    expect(matchedIds(null)).toHaveLength(12);
  });

  it("compares eq without case", () => {
    expect(matchedIds({ all: [{ attr: "team", op: "eq", value: "design" }] })).toEqual(["maya", "jonah", "priya", "tomas", "ines"]);
  });

  it("supports in and neq, ANDed together", () => {
    const filter: Recipe["filter"] = {
      all: [
        { attr: "team", op: "in", value: ["Marketing", "Support"] },
        { attr: "location", op: "neq", value: "Dublin" },
      ],
    };
    expect(matchedIds(filter)).toEqual(["rosa", "kenji", "ben"]);
  });
});

describe("stepsFor and changesFor", () => {
  const recipe: Pick<Recipe, "steps"> = {
    steps: [
      { field: "role", value: "editor" },
      { field: "weeklyDigest", value: true, when: { all: [{ attr: "title", op: "eq", value: "Product designer" }] } },
    ],
  };

  it("applies per-step when conditions", () => {
    expect(stepsFor(recipe, maya).map((step) => step.field)).toEqual(["role", "weeklyDigest"]);
    expect(stepsFor(recipe, priya).map((step) => step.field)).toEqual(["role"]);
  });

  it("drops steps whose value is already in place", () => {
    expect(changesFor(recipe, maya, initialSettings.maya!).map((step) => step.field)).toEqual(["role", "weeklyDigest"]);
    expect(changesFor(recipe, maya, { ...initialSettings.maya!, role: "editor" }).map((step) => step.field)).toEqual(["weeklyDigest"]);
  });
});
