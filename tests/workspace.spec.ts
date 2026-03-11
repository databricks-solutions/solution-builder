import { test, expect, type Page } from "@playwright/test";

// Helper: navigate to workspace with a topic
async function goToWorkspace(page: Page, topic: string) {
  await page.goto(`/workspace?topic=${encodeURIComponent(topic)}`);
}

// Helper: wait for streaming to finish by checking the input placeholder changes
async function waitForGenerationComplete(page: Page, timeoutMs = 90_000) {
  await page.waitForFunction(
    () => {
      const input = document.querySelector(
        "input[placeholder]",
      ) as HTMLInputElement;
      if (!input) return false;
      return !input.placeholder.includes("Waiting for generation");
    },
    { timeout: timeoutMs, polling: 1000 },
  );
  await page.waitForTimeout(1000);
}

test.describe("Home Page", () => {
  test("loads and shows the landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Demo Skill Builder");
    await expect(
      page.locator('input[placeholder*="Describe a use-case"]'),
    ).toBeVisible();
  });

  test("shows industry catalog with use-case cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Browse by industry")).toBeVisible();
    await expect(page.getByText("Financial Services")).toBeVisible();
    await expect(page.getByText("Healthcare & Life Sciences")).toBeVisible();
    await expect(page.getByText("Manufacturing")).toBeVisible();
    await expect(page.getByText("Retail & CPG")).toBeVisible();
  });

  test("shows research agent callout", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Know your customer?")).toBeVisible();
  });

  test("can filter use-cases", async ({ page }) => {
    await page.goto("/");
    const filterInput = page.locator('input[placeholder*="Filter use-cases"]');
    await expect(filterInput).toBeVisible();
    await filterInput.fill("fraud");
    // Financial Services and its fraud use-case should remain visible
    await expect(page.getByText("Financial Services")).toBeVisible();
    await expect(
      page.getByText("Real-time fraud detection for credit card transactions"),
    ).toBeVisible();
    // Manufacturing should be hidden (no fraud use-cases)
    await expect(page.getByText("Manufacturing")).not.toBeVisible();
  });

  test("navigates to workspace on form submit", async ({ page }) => {
    await page.goto("/");
    const input = page.locator('input[placeholder*="Describe a use-case"]');
    await input.fill("supply chain optimization for retail");
    await page.locator('button:has-text("Build Skill")').click();
    await expect(page).toHaveURL(/\/workspace\?topic=/);
  });

  test("navigates to workspace on use-case click", async ({ page }) => {
    await page.goto("/");
    await page
      .getByText("Predictive maintenance for industrial equipment")
      .click();
    await expect(page).toHaveURL(/\/workspace\?topic=/);
  });
});

test.describe("Phase 1: Proposal Stage", () => {
  test("generates a proposal from topic", async ({ page }) => {
    await goToWorkspace(page, "predictive maintenance for wind turbines");

    await expect(page.locator("text=Generating a demo proposal")).toBeVisible({
      timeout: 5000,
    });

    await waitForGenerationComplete(page);

    await expect(page.locator("text=Proposal").first()).toBeVisible();

    const previewContent = page
      .locator("[data-radix-scroll-area-viewport]")
      .first();
    await expect(previewContent).not.toBeEmpty();

    await expect(
      page.locator('button:has-text("Approve & Build")'),
    ).toBeVisible();

    await expect(page.locator("text=Your proposal is ready")).toBeVisible({
      timeout: 5000,
    });

    await expect(
      page.locator('button:has-text("Proposal")').first(),
    ).toBeVisible();
    await expect(
      page.locator('button:has-text("Architecture")'),
    ).toBeVisible();
    await expect(page.locator('button:has-text("Raw")')).toBeVisible();
  });

  test("can switch between proposal tabs", async ({ page }) => {
    await goToWorkspace(page, "fraud detection in banking");
    await waitForGenerationComplete(page);

    await page.locator('button:has-text("Architecture")').click();
    await page.waitForTimeout(300);

    await page.locator('button:has-text("Raw")').click();
    await page.waitForTimeout(300);

    await page.locator('button:has-text("Proposal")').first().click();
    await page.waitForTimeout(300);
  });

  test("can refine a proposal via chat", async ({ page }) => {
    await goToWorkspace(page, "patient readmission risk scoring");
    await waitForGenerationComplete(page);

    const chatInput = page.locator(
      'input[placeholder*="Refine the proposal"]',
    );
    await expect(chatInput).toBeVisible();
    await chatInput.fill(
      "Make the company persona a Fortune 500 hospital network",
    );
    await chatInput.press("Enter");

    await expect(
      page.locator("text=Fortune 500 hospital network"),
    ).toBeVisible();

    await waitForGenerationComplete(page);

    await expect(page.locator("text=updated the proposal")).toBeVisible({
      timeout: 5000,
    });
  });

  test("copy button is disabled during generation", async ({ page }) => {
    await goToWorkspace(page, "supply chain demand forecasting");

    // During generation, copy should be disabled
    const copyButton = page.locator('button:has-text("Copy")');
    await expect(copyButton).toBeDisabled({ timeout: 3000 });

    await waitForGenerationComplete(page);

    // After generation, copy should be enabled
    await expect(copyButton).toBeEnabled();
  });
});

