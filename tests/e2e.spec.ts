import { expect, test, type Page } from "@playwright/test";
import type { Settings } from "../src/data/fields";
import { initialSettingsByMember, members, type Member } from "../src/data/members";
import { changesFor, matches } from "../src/recipe/evaluate";
import type { Recipe } from "../src/recipe/schema";

// A fixed recipe, so the run is tested without calling a model.
const recipe: Recipe = {
  reasoning: "The hint names the Design team.",
  audience: "everyone on Design",
  filter: { all: [{ attr: "team", op: "eq", value: "Design" }] },
  steps: [
    { field: "role", value: "editor" },
    { field: "deployAlerts", value: false },
    { field: "weeklyDigest", value: true },
  ],
};

// Most tests use Design in Seattle: Jonah near the top and two people far down the table.
const seattleRecipe: Recipe = {
  ...recipe,
  audience: "designers in Seattle",
  filter: {
    all: [
      { attr: "team", op: "eq", value: "Design" },
      { attr: "location", op: "eq", value: "Seattle" },
    ],
  },
};

type DebugWindow = { members: Member[]; readSettings: (memberId: string) => Settings };

/**
 * Function to count who a run would change on a fresh page once Maya and Sam are done by hand.
 * @param runRecipe The recipe.
 * @returns How many rows the run would change.
 */
function runTargetCount(runRecipe: Recipe): number {
  return members.filter((member) => {
    const settings = initialSettingsByMember.get(member.id)!;
    return (
      !["maya", "sam"].includes(member.id) &&
      matches(runRecipe, member, settings) &&
      changesFor(runRecipe, member, settings).length > 0
    );
  }).length;
}

/**
 * Function to read one member's settings from the store.
 * @param page The page.
 * @param memberId The member.
 * @returns Their settings.
 */
async function rowValues(page: Page, memberId: string): Promise<Settings> {
  return page.evaluate((id) => (window as unknown as DebugWindow).readSettings(id), memberId);
}

/**
 * Function to read everyone's settings from the store.
 * @param page The page.
 * @returns Settings in table order.
 */
async function allValues(page: Page): Promise<Settings[]> {
  return page.evaluate(() => {
    const { members, readSettings } = window as unknown as DebugWindow;
    return members.map((member) => readSettings(member.id));
  });
}

/**
 * Function to scroll the table back to the top, where the named people are.
 * @param page The page.
 */
async function scrollTableToTop(page: Page) {
  await page.locator(".table-wrap").evaluate((scroller) => scroller.scrollTo({ top: 0 }));
}

/**
 * Function to make the recipe's change by hand on one row: Editor, alerts off, digest on.
 * @param page The page.
 * @param memberId Whose row.
 */
async function changeRowByHand(page: Page, memberId: string) {
  const row = page.locator(`tr[data-member-id="${memberId}"]`);
  await row.locator('[data-slot="select-trigger"]').first().click();
  await page.getByRole("option", { name: "Editor" }).click();
  await row.locator('[data-slot="switch"]').nth(0).click();
  await row.locator('[data-slot="switch"]').nth(1).click();
}

/**
 * Function to change Maya and Sam the same way by hand, then accept the offer, leaving the
 * "Who should get this?" panel open.
 * @param page The page.
 * @param madeRecipe The recipe the mocked model returns.
 */
async function automateMayaAndSam(page: Page, madeRecipe: Recipe = seattleRecipe) {
  await page.route("/api/recipe", (route) => route.fulfill({ json: { recipe: madeRecipe, model: "fixed" } }));
  await page.goto("/");
  await changeRowByHand(page, "maya");
  await changeRowByHand(page, "sam");
  await page.locator(".agent-launcher", { hasText: "Automate?" }).click();
  await expect(page.locator(".agent-pattern")).toBeVisible();
}

test("running a recipe scrolls through the table and gives every Design row the recipe's values", async ({ page }) => {
  // About 90 rows, each scrolled to and visited by the cursor.
  test.setTimeout(60_000);
  await automateMayaAndSam(page, recipe);
  const targetCount = runTargetCount(recipe);
  const panel = page.locator(".agent-panel");
  await panel.getByRole("button", { name: `Run on ${targetCount} more` }).click();
  await expect(panel).toContainText(`Updated ${targetCount} people.`, { timeout: 60_000 });

  const settingsByMember = await allValues(page);
  for (const [index, member] of members.entries()) {
    const expected =
      member.team === "Design" || member.id === "sam"
        ? { role: "editor", deployAlerts: false, weeklyDigest: true }
        : initialSettingsByMember.get(member.id);
    expect(settingsByMember[index], member.id).toMatchObject(expected!);
  }
});

