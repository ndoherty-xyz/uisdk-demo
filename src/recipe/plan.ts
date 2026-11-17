import type { AgentComponent } from "@ui-sdk/react/agent";
import { fieldIdOfLabel, fields, type FieldId, type Settings } from "../data/fields";
import type { Member } from "../data/members";
import { changesFor } from "./evaluate";
import type { Recipe } from "./schema";

type PlannedStep = {
  field: FieldId;
  /** The control in this member's row; undefined if it wasn't in the snapshot. */
  ref: string | undefined;
  action: "setValue" | "setChecked";
  args: [string | boolean];
  before: unknown;
};

/**
 * Function to turn a recipe into concrete `act` steps for one member, resolving each field to the
 * control in that member's row. Steps whose value is already in place are dropped.
 * @param recipe The recipe.
 * @param member The member to plan for.
 * @param components A fresh `agent.snapshot()`.
 * @param memberIdOfRef Maps a component ref to the member whose row holds it.
 * @returns One step per field that would change, in recipe order.
 */
function plan(
  recipe: Pick<Recipe, "steps">,
  member: Member,
  components: AgentComponent[],
  memberIdOfRef: (ref: string) => string | undefined,
): PlannedStep[] {
  const componentByField = new Map(
    components
      .filter((component) => memberIdOfRef(component.ref) === member.id)
      .map((component) => [fieldIdOfLabel(component.label!), component]),
  );
  const current = Object.fromEntries(
    [...componentByField].map(([fieldId, component]) => [fieldId, component[fields[fieldId].key]]),
  ) as Settings;

  return changesFor(recipe, member, current).map((step) => ({
    field: step.field,
    ref: componentByField.get(step.field)?.ref,
    action: fields[step.field].key === "checked" ? "setChecked" : "setValue",
    args: [step.value],
    before: current[step.field],
  }));
}

export { plan };
export type { PlannedStep };
