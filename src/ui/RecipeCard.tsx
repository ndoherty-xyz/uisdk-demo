import { fields, type FieldId } from "../data/fields";
import { members, type Member } from "../data/members";
import { matches } from "../recipe/evaluate";
import type { Clause, Condition, Recipe, RecipeStep } from "../recipe/schema";

const attrLabels: Record<Clause["attr"], string> = { team: "Team", title: "Title", location: "Location" };
const opLabels: Record<Clause["op"], string> = { eq: "is", neq: "is not", in: "is one of" };

/** Every distinct value per attribute, for the clause value suggestions. */
const valuesByAttr = Object.fromEntries(
  (Object.keys(attrLabels) as Clause["attr"][]).map((attr) => [attr, [...new Set(members.map((member) => member[attr]))]]),
) as Record<Clause["attr"], string[]>;

// Clauses ----------

/**
 * Function to render a condition as plain text: "Title is Product designer".
 * @param condition The condition.
 * @returns The text.
 */
function describeCondition(condition: Condition): string {
  return condition.all
    .map((clause) => `${attrLabels[clause.attr]} ${opLabels[clause.op]} ${[clause.value].flat().join(", ")}`)
    .join(" and ");
}

/**
 * Function to render one editable filter clause. The value is a free-text field with suggestions;
 * for "is one of" it takes a comma-separated list.
 * @param props.clause The clause.
 * @param props.onChange Called with the edited clause.
 * @param props.onRemove Called when the clause is removed.
 * @returns The clause row.
 */