test("the panel shows the rule as chips, previews rows from data, and remakes the rule from words", async ({
  page,
}) => {
  const austinRecipe: Recipe = {
    ...recipe,
    audience: "designers in Austin except admins",
    filter: {
      all: [
        { attr: "team", op: "eq", value: "Design" },
        { attr: "location", op: "eq", value: "Austin" },
        { attr: "role", op: "neq", value: "admin" },
      ],
    },
  };
  await automateMayaAndSam(page);
  await page.route("/api/recipe", (route) => route.fulfill({ json: { recipe: austinRecipe, model: "fixed" } }));
  const before = await allValues(page);
  const panel = page.locator(".agent-pattern");
  const audience = panel.getByLabel("Who should get this?");
  const previewed = page.locator("tr[data-preview]");
  const jonah = page.locator('tr[data-member-id="jonah"]');

  await expect(audience).toHaveValue("designers in Seattle");
  await expect(panel.getByRole("list", { name: "Rule" }).getByRole("listitem")).toHaveText([
    "Team is Design",
    "Location is Seattle",
  ]);
  await expect(panel).toContainText("4 people");
  // Only Jonah is on screen; the other Seattle designers are far down the table.
  await expect(previewed).toHaveCount(1);
  await expect(jonah.locator(".preview-next")).toHaveText(["→ Editor", "→ off", "→ on"]);
  expect(await rowValues(page, "jonah")).toMatchObject({ role: "viewer", deployAlerts: true, weeklyDigest: false });

  // New words remake the rule, settings included: Priya is Austin's admin, so she's left out.
  await audience.fill("designers in Austin except admins");
  await panel.getByRole("button", { name: "Update rule" }).click();
  await expect(panel.getByRole("list", { name: "Rule" }).getByRole("listitem")).toHaveText([
    "Team is Design",
    "Location is Austin",
    "Role is not Admin",
  ]);
  await expect(previewed).toHaveCount(0);
  await expect(panel.getByRole("button", { name: `Run on ${runTargetCount(austinRecipe)} more` })).toBeVisible();

  await panel.getByRole("button", { name: "Cancel" }).click();
  expect(await allValues(page)).toEqual(before);
});

test("removing one change from a run reverts only that field, and undoing the run restores the rest", async ({
  page,
}) => {
  await automateMayaAndSam(page);
  const valuesBefore = await allValues(page);
  const targetCount = runTargetCount(seattleRecipe);
  await page
    .locator(".agent-panel")
    .getByRole("button", { name: `Run on ${targetCount} more` })
    .click();
  await expect(page.locator(".agent-panel")).toContainText(`Updated ${targetCount} people.`, { timeout: 15_000 });
  const runCard = page.locator(".run-card");
  await expect(runCard).toContainText(`designers in Seattle`);
  await runCard.click();
  await expect(page.locator(".run-turn")).toHaveCount(targetCount);

  // Jonah's row has scrolled away by now, so removing his change scrolls back to it.
  const jonahTurn = page.locator(".run-turn", { hasText: "Jonah Park" });
  await expect(jonahTurn.locator(".change-chip")).toHaveCount(3);
  const alertsChip = jonahTurn.locator(".change-chip", { hasText: "Deploy alerts" });
  await alertsChip.getByRole("button", { name: "Remove" }).click();
  await expect(alertsChip).toHaveAttribute("data-removed");
  await expect
    .poll(() => rowValues(page, "jonah"))
    .toMatchObject({ role: "editor", deployAlerts: true, weeklyDigest: true });

  await page.locator(".run-history").getByRole("button", { name: "Undo run" }).click();
  await expect.poll(() => allValues(page)).toEqual(valuesBefore);
  await expect(page.locator(".run-kept")).toHaveCount(0);
  await page.getByRole("button", { name: "← Runs" }).click();
  await expect(runCard).toContainText("undone");
});

