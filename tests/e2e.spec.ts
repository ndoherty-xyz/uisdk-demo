import { expect, test, type Page } from "@playwright/test";
import type { Settings } from "../src/data/fields";
import { initialSettingsByMember, members, type Member } from "../src/data/members";
import { changesFor, matches } from "../src/recipe/evaluate";
import type { Recipe } from "../src/recipe/schema";

// A fixed recipe, so the run is tested without calling a model.
const recipe: Recipe = {
  reasoning: "The hint names the Design team.",
  title: "Make designers editors",
  summary: "Makes everyone on Design an editor with alerts off and the digest on.",
  filter: { all: [{ attr: "team", op: "eq", value: "Design" }] },
  steps: [
    { field: "role", value: "editor" },
    { field: "deployAlerts", value: false },
    { field: "weeklyDigest", value: true },
  ],
};

// Most tests use Design in Seattle: Jonah near the top and three people far down the table.
const seattleRecipe: Recipe = {
  ...recipe,
  filter: {
    all: [
      { attr: "team", op: "eq", value: "Design" },
      { attr: "location", op: "eq", value: "Seattle" },
    ],
  },
};

type DebugWindow = { members: Member[]; readSettings: (memberId: string) => Settings };

/**
 * Function to count who a run would change on a fresh page, from the seed data.
 * @param runRecipe The recipe.
 * @param exceptMemberId The example row, already done.
 * @returns How many rows the run would change.
 */
