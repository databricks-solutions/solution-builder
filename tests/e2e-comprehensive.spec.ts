/**
 * Comprehensive end-to-end tests.
 * Run: npx playwright test tests/e2e-comprehensive.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as path from "path";

const OUTPUT_DIR = path.join(process.cwd(), "screenshot-eval");
const BASE_URL = "http://localhost:9000";

test.describe("E2E Comprehensive", () => {
  const allConsoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        allConsoleErrors.push(`[${page.url()}] ${msg.text()}`);
      }
    });
  });

  test("Test 1: Landing page", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-01-landing.png"),
      fullPage: true,
    });

    // Verify industry catalog (8 categories)
    const industries = [
      "Financial Services",
      "Healthcare & Life Sciences",
      "Manufacturing",
      "Retail & CPG",
      "Energy & Utilities",
      "Telecom",
      "Media & Entertainment",
      "Public Sector",
    ];
    for (const name of industries) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }

    // Verify NO /new link exists
    const newLinks = page.locator('a[href="/new"]');
    await expect(newLinks).toHaveCount(0);

    // Verify "Tailoring for a specific customer?" callout
    await expect(page.getByText("Tailoring for a specific customer?")).toBeVisible();
  });

  test("Test 2: Generations list and detail", async ({ page }) => {
    await page.goto(`${BASE_URL}/generations`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-02-list.png"),
      fullPage: true,
    });

    // Verify list with stage badges
    await expect(page.getByText("Past Generations")).toBeVisible();
    const hasStageBadge =
      (await page.getByText("Proposal").count()) > 0 ||
      (await page.getByText("Approved").count()) > 0 ||
      (await page.getByText("Package").count()) > 0;
    expect(hasStageBadge).toBeTruthy();

    // Click first generation card
    const firstCard = page.locator('a[href^="/generations/"]').first();
    await firstCard.click();
    await page.waitForURL(/\/generations\/\d+/);
    await page.waitForLoadState("networkidle");

    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-02-detail.png"),
      fullPage: true,
    });

    // CRITICAL: Must show detail page, NOT list
    await expect(page.getByText("Back to Generations")).toBeVisible();

    // Verify "Open in Workspace" button
    await expect(page.getByRole("link", { name: /Open in Workspace/ })).toBeVisible();
  });

  test("Test 3: Package generation detail with visual renderers", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/generations/19`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-03-initial.png"),
      fullPage: true,
    });

    // Verify file tabs
    for (const tab of ["SKILL.md", "storyline.md", "data-schema.md", "project-structure.md"]) {
      await expect(page.getByRole("button", { name: tab })).toBeVisible();
    }

    // Click data-schema.md
    await page.getByRole("button", { name: "data-schema.md" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-03-data-schema.png"),
      fullPage: true,
    });
    const hasSchemaTable =
      (await page.getByText("Table Schemas").count()) > 0 ||
      (await page.locator('[class*="border-border"]').filter({ has: page.locator("code") }).count()) > 0;

    // Click SKILL.md
    await page.getByRole("button", { name: "SKILL.md" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-03-skill.png"),
      fullPage: true,
    });
    const hasBuildSteps =
      (await page.getByText("Build Steps").count()) > 0 ||
      (await page.locator('[class*="rounded-full"][class*="bg-primary"]').count()) > 0;

    // Click project-structure.md
    await page.getByRole("button", { name: "project-structure.md" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-03-project-structure.png"),
      fullPage: true,
    });
    const hasProjectTree =
      (await page.getByText("Project Structure").count()) > 0 ||
      (await page.locator('[class*="FolderOpen"], [class*="File"]').count()) > 0;

    // Click storyline.md
    await page.getByRole("button", { name: "storyline.md" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-03-storyline.png"),
      fullPage: true,
    });
    const hasStorylineCards =
      (await page.locator('[class*="rounded-xl"][class*="border"]').count()) > 0;
  });

  test("Test 4: Open in Workspace (resume editing)", async ({ page }) => {
    await page.goto(`${BASE_URL}/generations/19`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    // Click "Open in Workspace"
    await page.getByRole("link", { name: /Open in Workspace/ }).click();
    await page.waitForURL(/\/workspace/);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000); // Allow package to load

    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-04-workspace.png"),
      fullPage: true,
    });

    // Verify workspace loaded with package (not fresh proposal)
    const hasLoadedMessage = (await page.getByText(/Loaded package/).count()) > 0;
    const hasFileTabs =
      (await page.getByRole("button", { name: "storyline.md" }).count()) > 0 ||
      (await page.getByRole("button", { name: "SKILL.md" }).count()) > 0;

    expect(hasLoadedMessage || hasFileTabs).toBeTruthy();
  });

  test("Test 5: Fresh proposal flow from landing", async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    // Click "Patient readmission risk scoring" under Healthcare
    await page
      .getByRole("button", { name: "Patient readmission risk scoring" })
      .click();

    await page.waitForURL(/\/workspace/);
    await expect(
      page.locator('button:has-text("Approve & Build")'),
    ).toBeVisible({ timeout: 60_000 });

    await page.screenshot({
      path: path.join(OUTPUT_DIR, "e2e-05-proposal-complete.png"),
      fullPage: true,
    });
  });
});
