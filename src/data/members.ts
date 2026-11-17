import type { Settings } from "./fields";

type Team = "Design" | "Engineering" | "Marketing" | "Support" | "Sales" | "Operations";

type Member = {
  id: string;
  name: string;
  team: Team;
  title: string;
  location: string;
};

/** The hand-written people the eval fixtures and tests refer to by id; generated people follow them. */
const namedMembers: Member[] = [
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

const namedSettings: Record<Member["id"], Settings> = {
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

// Generated people ----------

const memberCount = 1000;

const titlesByTeam: Record<Team, string[]> = {
  Design: ["Product designer", "Design lead", "Brand designer", "UX researcher", "Content designer"],
  Engineering: ["Frontend engineer", "Backend engineer", "Platform engineer", "Staff engineer", "Engineering manager"],
  Marketing: ["Content strategist", "Growth marketer", "Product marketer", "Marketing lead"],
  Support: ["Support specialist", "Support lead", "Solutions engineer"],
  Sales: ["Account executive", "Sales engineer", "Sales lead", "Customer success manager"],
  Operations: ["Operations manager", "Finance analyst", "Recruiter", "People partner"],
};
// Engineering is the biggest team, Design and Operations the smallest.
const teamWeights: [Team, number][] = [
  ["Engineering", 0.34],
  ["Sales", 0.18],
  ["Support", 0.16],
  ["Marketing", 0.12],
  ["Design", 0.1],
  ["Operations", 0.1],
];
const locations =
  "Denver, Seattle, Austin, Mexico City, Lyon, Lagos, Berlin, Toronto, Madrid, Tokyo, Dublin, Leeds, New York, São Paulo, Singapore, Sydney, Nairobi, Bangalore, Lisbon, Chicago".split(
    ", ",
  );
const firstNames =
  "Ada Aiko Alex Amir Ana Arjun Bea Carlos Chloe Chidi Dana Diego Elif Emma Farah Felix Grace Hana Hugo Ingrid Isaac Jade Jin Kai Kofi Lara Leo Lucia Mateo Mei Mila Nadia Nico Noor Omar Owen Paula Quinn Ravi Rina Ruth Sara Selin Tariq Tess Uma Victor Wen Yara Zane".split(
    " ",
  );
const lastNames =
  "Abara Bauer Costa Dalton Eze Fong Garcia Haddad Ito Jansen Kim Larsen Mendes Novak Ortiz Patel Quist Rossi Sato Tan Ueda Varga Weber Xu Yilmaz Zhou".split(
    " ",
  );

/**
 * Function to make a seeded random number generator (mulberry32), so every load gets the same people.
 * @param seed The seed.
 * @returns A function returning numbers in [0, 1).
 */
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seededRandom(7);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

const members: Member[] = [...namedMembers];
const initialSettingsByMember = new Map<string, Settings>(Object.entries(namedSettings));
const usedNames = new Set(namedMembers.map((member) => member.name));
while (members.length < memberCount) {
  const name = `${pick(firstNames)} ${pick(lastNames)}`;
  if (usedNames.has(name)) continue;
  usedNames.add(name);
  let teamRoll = random();
  const team = teamWeights.find(([, weight]) => (teamRoll -= weight) < 0)?.[0] ?? "Engineering";
  const id = `p${members.length + 1}`;
  members.push({ id, name, team, title: pick(titlesByTeam[team]), location: pick(locations) });
  const roleRoll = random();
  initialSettingsByMember.set(id, {
    role: roleRoll < 0.5 ? "viewer" : roleRoll < 0.85 ? "editor" : "admin",
    seat: random() < 0.85 ? "full" : "guest",
    deployAlerts: random() < (team === "Engineering" ? 0.8 : 0.35),
    weeklyDigest: random() < 0.5,
  });
}

const memberById = new Map(members.map((member) => [member.id, member]));

/** How many people have each team, title and location, e.g. `{ team: { Design: 104, … }, … }`. */
const attributeValueCounts = Object.fromEntries(
  (["team", "title", "location"] as const).map((attribute) => [
    attribute,
    Object.fromEntries(
      [...Map.groupBy(members, (member) => member[attribute])].map(([value, group]) => [value, group.length]),
    ),
  ]),
) as Record<"team" | "title" | "location", Record<string, number>>;

export { attributeValueCounts, initialSettingsByMember, memberById, members };
export type { Member, Team };
