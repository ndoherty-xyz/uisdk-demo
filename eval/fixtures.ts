import type { RecordedChange, Recording } from "../src/record/recording";
import type { Recipe } from "../src/recipe/schema";

type Fixture = {
  name: string;
  /** One or more rows changed the same way by hand; the last is the one the UI treats as recorded. */
  recorded: Recording[];
  hint?: string;
  /** Compared by effect: which members get which values, not by exact clause shape. */
  expected: Pick<Recipe, "filter" | "steps">;
};

const mayaChanges: RecordedChange[] = [
  { field: "role", from: "viewer", to: "editor" },
  { field: "deployAlerts", from: true, to: false },
  { field: "weeklyDigest", from: false, to: true },
];

const mayaSteps: Recipe["steps"] = [
  { field: "role", value: "editor" },
  { field: "deployAlerts", value: false },
  { field: "weeklyDigest", value: true },
];

const twoExampleChanges: RecordedChange[] = [
  { field: "deployAlerts", from: true, to: false },
  { field: "weeklyDigest", from: false, to: true },
];

const fixtures: Fixture[] = [
  {
    name: "team from hint",
    recorded: [{ memberId: "maya", changes: mayaChanges }],
    hint: "everyone on Design",
    expected: { filter: { all: [{ attr: "team", op: "eq", value: "Design" }] }, steps: mayaSteps },
  },
  {
    name: "title from hint",
    recorded: [{ memberId: "maya", changes: mayaChanges }],
    hint: "all the product designers",
    expected: { filter: { all: [{ attr: "title", op: "eq", value: "Product designer" }] }, steps: mayaSteps },
  },
  {
    name: "two teams",
    recorded: [
      {
        memberId: "amara",
        changes: [
          { field: "role", from: "viewer", to: "editor" },
          { field: "weeklyDigest", from: false, to: true },
        ],
      },
    ],
    hint: "everyone in Marketing and Support",
    expected: {
      filter: { all: [{ attr: "team", op: "in", value: ["Marketing", "Support"] }] },
      steps: [
        { field: "role", value: "editor" },
        { field: "weeklyDigest", value: true },
      ],
    },
  },
  {
    name: "everyone except a team",
    recorded: [
      {
        memberId: "rosa",
        changes: [
          { field: "seat", from: "guest", to: "full" },
          { field: "weeklyDigest", from: true, to: false },
        ],
      },
    ],
    hint: "everyone outside Design",
    expected: {
      filter: { all: [{ attr: "team", op: "neq", value: "Design" }] },
      steps: [
        { field: "seat", value: "full" },
        { field: "weeklyDigest", value: false },
      ],
    },
  },
  {
    name: "region to locations",
    recorded: [
      {
        memberId: "lena",
        changes: [
          { field: "deployAlerts", from: true, to: false },
          { field: "weeklyDigest", from: true, to: false },
        ],
      },
    ],
    hint: "people based in Europe",
    expected: {
      filter: { all: [{ attr: "location", op: "in", value: ["Lyon", "Berlin", "Madrid", "Dublin", "Leeds", "Lisbon"] }] },
      steps: [
        { field: "deployAlerts", value: false },
        { field: "weeklyDigest", value: false },
      ],
    },
  },
  {
    name: "per-step condition",
    recorded: [
      {
        memberId: "maya",
        changes: [
          { field: "role", from: "viewer", to: "editor" },
          { field: "weeklyDigest", from: false, to: true },
        ],
      },
    ],
    hint: "everyone on Design, but only turn on the digest for product designers",
    expected: {
      filter: { all: [{ attr: "team", op: "eq", value: "Design" }] },
      steps: [
        { field: "role", value: "editor" },
        { field: "weeklyDigest", value: true, when: { all: [{ attr: "title", op: "eq", value: "Product designer" }] } },
      ],
    },
  },
  {
    name: "everyone except a role",
    recorded: [{ memberId: "maya", changes: [{ field: "role", from: "viewer", to: "editor" }] }],
    hint: "make everyone an editor except admins",
    expected: {
      filter: { all: [{ attr: "role", op: "neq", value: "admin" }] },
      steps: [{ field: "role", value: "editor" }],
    },
  },
  {
    name: "team and a switch",
    recorded: [{ memberId: "dev", changes: [{ field: "weeklyDigest", from: false, to: true }] }],
    hint: "engineers who have deploy alerts on",
    expected: {
      filter: {
        all: [
          { attr: "team", op: "eq", value: "Engineering" },
          { attr: "deployAlerts", op: "eq", value: "true" },
        ],
      },
      steps: [{ field: "weeklyDigest", value: true }],
    },
  },
  {
    name: "no hint, designer",
    recorded: [{ memberId: "maya", changes: mayaChanges }],
    expected: { filter: { all: [{ attr: "team", op: "eq", value: "Design" }] }, steps: mayaSteps },
  },
  {
    name: "no hint, support lead",
    recorded: [
      {
        memberId: "ben",
        changes: [
          { field: "role", from: "editor", to: "admin" },
          { field: "deployAlerts", from: true, to: false },
        ],
      },
    ],
    expected: {
      filter: { all: [{ attr: "team", op: "eq", value: "Support" }] },
      steps: [
        { field: "role", value: "admin" },
        { field: "deployAlerts", value: false },
      ],
    },
  },
  {
    name: "two examples, same team",
    recorded: [
      { memberId: "sam", changes: twoExampleChanges },
      { memberId: "dev", changes: twoExampleChanges },
    ],
    expected: {
      filter: { all: [{ attr: "team", op: "eq", value: "Engineering" }] },
      steps: [
        { field: "deployAlerts", value: false },
        { field: "weeklyDigest", value: true },
      ],
    },
  },
  {
    name: "two examples, two teams",
    recorded: [
      {
        memberId: "kenji",
        changes: [
          { field: "role", from: "editor", to: "admin" },
          { field: "seat", from: "full", to: "guest" },
        ],
      },
      {
        memberId: "amara",
        changes: [
          { field: "role", from: "viewer", to: "admin" },
          { field: "seat", from: "full", to: "guest" },
        ],
      },
    ],
    expected: {
      filter: { all: [{ attr: "team", op: "in", value: ["Marketing", "Support"] }] },
      steps: [
        { field: "role", value: "admin" },
        { field: "seat", value: "guest" },
      ],
    },
  },
];

export { fixtures };
export type { Fixture };
