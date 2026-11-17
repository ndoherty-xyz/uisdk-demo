import { fields } from "../src/data/fields";
import { attributeValueCounts, memberById, members } from "../src/data/members";
import { matches, stepsFor } from "../src/recipe/evaluate";
import type { Recipe, RecipeRequest } from "../src/recipe/schema";
import { defaultModel, proposeRecipe, type RecipeCallResult } from "../server/model";
import { fixtures, type Fixture } from "./fixtures";

// Helpers ----------

/**
 * Function to build the request the UI would send for a fixture: seed settings, with each
 * recorded member's changes already applied.
 * @param fixture The fixture.
 * @returns The request body.
 */
function requestFor(fixture: Fixture): Omit<RecipeRequest, "model"> {
  return {
    recorded: fixture.recorded.map((recording) => ({
      member: memberById.get(recording.memberId)!,
      changes: recording.changes,
    })),
    attributeValueCounts,
    fields,
    ...(fixture.hint && { hint: fixture.hint }),
  };
}

/**
 * Function to describe what a recipe does to the table: for each member, the values it sets.
 * Two recipes with the same effect pass, however their clauses are written.
 * @param recipe The recipe (only filter and steps are used).
 * @returns One line per member, e.g. "jonah: role=editor weeklyDigest=true".
 */
function effectOf(recipe: Pick<Recipe, "filter" | "steps">): string[] {
  return members.map((member) => {
    const steps = matches(recipe, member) ? stepsFor(recipe, member) : [];
    const values = steps.map((step) => `${step.field}=${step.value}`).sort();
    return `${member.id}: ${values.join(" ") || "-"}`;
  });
}

/**
 * Function to take the median of a list of numbers.
 * @param values The numbers.
 * @returns The median, or 0 for an empty list.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// Run ----------

const models = (process.env.EVAL_MODELS || defaultModel)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

type Outcome = { fixture: Fixture; result: RecipeCallResult; passed: boolean; mismatches: string[] };

const outcomesByModel = await Promise.all(
  models.map(async (model) => {
    const outcomes = await Promise.all(
      fixtures.map(async (fixture): Promise<Outcome> => {
        const result = await proposeRecipe(requestFor(fixture), model);
        if (!result.ok) return { fixture, result, passed: false, mismatches: [result.detail ?? result.error] };
        const expected = effectOf(fixture.expected);
        const actual = effectOf(result.recipe);
        const mismatches = actual
          .map((line, index) =>
            line === expected[index] ? undefined : `got ${line}  want ${expected[index]!.split(": ")[1]}`,
          )
          .filter((line): line is string => line !== undefined);
        return { fixture, result, passed: mismatches.length === 0, mismatches };
      }),
    );
    return { model, outcomes };
  }),
);

for (const { model, outcomes } of outcomesByModel) {
  console.log(`\n${model}`);
  for (const { fixture, result, passed, mismatches } of outcomes) {
    console.log(
      `  ${passed ? "✓" : "✗"} ${fixture.name}${result.attempts > 1 ? ` (${result.attempts} attempts)` : ""}`,
    );
    if (!passed) {
      if (result.ok)
        console.log(`      filter: ${JSON.stringify(result.recipe.filter)}  reasoning: ${result.recipe.reasoning}`);
      for (const mismatch of mismatches) console.log(`      ${mismatch}`);
    }
  }
}

console.table(
  outcomesByModel.map(({ model, outcomes }) => ({
    model,
    passed: `${outcomes.filter((outcome) => outcome.passed).length}/${outcomes.length}`,
    "median latency": `${(median(outcomes.map((outcome) => outcome.result.latencyMs)) / 1000).toFixed(1)}s`,
    "total cost": `$${outcomes.reduce((sum, outcome) => sum + outcome.result.usage.cost, 0).toFixed(4)}`,
  })),
);