function runTargetCount(runRecipe: Recipe, exceptMemberId: string): number {
  return members.filter(
    (member) =>
      member.id !== exceptMemberId &&
      matches(runRecipe, member) &&
      changesFor(runRecipe, member, initialSettingsByMember.get(member.id)!).length > 0,
  ).length;
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
 * Function to read everyone's settings but one member's from the store.
 * @param page The page.
 * @param exceptMemberId The member to leave out.
 * @returns Settings in table order.
 */
async function valuesExcept(page: Page, exceptMemberId: string): Promise<Settings[]> {
  return page.evaluate((exceptId) => {
    const { members, readSettings } = window as unknown as DebugWindow;
    return members.filter((member) => member.id !== exceptId).map((member) => readSettings(member.id));
  }, exceptMemberId);
}

/**
 * Function to scroll the table back to the top, where the named people are.
 * @param page The page.
 */
async function scrollTableToTop(page: Page) {
  await page.locator(".table-wrap").evaluate((scroller) => scroller.scrollTo({ top: 0 }));
}

/**
 * Function to record Maya's three changes and make a fixed recipe, leaving the card showing.
 * @param page The page.
 * @param madeRecipe The recipe the mocked model returns.
 */
async function recordMayaAndMakeRecipe(page: Page, madeRecipe: Recipe = seattleRecipe) {
  await page.route("/api/recipe", (route) => route.fulfill({ json: { recipe: madeRecipe, model: "fixed" } }));
  await page.goto("/");
  const bar = page.locator(".agent-bar");
  const maya = page.locator('tr[data-member-id="maya"]');

  await bar.getByRole("button", { name: "Show me" }).click();
  await maya.locator('[data-slot="select-trigger"]').first().click();
  await page.getByRole("option", { name: "Editor" }).click();
  await maya.locator('[data-slot="switch"]').nth(0).click();
  await maya.locator('[data-slot="switch"]').nth(1).click();
  await bar.getByRole("button", { name: "Done" }).click();
  await bar.getByRole("button", { name: "Make a recipe" }).click();
  await expect(page.locator(".recipe-card")).toBeVisible();
}

test("running a recipe scrolls through the table and gives every Design row the recipe's values", async ({ page }) => {
  await recordMayaAndMakeRecipe(page, recipe);
  const targetCount = runTargetCount(recipe, "maya");
  const bar = page.locator(".agent-bar");
  await bar.getByRole("button", { name: `Run on ${targetCount} more` }).click();
  await expect(bar).toContainText(`Updated ${targetCount} people.`, { timeout: 60_000 });

  const settingsByMember = await valuesExcept(page, "");
  for (const [index, member] of members.entries()) {
    const expected =
      member.team === "Design"
        ? { role: "editor", deployAlerts: false, weeklyDigest: true }
        : initialSettingsByMember.get(member.id);
    expect(settingsByMember[index], member.id).toMatchObject(expected!);
  }
});

test("an open recipe previews the rows it would change from data, without changing them", async ({ page }) => {
  await page.goto("/");
  const before = await valuesExcept(page, "maya");
  await recordMayaAndMakeRecipe(page);
  const previewed = page.locator("tr[data-preview]");
  const jonah = page.locator('tr[data-member-id="jonah"]');

  // Only Jonah is on screen; the other Seattle designers are far down the table.
  await expect(previewed).toHaveCount(1);
  await expect(jonah.locator(".preview-next")).toHaveText(["→ Editor", "→ off", "→ on"]);
  expect(await rowValues(page, "jonah")).toMatchObject({ role: "viewer", deployAlerts: true, weeklyDigest: false });
  await expect(
    page.getByRole("button", { name: `Run on ${runTargetCount(seattleRecipe, "maya")} more` }),
  ).toBeVisible();

  // Narrowing the recipe moves the preview: Austin instead of Seattle.
  const locationInput = page.locator(".recipe-card .clause input").nth(1);
  await locationInput.fill("Austin");
  await locationInput.blur();
  await expect(previewed).toHaveCount(1);
  await expect(page.locator('tr[data-member-id="priya"]')).toHaveAttribute("data-preview");

  await page.locator(".agent-bar").getByRole("button", { name: "Start over" }).click();
  await expect(previewed).toHaveCount(0);
  expect(await valuesExcept(page, "maya")).toEqual(before);
});

test("removing one change from a toast reverts only that field, and undoing the run restores the rest", async ({
  page,
}) => {
  await recordMayaAndMakeRecipe(page);
  const valuesBefore = await valuesExcept(page, "maya");
  const targetCount = runTargetCount(seattleRecipe, "maya");
  await page
    .locator(".agent-bar")
    .getByRole("button", { name: `Run on ${targetCount} more` })
    .click();
  await expect(page.locator(".toast")).toHaveCount(targetCount, { timeout: 15_000 });

  // Jonah's row has scrolled away by now, so removing his change scrolls back to it.
  const jonahToast = page.locator(".toast", { hasText: "Jonah Park" });
  await expect(jonahToast).toContainText("Jonah Park: 3 changes");
  await page.locator(".toast-stack").hover();
  const alertsLine = jonahToast.locator(".toast-change", { hasText: "Deploy alerts" });
  await alertsLine.getByRole("button", { name: "Remove" }).click();
  await expect(alertsLine).toContainText("Removed");
  await expect
    .poll(() => rowValues(page, "jonah"))
    .toMatchObject({ role: "editor", deployAlerts: true, weeklyDigest: true });

  await page.locator(".toast-stack").getByRole("button", { name: "Undo the whole run" }).click();
  await expect.poll(() => valuesExcept(page, "maya")).toEqual(valuesBefore);
  await expect(page.locator(".toast-kept")).toHaveCount(0);
});

test("Undo row keeps a change the person made after the run and says so", async ({ page }) => {
  await recordMayaAndMakeRecipe(page);
  const targetCount = runTargetCount(seattleRecipe, "maya");
  await page
    .locator(".agent-bar")
    .getByRole("button", { name: `Run on ${targetCount} more` })
    .click();
  await expect(page.locator(".toast")).toHaveCount(targetCount, { timeout: 15_000 });

  await scrollTableToTop(page);
  await page.locator('tr[data-member-id="jonah"] [data-slot="select-trigger"]').first().click();
  await page.getByRole("option", { name: "Admin" }).click();

  const jonahToast = page.locator(".toast", { hasText: "Jonah Park" });
  await page.locator(".toast-stack").hover();
  await expect(jonahToast.locator(".toast-change", { hasText: "Role" })).toContainText("Changed since");
  await jonahToast.getByRole("button", { name: "Undo row" }).click();
  await expect(page.locator(".toast-kept")).toHaveText("Kept Role for Jonah Park: you changed it after the agent.");
  await expect
    .poll(() => rowValues(page, "jonah"))
    .toMatchObject({ role: "admin", deployAlerts: true, weeklyDigest: false });
});

test("changing two rows the same way by hand offers a ready recipe for the rest", async ({ page }) => {
  const nudgeRecipe: Recipe = { ...seattleRecipe, steps: recipe.steps.filter((step) => step.field !== "role") };
  const targetCount = runTargetCount(nudgeRecipe, "jonah");
  const requests: unknown[] = [];
  await page.route("/api/recipe", (route) => {
    requests.push(route.request().postDataJSON());
    // Slow enough to see the status shown while the recipe is made.
    return new Promise((resolve) => setTimeout(resolve, 1000)).then(() =>
      route.fulfill({ json: { recipe: nudgeRecipe, model: "fixed" } }),
    );
  });
  await page.goto("/");
  for (const id of ["maya", "jonah"]) {
    const row = page.locator(`tr[data-member-id="${id}"]`);
    await row.locator('[data-slot="switch"]').nth(0).click();
    await row.locator('[data-slot="switch"]').nth(1).click();
  }

  const bar = page.locator(".agent-bar");
  await expect(bar).toContainText("Spotted a pattern in Maya Chen and Jonah Park. Making a recipe…");
  await expect(bar).toContainText(
    `You did this for Maya Chen and Jonah Park. Want me to do it for ${targetCount} more?`,
  );
  expect(requests).toHaveLength(1);
  expect((requests[0] as { recorded: { member: { id: string } }[] }).recorded.map((r) => r.member.id)).toEqual([
    "maya",
    "jonah",
  ]);

  await bar.getByRole("button", { name: "Show recipe" }).click();
  await expect(page.locator(".recipe-card")).toBeVisible();
  await bar.getByRole("button", { name: `Run on ${targetCount} more` }).click();
  await expect(bar).toContainText(`Updated ${targetCount} people.`, { timeout: 15_000 });
  expect(await rowValues(page, "p688")).toMatchObject({ deployAlerts: false, weeklyDigest: true });

  // Offered once: the same change by hand on another row doesn't bring it back.
  await bar.getByRole("button", { name: "Start over" }).click();
  await scrollTableToTop(page);
  const sam = page.locator('tr[data-member-id="sam"]');
  await sam.locator('[data-slot="switch"]').nth(0).click();
  await sam.locator('[data-slot="switch"]').nth(1).click();
  await page.waitForTimeout(2500);
  await expect(bar).toContainText("Change one row once");
  expect(requests).toHaveLength(1);
});

test("the ghost cursor visits each control before its change, then hides", async ({ page }) => {
  await recordMayaAndMakeRecipe(page);
  const cursor = page.locator(".ghost-cursor");
  await expect(cursor).toHaveCSS("opacity", "0");
  const targetCount = runTargetCount(seattleRecipe, "maya");
  await page
    .locator(".agent-bar")
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

  await expect(page.locator(".agent-bar")).toContainText(`Updated ${targetCount} people.`, { timeout: 15_000 });
  await expect(cursor).not.toHaveAttribute("data-visible", { timeout: 3000 });
});

test("with reduced motion the cursor jumps and the run still finishes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordMayaAndMakeRecipe(page);
  const targetCount = runTargetCount(seattleRecipe, "maya");
  await page
    .locator(".agent-bar")
    .getByRole("button", { name: `Run on ${targetCount} more` })
    .click();
  await expect(page.locator(".agent-bar")).toContainText(`Updated ${targetCount} people.`, { timeout: 15_000 });
  expect(await page.locator(".ghost-cursor").evaluate((cursor) => cursor.getAnimations().length)).toBe(0);
});
