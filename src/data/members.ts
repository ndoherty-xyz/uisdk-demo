import type { Settings } from "./fields";

type Team = "Design" | "Engineering" | "Marketing" | "Support";

type Member = {
  id: string;
  name: string;
  team: Team;
  title: string;
  location: string;
};

const members: Member[] = [
  { id: "maya", name: "Maya Chen", team: "Design", title: "Product designer", location: "Denver" },
  { id: "jonah", name: "Jonah Park", team: "Design", title: "Product designer", location: "Seattle" },
  { id: "priya", name: "Priya Raman", team: "Design", title: "Design lead", location: "Austin" },
  { id: "tomas", name: "Tomás Ortega", team: "Design", title: "Brand designer", location: "Mexico City" },
  { id: "ines", name: "Inès Laurent", team: "Design", title: "UX researcher", location: "Lyon" },
  { id: "sam", name: "Sam Okafor", team: "Engineering", title: "Staff engineer", location: "Lagos" },
  { id: "lena", name: "Lena Fischer", team: "Engineering", title: "Frontend engineer", location: "Berlin" },
  { id: "dev", name: "Dev Malhotra", team: "Engineering", title: "Platform engineer", location: "Toronto" },
  { id: "rosa", name: "Rosa Alvarez", team: "Marketing", title: "Content strategist", location: "Madrid" },
  { id: "kenji", name: "Kenji Watanabe", team: "Marketing", title: "Growth marketer", location: "Tokyo" },
  { id: "amara", name: "Amara Nwosu", team: "Support", title: "Support specialist", location: "Dublin" },
  { id: "ben", name: "Ben Hollis", team: "Support", title: "Support lead", location: "Leeds" },
];

/** Seed values for each member's controls. The components own these after mount. */
const initialSettings: Record<Member["id"], Settings> = {
  maya: { role: "viewer", seat: "full", deployAlerts: true, weeklyDigest: false },
  jonah: { role: "viewer", seat: "full", deployAlerts: true, weeklyDigest: false },
  priya: { role: "admin", seat: "full", deployAlerts: true, weeklyDigest: true },
  tomas: { role: "viewer", seat: "guest", deployAlerts: false, weeklyDigest: false },
  ines: { role: "editor", seat: "full", deployAlerts: true, weeklyDigest: false },
  sam: { role: "admin", seat: "full", deployAlerts: true, weeklyDigest: false },
  lena: { role: "editor", seat: "full", deployAlerts: true, weeklyDigest: true },
  dev: { role: "editor", seat: "full", deployAlerts: true, weeklyDigest: false },
  rosa: { role: "viewer", seat: "guest", deployAlerts: false, weeklyDigest: true },
  kenji: { role: "editor", seat: "full", deployAlerts: false, weeklyDigest: true },
  amara: { role: "viewer", seat: "full", deployAlerts: false, weeklyDigest: false },
  ben: { role: "editor", seat: "full", deployAlerts: true, weeklyDigest: true },
};

export { initialSettings, members };
export type { Member, Team };
