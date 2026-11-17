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
      rowComponents.map((component) => [component.label!, component.component === "switch" ? component.checked : component.value]),
    );
  }, memberId);
}

test("running a recipe gives every Design row the recipe's values", async ({ page }) => {
  await page.route("/api/recipe", (route) => route.fulfill({ json: { recipe, model: "fixed" } }));
  await page.goto("/");
  const bar = page.locator(".agent-bar");
  const row = (id: string) => page.locator(`tr[data-member-id="${id}"]`);

  await bar.getByRole("button", { name: "Show me" }).click();
  await row("maya").locator('[data-slot="select-trigger"]').first().click();
  await page.getByRole("option", { name: "Editor" }).click();
  await row("maya").locator('[data-slot="switch"]').nth(0).click();
  await row("maya").locator('[data-slot="switch"]').nth(1).click();
  await bar.getByRole("button", { name: "Done" }).click();
  await bar.getByRole("button", { name: "Make a recipe" }).click();
  await bar.getByRole("button", { name: "Run on 4 more" }).click();
  await expect(bar).toContainText("Updated 4 people.", { timeout: 15_000 });

  for (const id of ["maya", "jonah", "priya", "tomas", "ines"]) {
    expect(await rowValues(page, id), id).toMatchObject({ Role: "editor", "Deploy alerts": false, "Weekly digest": true });
  }
  expect(await rowValues(page, "sam"), "sam").toMatchObject({ Role: "admin", "Deploy alerts": true, "Weekly digest": false });
});