function ClauseEditor({ clause, onChange, onRemove }: { clause: Clause; onChange: (clause: Clause) => void; onRemove: () => void }) {
  const listId = `values-${clause.attr}`;
  return (
    <li className="clause">
      <select
        aria-label="Attribute"
        value={clause.attr}
        onChange={(event) => onChange({ ...clause, attr: event.target.value as Clause["attr"] })}
      >
        {Object.entries(attrLabels).map(([attr, label]) => (
          <option key={attr} value={attr}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="Operator"
        value={clause.op}
        onChange={(event) => {
          const op = event.target.value as Clause["op"];
          const values = [clause.value].flat();
          onChange({ ...clause, op, value: op === "in" ? values : values.join(", ") });
        }}
      >
        {Object.entries(opLabels).map(([op, label]) => (
          <option key={op} value={op}>
            {label}
          </option>
        ))}
      </select>
      {/* Uncontrolled so typing a comma isn't reformatted away mid-list; keyed by op to reset on switch. */}
      <input
        key={clause.op}
        aria-label="Value"
        list={listId}
        defaultValue={[clause.value].flat().join(", ")}
        onChange={(event) => {
          const text = event.target.value;
          const value = clause.op === "in" ? text.split(",").map((part) => part.trim()).filter(Boolean) : text.trim();
          onChange({ ...clause, value });
        }}
      />
      <datalist id={listId}>
        {valuesByAttr[clause.attr].map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <button type="button" className="icon-button" aria-label="Remove condition" onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

// Steps ----------

/**
 * Function to list the values a step can be set to, as [value, label] pairs.
 * @param fieldId The field.
 * @returns The options; switches get on/off.
 */
function stepOptions(fieldId: FieldId): readonly (readonly [string | boolean, string])[] {
  const field = fields[fieldId];
  return field.kind === "select" ? field.options : [[true, "on"], [false, "off"]];
}

/**
 * Function to render one step with its value as a dropdown.
 * @param props.step The step.
 * @param props.canRemove Whether it can be deleted (the last step can't).
 * @param props.onChange Called with the edited step.
 * @param props.onRemove Called when the step is deleted.
 * @returns The step row.
 */
function StepEditor({
  step,
  canRemove,
  onChange,
  onRemove,
}: {
  step: RecipeStep;
  canRemove: boolean;
  onChange: (step: RecipeStep) => void;
  onRemove: () => void;
}) {
  const options = stepOptions(step.field);
  return (
    <li className="step">
      <span>{fields[step.field].label} →</span>
      <select
        aria-label={`${fields[step.field].label} value`}
        value={String(step.value)}
        onChange={(event) => {
          const value = options.find(([optionValue]) => String(optionValue) === event.target.value)![0];
          onChange({ ...step, value } as RecipeStep);
        }}
      >
        {options.map(([value, label]) => (
          <option key={String(value)} value={String(value)}>
            {label}
          </option>
        ))}
      </select>
      {step.when && <span className="muted">only where {describeCondition(step.when)}</span>}
      <button type="button" className="icon-button" aria-label={`Remove ${fields[step.field].label}`} disabled={!canRemove} onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

// Card ----------

/**
 * Function to render the editable recipe: title, who it applies to (with a live count), and the
 * steps. Every edit goes straight back through `onChange`.
 * @param props.recipe The recipe.
 * @param props.recordedMember The person the recording came from; new conditions start from their team.
 * @param props.isMaking Whether a regeneration is in flight.
 * @param props.onChange Called with the edited recipe.
 * @param props.onRegenerate Called when Regenerate is pressed.
 * @returns The card.
 */
function RecipeCard({
  recipe,
  recordedMember,
  isMaking,
  onChange,
  onRegenerate,
}: {
  recipe: Recipe;
  recordedMember: Member;
  isMaking: boolean;
  onChange: (recipe: Recipe) => void;
  onRegenerate: () => void;
}) {
  const matchedCount = members.filter((member) => matches(recipe, member)).length;
  const clauses = recipe.filter?.all ?? [];
  const setClauses = (all: Clause[]) => onChange({ ...recipe, filter: all.length ? { all } : null });

  return (
    <section className="recipe-card" aria-label="Recipe" aria-busy={isMaking}>
      <header>
        <h2>{recipe.title}</h2>
        <p className="muted">{recipe.summary}</p>
      </header>

      <div className="recipe-section">
        <p>
          For {clauses.length ? "people where" : <strong>everyone</strong>}{" "}
          <span className="muted">
            ({matchedCount} {matchedCount === 1 ? "person" : "people"})
          </span>
        </p>
        {clauses.length > 0 && (
          <ul className="clauses">
            {clauses.map((clause, index) => (
              <ClauseEditor
                // Index keys: clauses have no id, and the list only changes at the end or by removal.
                key={`${index}-${clauses.length}`}
                clause={clause}
                onChange={(edited) => setClauses(clauses.map((existing, at) => (at === index ? edited : existing)))}
                onRemove={() => setClauses(clauses.filter((_, at) => at !== index))}
              />
            ))}
          </ul>
        )}
        <div className="recipe-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => setClauses([...clauses, { attr: "team", op: "eq", value: recordedMember.team }])}
          >
            Add condition
          </button>
          {clauses.length > 0 && (
            <button type="button" className="link-button" onClick={() => setClauses([])}>
              Everyone
            </button>
          )}
        </div>
      </div>

      <ul className="recipe-section steps">
        {recipe.steps.map((step, index) => (
          <StepEditor
            key={step.field}
            step={step}
            canRemove={recipe.steps.length > 1}
            onChange={(edited) => onChange({ ...recipe, steps: recipe.steps.map((existing, at) => (at === index ? edited : existing)) })}
            onRemove={() => onChange({ ...recipe, steps: recipe.steps.filter((_, at) => at !== index) })}
          />
        ))}
      </ul>

      <footer className="recipe-footer">
        <details>
          <summary>Why this filter</summary>
          <p className="muted">{recipe.reasoning}</p>
        </details>
        <button type="button" className="button" disabled={isMaking} onClick={onRegenerate}>
          {isMaking ? "Regenerating…" : "Regenerate"}
        </button>
      </footer>
    </section>
  );
}

export { RecipeCard };
