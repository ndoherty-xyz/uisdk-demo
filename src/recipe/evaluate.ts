import type { Settings } from "../data/fields";
import type { Member } from "../data/members";
import type { Clause, Condition, Recipe, RecipeStep } from "./schema";

/**
 * Function to test one clause against a member's attributes and current settings. Comparison
 * ignores case, since models and people both type "design" for "Design".
 * @param clause The clause.
 * @param member The member.
 * @param settings The member's current settings.
 * @returns Whether the clause holds.
 */
function clauseMatches(clause: Clause, member: Member, settings: Settings): boolean {
  const actual = String({ ...member, ...settings }[clause.attr]).toLowerCase();
  const expected = [clause.value].flat().map((value) => value.toLowerCase());
  return clause.op === "neq" ? !expected.includes(actual) : expected.includes(actual);
}

/**
 * Function to test whether every clause of a condition holds for a member.
 * @param condition The condition.
 * @param member The member.
 * @param settings The member's current settings.
 * @returns Whether it matches.
 */
function conditionMatches(condition: Condition, member: Member, settings: Settings): boolean {
  return condition.all.every((clause) => clauseMatches(clause, member, settings));
}

/**
 * Function to test whether a recipe's filter selects a member.
 * @param recipe The recipe.
 * @param member The member.
 * @param settings The member's current settings.
 * @returns Whether the member is in the recipe's audience.
 */
function matches(recipe: Pick<Recipe, "filter">, member: Member, settings: Settings): boolean {
  return recipe.filter === null || conditionMatches(recipe.filter, member, settings);
}

/**
 * Function to list the steps that apply to a member after per-step `when` conditions.
 * @param recipe The recipe.
 * @param member The member.
 * @param settings The member's current settings.
 * @returns The applicable steps, in recipe order.
 */
function stepsFor(recipe: Pick<Recipe, "steps">, member: Member, settings: Settings): RecipeStep[] {
  return recipe.steps.filter((step) => !step.when || conditionMatches(step.when, member, settings));
}

/**
 * Function to list the steps that would actually change something for a member, dropping steps
 * whose value is already in place.
 * @param recipe The recipe.
 * @param member The member.
 * @param current The member's current settings.
 * @returns The steps that change a value.
 */
function changesFor(recipe: Pick<Recipe, "steps">, member: Member, current: Settings): RecipeStep[] {
  return stepsFor(recipe, member, current).filter((step) => current[step.field] !== step.value);
}

export { changesFor, conditionMatches, matches, stepsFor };
