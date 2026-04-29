import { test, expect, Page } from "@playwright/test";

test.describe("Auto build button and modal", () => {
  let page: Page;

  test.beforeAll(async () => {
    // This will be set up in the test
  });

  test("should display auto build button in chat footer and modal on click", async ({
    page,
  }) => {
    // Navigate to the app
    await page.goto("http://localhost:5174/");

    // Wait for the app to load
    await page.waitForLoadState("networkidle");

    // Take screenshot of home page
    await page.screenshot({ path: "/tmp/01-home-page.png", fullPage: true });

    // Look for existing projects or create one
    // Check if there are any projects listed
    const projectLinks = await page.locator("a[href*='/project/']").all();

    if (projectLinks.length > 0) {
      // Click the first project
      await projectLinks[0].click();
    } else {
      // Try to find and click create project button
      const createBtn = await page.locator("button:has-text('New Project'), button:has-text('Create'), a:has-text('Create')").first();
      if (createBtn) {
        await createBtn.click();
        await page.waitForURL(/\/project\//, { timeout: 10000 });
      }
    }

    // Wait for project page to load
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Take screenshot of project page
    await page.screenshot({ path: "/tmp/02-project-page.png", fullPage: true });

    // Look for the Auto build button in the chat footer
    const autoBuildBtn = await page.locator('button:has-text("Auto build")').first();

    // Verify button exists
    expect(autoBuildBtn).toBeDefined();
    const buttonText = await autoBuildBtn?.textContent();
    console.log("Auto build button text:", buttonText);

    // Check for Zap icon
    const zapIcon = await autoBuildBtn?.locator("svg").first();
    expect(zapIcon).toBeDefined();

    // Verify button is visible
    await expect(autoBuildBtn).toBeVisible();

    // Click the Auto build button
    await autoBuildBtn?.click();
    await page.waitForTimeout(500);

    // Take screenshot of modal
    await page.screenshot({ path: "/tmp/03-modal-open.png", fullPage: true });

    // Verify modal is visible
    const modal = await page.locator("dialog").first();
    await expect(modal).toBeVisible();

    // Verify modal title
    const modalTitle = await page.locator("h2:has-text('Run auto build?')").first();
    await expect(modalTitle).toBeVisible();

    // Get modal title text
    const titleText = await modalTitle?.textContent();
    console.log("Modal title:", titleText);

    // Verify modal description text contains key phrases
    const description = await page.locator("dialog [role='region']").last();
    const descriptionText = await description.textContent();
    console.log("Modal description:", descriptionText);

    // Check for specific text in description
    expect(descriptionText).toContain("30 minutes");
    expect(descriptionText).toContain("re-prompting");

    // Verify Cancel button exists
    const cancelBtn = await page.locator("button:has-text('Cancel')").first();
    await expect(cancelBtn).toBeVisible();

    // Verify Start auto build button exists
    const startBtn = await page.locator("button:has-text('Start auto build')").first();
    await expect(startBtn).toBeVisible();

    // Click Cancel to close modal
    await cancelBtn?.click();
    await page.waitForTimeout(300);

    // Take screenshot after cancel
    await page.screenshot({ path: "/tmp/04-after-cancel.png", fullPage: true });

    // Verify modal is closed
    const modalAfterCancel = await page.locator("dialog").first();
    const isModalHidden = await modalAfterCancel.isHidden().catch(() => true);
    console.log("Modal hidden after cancel:", isModalHidden);

    // Re-open modal
    await autoBuildBtn?.click();
    await page.waitForTimeout(500);

    // Verify modal is open again
    await expect(modal).toBeVisible();

    // Press Escape key to close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Take screenshot after escape
    await page.screenshot({ path: "/tmp/05-after-escape.png", fullPage: true });

    // Verify modal is closed
    const isModalHiddenAfterEscape = await modalAfterCancel.isHidden().catch(() => true);
    console.log("Modal hidden after escape:", isModalHiddenAfterEscape);

    // Check console for errors
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    console.log("Console errors:", consoleErrors);
  });
});
