import { fields, type FieldId } from "../data/fields";

/**
 * Function to turn a field value into display text: an option's label for selects, "on"/"off"
 * for switches.
 * @param fieldId The field the value belongs to.
 * @param value The raw value, e.g. "editor" or true.
 * @returns Display text, e.g. "Editor" or "on".
 */
function format(fieldId: FieldId, value: unknown): string {
  const field = fields[fieldId];
  if (field.kind === "switch") return value ? "on" : "off";
  return field.options.find(([optionValue]) => optionValue === value)?.[1] ?? String(value);
}

export { format };
