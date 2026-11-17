import { z } from "zod";
import { fieldIds, fields, type FieldId } from "../data/fields";
import type { Member } from "../data/members";
import type { RecordedChange } from "../record/recording";

// Schema ----------

const clauseSchema = z
  .object({
    attr: z.enum(["team", "title", "location"]),
    op: z.enum(["eq", "neq", "in"]).describe("`in` takes an array of strings; `eq` and `neq` take one string."),
    value: z.union([z.string(), z.array(z.string()).min(1)]),
  })
  .refine((clause) => (clause.op === "in") === Array.isArray(clause.value), {
    message: "`in` takes an array of strings; `eq` and `neq` take one string",
  });

const conditionSchema = z.object({
  all: z.array(clauseSchema).min(1).describe("Every clause must hold (AND)."),
});

/**
 * Function to build the step schema for one field, so the value must be one of that field's
 * legal values.
 * @param fieldId The field.
 * @returns A zod object for steps that set this field.
 */
function stepSchemaFor(fieldId: FieldId) {
  const field = fields[fieldId];
  const value =
    field.kind === "select"
      ? z.enum(field.options.map(([optionValue]) => optionValue) as [string, ...string[]])
      : z.boolean();
  return z.object({
    field: z.literal(fieldId),
    value,
    when: conditionSchema.optional().describe("Only set when the hint asks for a per-step condition."),
  });
}

type StepSchema = ReturnType<typeof stepSchemaFor>;

const recipeSchema = z.object({
  // Reasoning comes first so models think before they commit to a filter.
  reasoning: z.string().describe("Why the filter generalizes the recording this way. One or two sentences."),
  title: z.string().min(1).max(40).describe("Sentence case, at most 40 characters, e.g. 'Make designers editors'."),
  summary: z.string().describe("One plain-language sentence describing what the recipe does."),
  filter: conditionSchema.nullable().describe("Who the recipe applies to. null means everyone."),
  steps: z
    .array(z.discriminatedUnion("field", fieldIds.map(stepSchemaFor) as [StepSchema, ...StepSchema[]]))
    .min(1)
    .max(4)
    .refine((steps) => new Set(steps.map((step) => step.field)).size === steps.length, {
      message: "Use each field at most once",
    }),
});

type Clause = z.infer<typeof clauseSchema>;
type Condition = z.infer<typeof conditionSchema>;
type Recipe = z.infer<typeof recipeSchema>;
type RecipeStep = Recipe["steps"][number];

// Request ----------

/** Body of `POST /api/recipe`. */
type RecipeRequest = {
  /** One or more rows the person changed the same way by hand. */
  recorded: { member: Member; changes: RecordedChange[] }[];
  /** How many people have each team, title and location. */
  attributeValueCounts: Record<"team" | "title" | "location", Record<string, number>>;
  fields: typeof fields;
  hint?: string;
  /** OpenRouter slug; the server's default when absent. */
  model?: string;
};

type RecipeResponse = { recipe: unknown; model: string } | { error: string };

export { recipeSchema };
export type { Clause, Condition, Recipe, RecipeRequest, RecipeResponse, RecipeStep };
