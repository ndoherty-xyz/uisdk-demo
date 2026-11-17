const fields = {
  role: {
    label: "Role",
    key: "value",
    kind: "select",
    options: [
      ["viewer", "Viewer"],
      ["editor", "Editor"],
      ["admin", "Admin"],
    ],
  },
  seat: {
    label: "Seat",
    key: "value",
    kind: "select",
    options: [
      ["full", "Full"],
      ["guest", "Guest"],
    ],
  },
  deployAlerts: { label: "Deploy alerts", key: "checked", kind: "switch" },
  weeklyDigest: { label: "Weekly digest", key: "checked", kind: "switch" },
} as const;

type Fields = typeof fields;
type FieldId = keyof Fields;
type SelectFieldId = { [Id in FieldId]: Fields[Id]["kind"] extends "select" ? Id : never }[FieldId];

/** Current value of every field for one member: option value for selects, boolean for switches. */
type Settings = {
  [Id in FieldId]: Fields[Id] extends { options: readonly (readonly [infer Value, string])[] } ? Value : boolean;
};

const fieldIds = Object.keys(fields) as FieldId[];

export { fieldIds, fields };
export type { FieldId, SelectFieldId, Settings };
