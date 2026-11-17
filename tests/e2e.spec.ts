import { expect, test, type Page } from "@playwright/test";
import type { AgentComponent } from "@ui-sdk/react/agent";
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

type DebugWindow = { agent: { snapshot: () => AgentComponent[] }; memberIdOfRef: (ref: string) => string | undefined };

/**
 * Function to read one member's row from a fresh snapshot.
 * @param page The page.
 * @param memberId The row's `data-member-id`.
 * @returns Field label to value (`checked` for switches).
 */
async function rowValues(page: Page, memberId: string): Promise<Record<string, unknown>> {
  return page.evaluate((id) => {
    const { agent, memberIdOfRef } = window as unknown as DebugWindow;
    const rowComponents = agent.snapshot().filter((component) => memberIdOfRef(component.ref) === id);
    return Object.fromEntries(
      rowComponents.map((component) => [
        component.label!,
        component.component === "switch" ? component.checked : component.value,
      ]),
    );
  }, memberId);
}

/**
 * Function to read every row but one from a fresh snapshot.
 * @param page The page.
 * @param exceptMemberId The row to leave out.
 * @returns Ref, value and checked per component, in snapshot order.
 */
async function valuesExcept(page: Page, exceptMemberId: string): Promise<unknown[]> {
  return page.evaluate((exceptId) => {
    const { agent, memberIdOfRef } = window as unknown as DebugWindow;
    return agent
      .snapshot()
      .filter((component) => memberIdOfRef(component.ref) !== exceptId)
      .map((component) => [component.ref, component.value, component.checked]);
  }, exceptMemberId);
}

/**
 * Function to record Maya's three changes and make the fixed recipe, leaving the card showing.
 * @param page The page.
 */