test("Undo row keeps a change the person made after the run and says so", async ({ page }) => {
  await automateMayaAndSam(page);
  const targetCount = runTargetCount(seattleRecipe);
  await page
    .locator(".agent-panel")
    .getByRole("button", { name: `Run on ${targetCount} more` })
    .click();
  await expect(page.locator(".agent-panel")).toContainText(`Updated ${targetCount} people.`, { timeout: 15_000 });
  const runCard = page.locator(".run-card");
  await expect(runCard).toContainText(`designers in Seattle`);
  await runCard.click();
  await expect(page.locator(".run-turn")).toHaveCount(targetCount);

  await scrollTableToTop(page);
  await page.locator('tr[data-member-id="jonah"] [data-slot="select-trigger"]').first().click();
  await page.getByRole("option", { name: "Admin" }).click();

  const jonahTurn = page.locator(".run-turn", { hasText: "Jonah Park" });
  await expect(jonahTurn.locator(".change-chip", { hasText: "Role" })).toContainText("changed since");
  await jonahTurn.getByRole("button", { name: "Undo row" }).click();
  await expect(page.locator(".run-kept")).toHaveText("Kept Role for Jonah Park: you changed it after the agent.");
  await expect
    .poll(() => rowValues(page, "jonah"))
    .toMatchObject({ role: "admin", deployAlerts: true, weeklyDigest: false });
});

test("changing two rows the same way by hand offers to automate it, once", async ({ page }) => {
  const targetCount = runTargetCount(seattleRecipe);
  const requests: unknown[] = [];
  await page.route("/api/recipe", (route) => {
    requests.push(route.request().postDataJSON());
    // Slow enough to see the status shown while the recipe is made.
    return new Promise((resolve) => setTimeout(resolve, 1000)).then(() =>
      route.fulfill({ json: { recipe: seattleRecipe, model: "fixed" } }),
    );
  });
  await page.goto("/");
  await changeRowByHand(page, "maya");
  await changeRowByHand(page, "sam");

  // Closed, agent mode surfaces what it noticed on its launcher.
  const launcher = page.locator(".agent-launcher");
  await expect(launcher).toHaveText("Noticed a pattern in Maya Chen and Sam Okafor…");
  await expect(launcher).toHaveText("Noticed a pattern in Maya Chen and Sam Okafor. Automate?");
  expect(requests).toHaveLength(1);
  expect((requests[0] as { recorded: { member: { id: string } }[] }).recorded.map((r) => r.member.id)).toEqual([
    "maya",
    "sam",
  ]);

  await launcher.click();
  const panel = page.locator(".agent-panel");
  await panel.getByRole("button", { name: `Run on ${targetCount} more` }).click();
  await expect(panel).toContainText(`Updated ${targetCount} people.`, { timeout: 15_000 });
  expect(await rowValues(page, "p688")).toMatchObject({ role: "editor", deployAlerts: false, weeklyDigest: true });

  // Offered once: the same change by hand on another row doesn't bring it back.
  await panel.getByRole("button", { name: "Done" }).click();
  await scrollTableToTop(page);
  await changeRowByHand(page, "p13");
  await page.waitForTimeout(2500);
  await expect(panel).toContainText("Change a couple of rows the same way");
  expect(requests).toHaveLength(1);
});

test("the ghost cursor visits each control before its change, then hides", async ({ page }) => {
  await automateMayaAndSam(page);
  const cursor = page.locator(".ghost-cursor");
  await expect(cursor).toHaveCSS("opacity", "0");
  const targetCount = runTargetCount(seattleRecipe);
  await page
    .locator(".agent-panel")
    .getByRole("button", { name: `Run on ${targetCount} more` })
    .click();

  // Jonah's Role is the first change; the cursor lands on its trigger before it flips to Editor.
  await expect(cursor).toHaveAttribute("data-visible");
  const jonahRole = page.locator('tr[data-member-id="jonah"] [data-slot="select-trigger"]').first();
  await expect
    .poll(async () => {
      const [cursorBox, roleBox] = [await cursor.boundingBox(), await jonahRole.boundingBox()];
      return Math.hypot(
        cursorBox!.x - (roleBox!.x + roleBox!.width / 2),
        cursorBox!.y - (roleBox!.y + roleBox!.height / 2),
      );
    })
    .toBeLessThan(3);

  await expect(page.locator(".agent-panel")).toContainText(`Updated ${targetCount} people.`, { timeout: 15_000 });
  await expect(cursor).not.toHaveAttribute("data-visible", { timeout: 3000 });
});

test("with reduced motion the cursor jumps and the run still finishes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await automateMayaAndSam(page);
  const targetCount = runTargetCount(seattleRecipe);
  await page
    .locator(".agent-panel")
    .getByRole("button", { name: `Run on ${targetCount} more` })
    .click();
  await expect(page.locator(".agent-panel")).toContainText(`Updated ${targetCount} people.`, { timeout: 15_000 });
  expect(await page.locator(".ghost-cursor").evaluate((cursor) => cursor.getAnimations().length)).toBe(0);
});