test.describe("Phase 2: Approve & Buildout", () => {
  test("approve triggers multi-file buildout", async ({ page }) => {
    await goToWorkspace(page, "real-time fraud detection for fintech");
    await waitForGenerationComplete(page);

    const approveBtn = page.locator('button:has-text("Approve & Build")');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    await expect(page.locator("text=Proposal approved")).toBeVisible({
      timeout: 5000,
    });

    await expect(page.locator("text=Building").first()).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.locator("text=Generating SKILL.md").first(),
    ).toBeVisible({ timeout: 30000 });

    await waitForGenerationComplete(page, 120_000);

    await expect(page.locator("text=Package").first()).toBeVisible({
      timeout: 5000,
    });

    for (const filename of [
      "SKILL.md",
      "storyline.md",
      "data-schema.md",
      "project-structure.md",
    ]) {
      await expect(
        page.locator(`button:has-text("${filename}")`),
      ).toBeVisible();
    }

    await expect(page.locator("text=demo package is ready")).toBeVisible({
      timeout: 5000,
    });
  });

  test("can switch between package file tabs", async ({ page }) => {
    await goToWorkspace(page, "IoT sensor monitoring for manufacturing");
    await waitForGenerationComplete(page);

    await page.locator('button:has-text("Approve & Build")').click();
    await waitForGenerationComplete(page, 120_000);

    for (const filename of [
      "storyline.md",
      "data-schema.md",
      "project-structure.md",
      "SKILL.md",
    ]) {
      await page.locator(`button:has-text("${filename}")`).click();
      await page.waitForTimeout(300);

      const previewContent = page
        .locator("[data-radix-scroll-area-viewport]")
        .first();
      await expect(previewContent).not.toBeEmpty();
    }
  });

  test("can refine individual package files", async ({ page }) => {
    await goToWorkspace(page, "customer churn prediction for telecom");
    await waitForGenerationComplete(page);

    await page.locator('button:has-text("Approve & Build")').click();
    await waitForGenerationComplete(page, 120_000);

    await page.locator('button:has-text("storyline.md")').click();
    await page.waitForTimeout(300);

    const chatInput = page.locator(
      'input[placeholder*="Refine storyline.md"]',
    );
    await expect(chatInput).toBeVisible();
    await chatInput.fill(
      "Add more detail about competitive pressure from Snowflake",
    );
    await chatInput.press("Enter");

    await waitForGenerationComplete(page);

    await expect(page.locator("text=updated")).toBeVisible({ timeout: 5000 });
  });

  test("can download package as ZIP", async ({ page }) => {
    await goToWorkspace(page, "energy grid optimization");
    await waitForGenerationComplete(page);

    await page.locator('button:has-text("Approve & Build")').click();
    await waitForGenerationComplete(page, 120_000);

    const zipBtn = page.locator('button:has-text("ZIP")');
    await expect(zipBtn).toBeVisible();
    await expect(zipBtn).toBeEnabled();
  });
});

test.describe("API Endpoints", () => {
  test("GET /api/generations returns valid JSON", async ({ request }) => {
    const resp = await request.get("/api/generations");
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test("POST /api/workspace/propose streams SSE", async ({ request }) => {
    const resp = await request.post("/api/workspace/propose", {
      data: { topic: "predictive analytics for retail" },
    });
    expect(resp.status()).toBe(200);
    const contentType = resp.headers()["content-type"];
    expect(contentType).toContain("text/event-stream");
  });

  test("POST /api/workspace/propose returns proposal events", async ({
    request,
  }) => {
    const resp = await request.post("/api/workspace/propose", {
      data: { topic: "smart agriculture monitoring" },
    });
    const text = await resp.text();
    expect(text).toContain("data:");
    expect(text).toMatch(/"type"\s*:\s*"proposal"/);
    expect(text).toMatch(/"type"\s*:\s*"complete"/);
  });
});