async function recordMayaAndMakeRecipe(page: Page) {
  await page.route("/api/recipe", (route) => route.fulfill({ json: { recipe, model: "fixed" } }));
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

test("running a recipe gives every Design row the recipe's values", async ({ page }) => {
  await recordMayaAndMakeRecipe(page);
  const bar = page.locator(".agent-bar");
  await bar.getByRole("button", { name: "Run on 4 more" }).click();
  await expect(bar).toContainText("Updated 4 people.", { timeout: 15_000 });

  for (const id of ["maya", "jonah", "priya", "tomas", "ines"]) {
    expect(await rowValues(page, id), id).toMatchObject({
      Role: "editor",
      "Deploy alerts": false,
      "Weekly digest": true,
    });
  }
  expect(await rowValues(page, "sam"), "sam").toMatchObject({
    Role: "admin",
    "Deploy alerts": true,
    "Weekly digest": false,
  });
});

test("an open recipe previews every row it would change, and closing it puts them back", async ({ page }) => {
  await page.goto("/");
  const before = await valuesExcept(page, "maya");
  await recordMayaAndMakeRecipe(page);
  const previewed = page.locator("tr[data-preview]");
  const jonah = page.locator('tr[data-member-id="jonah"]');

  await expect(previewed).toHaveCount(4);
  await expect(jonah.locator(".preview-was")).toHaveText(["Viewer", "on", "off"]);
  await expect
    .poll(() => rowValues(page, "jonah"))
    .toMatchObject({ Role: "editor", "Deploy alerts": false, "Weekly digest": true });
  // Staged rows still count as targets.
  await expect(page.getByRole("button", { name: "Run on 4 more" })).toBeVisible();

  // Narrowing the recipe narrows the preview: Priya is the only Design lead.
  const valueInput = page.locator(".recipe-card .clause input");
  await page.locator(".recipe-card .clause select").first().selectOption("title");
  await valueInput.fill("Design lead");
  await valueInput.blur();
  await expect(previewed).toHaveCount(1);
  await expect(page.locator('tr[data-member-id="priya"]')).toHaveAttribute("data-preview");

  await page.locator(".agent-bar").getByRole("button", { name: "Start over" }).click();
  await expect(previewed).toHaveCount(0);
  await expect.poll(() => valuesExcept(page, "maya")).toEqual(before);
});

test("removing one change from a toast reverts only that field, and undoing the run restores the rest", async ({
  page,
}) => {
  await recordMayaAndMakeRecipe(page);
  const valuesBefore = await valuesExcept(page, "maya");
  await page.locator(".agent-bar").getByRole("button", { name: "Run on 4 more" }).click();
  await expect(page.locator(".toast")).toHaveCount(4, { timeout: 15_000 });

  const jonahToast = page.locator(".toast", { hasText: "Jonah Park" });
  await expect(jonahToast).toContainText("Jonah Park: 3 changes");
  await page.locator(".toast-stack").hover();
  const alertsLine = jonahToast.locator(".toast-change", { hasText: "Deploy alerts" });
  await alertsLine.getByRole("button", { name: "Remove" }).click();
  await expect(alertsLine).toContainText("Removed");
  expect(await rowValues(page, "jonah")).toMatchObject({
    Role: "editor",
    "Deploy alerts": true,
    "Weekly digest": true,
  });

  await page.locator(".toast-stack").getByRole("button", { name: "Undo the whole run" }).click();
  await expect.poll(() => valuesExcept(page, "maya")).toEqual(valuesBefore);
  await expect(page.locator(".toast-kept")).toHaveCount(0);
});

test("Undo row keeps a change the person made after the run and says so", async ({ page }) => {
  await recordMayaAndMakeRecipe(page);
  await page.locator(".agent-bar").getByRole("button", { name: "Run on 4 more" }).click();
  await expect(page.locator(".toast")).toHaveCount(4, { timeout: 15_000 });

  await page.locator('tr[data-member-id="jonah"] [data-slot="select-trigger"]').first().click();
  await page.getByRole("option", { name: "Admin" }).click();

  const jonahToast = page.locator(".toast", { hasText: "Jonah Park" });
  await page.locator(".toast-stack").hover();
  await expect(jonahToast.locator(".toast-change", { hasText: "Role" })).toContainText("Changed since");
  await jonahToast.getByRole("button", { name: "Undo row" }).click();
  await expect(page.locator(".toast-kept")).toHaveText("Kept Role for Jonah Park: you changed it after the agent.");
  await expect
    .poll(() => rowValues(page, "jonah"))
    .toMatchObject({ Role: "admin", "Deploy alerts": true, "Weekly digest": false });
});

test("changing two rows the same way by hand offers a ready recipe for the rest", async ({ page }) => {
  const nudgeRecipe: Recipe = { ...recipe, steps: recipe.steps.filter((step) => step.field !== "role") };
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
  await expect(bar).toContainText("You did this for Maya Chen and Jonah Park. Want me to do it for 3 more?");
  expect(requests).toHaveLength(1);
  expect((requests[0] as { recorded: { member: { id: string } }[] }).recorded.map((r) => r.member.id)).toEqual([
    "maya",
    "jonah",
  ]);

  await bar.getByRole("button", { name: "Show recipe" }).click();
  await expect(page.locator(".recipe-card")).toBeVisible();
  await expect(page.locator("tr[data-preview]")).toHaveCount(3);
  await bar.getByRole("button", { name: "Run on 3 more" }).click();
  await expect(bar).toContainText("Updated 3 people.", { timeout: 15_000 });
  expect(await rowValues(page, "priya")).toMatchObject({ "Deploy alerts": false, "Weekly digest": true });

  // Offered once: the same change by hand on another row doesn't bring it back.
  await bar.getByRole("button", { name: "Start over" }).click();
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
  await page.locator(".agent-bar").getByRole("button", { name: "Run on 4 more" }).click();

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

  await expect(page.locator(".agent-bar")).toContainText("Updated 4 people.", { timeout: 15_000 });
  await expect(cursor).not.toHaveAttribute("data-visible", { timeout: 3000 });
});

test("with reduced motion the cursor jumps and the run still finishes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordMayaAndMakeRecipe(page);
  await page.locator(".agent-bar").getByRole("button", { name: "Run on 4 more" }).click();
  await expect(page.locator(".agent-bar")).toContainText("Updated 4 people.", { timeout: 15_000 });
  expect(await page.locator(".ghost-cursor").evaluate((cursor) => cursor.getAnimations().length)).toBe(0);
});
