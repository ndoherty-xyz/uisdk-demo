import type { RecordedChange } from "../src/record/recording";
import type { Recipe } from "../src/recipe/schema";

type Fixture = {
  name: string;
  recordedMemberId: string;
  changes: RecordedChange[];
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

const fixtures: Fixture[] = [
  {
    name: "team from hint",
    recordedMemberId: "maya",
    changes: mayaChanges,
    hint: "everyone on Design",
    expected: { filter: { all: [{ attr: "team", op: "eq", value: "Design" }] }, steps: mayaSteps },
  },
  {
    name: "title from hint",
    recordedMemberId: "maya",
    changes: mayaChanges,
    hint: "all the product designers",
    expected: { filter: { all: [{ attr: "title", op: "eq", value: "Product designer" }] }, steps: mayaSteps },
  },
  {
    name: "two teams",
    recordedMemberId: "amara",
    changes: [
      { field: "role", from: "viewer", to: "editor" },
      { field: "weeklyDigest", from: false, to: true },
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
    recordedMemberId: "rosa",
    changes: [
      { field: "seat", from: "guest", to: "full" },
      { field: "weeklyDigest", from: true, to: false },
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
    recordedMemberId: "lena",
    changes: [
      { field: "deployAlerts", from: true, to: false },
      { field: "weeklyDigest", from: true, to: false },
    ],
    hint: "people based in Europe",
    expected: {
      filter: { all: [{ attr: "location", op: "in", value: ["Lyon", "Berlin", "Madrid", "Dublin", "Leeds"] }] },
      steps: [
        { field: "deployAlerts", value: false },
        { field: "weeklyDigest", value: false },
      ],
    },
  },
  {
    name: "per-step condition",
    recordedMemberId: "maya",
    changes: [
      { field: "role", from: "viewer", to: "editor" },
      { field: "weeklyDigest", from: false, to: true },
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
    name: "no hint, designer",
    recordedMemberId: "maya",
    changes: mayaChanges,
    expected: { filter: { all: [{ attr: "team", op: "eq", value: "Design" }] }, steps: mayaSteps },
  },
  {
    name: "no hint, support lead",
    recordedMemberId: "ben",
    changes: [
      { field: "role", from: "editor", to: "admin" },
      { field: "deployAlerts", from: true, to: false },
    ],
    expected: {
      filter: { all: [{ attr: "team", op: "eq", value: "Support" }] },
      steps: [
        { field: "role", value: "admin" },
        { field: "deployAlerts", value: false },
      ],
    },
  },
];

export { fixtures };
export type { Fixture };
