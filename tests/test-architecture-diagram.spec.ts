import { test, expect } from "@playwright/test";

test("Architecture diagram renders correctly in Beauty Retail Returns Investigation project", async ({
  page,
}) => {
  // Navigate to home page
  await page.goto("/", { waitUntil: "networkidle" });

  // Wait for projects to load
  await page.waitForSelector("text=Beauty Retail Returns Investigation", {
    timeout: 10000,
  });

  // Click on the Beauty Retail Returns Investigation project
  const projectLink = page.locator(
    'text=Beauty Retail Returns Investigation'
  ).first();
  await projectLink.click();

  // Wait for project page to load - look for file viewer or architecture diagram
  await page.waitForSelector('[data-testid="file-viewer"], .react-flow__viewport, svg', {
    timeout: 10000,
  });

  // Wait a bit for diagram to render
  await page.waitForTimeout(1500);

  // Check if Architecture tab exists and click it if visible
  const architectureTab = page.locator('button, [role="tab"]').filter({
    hasText: /Architecture/i,
  });

  if (await architectureTab.isVisible()) {
    await architectureTab.click();
    await page.waitForTimeout(1000);
  }

  // Take screenshot of the diagram
  await page.screenshot({
    path: "test-results/architecture-diagram.png",
    fullPage: true,
  });

  // Verify ReactFlow diagram is rendered
  const reactFlowViewport = page.locator(".react-flow__viewport");
  await expect(reactFlowViewport).toBeVisible();

  // Check for nodes (look for SVG g elements that represent nodes)
  const nodeElements = page.locator(".react-flow__node, [data-id]");
  const nodeCount = await nodeElements.count();
  console.log(`Found ${nodeCount} node elements`);
  expect(nodeCount).toBeGreaterThan(0);

  // Check for edges
  const edgeElements = page.locator(".react-flow__edge");
  const edgeCount = await edgeElements.count();
  console.log(`Found ${edgeCount} edge elements`);
  // Should have roughly 15 edges as per the schema
  expect(edgeCount).toBeGreaterThan(10);

  // Check console for errors
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });

  // Wait a bit to catch any async errors
  await page.waitForTimeout(500);

  if (errors.length > 0) {
    console.log("Console errors detected:");
    errors.forEach((err) => console.log(`  - ${err}`));
  }

  expect(errors).toHaveLength(0);

  // Verify diagram elements with specific content
  // Check for key nodes like "Bronze Layer", "Silver Layer", "Gold Layer"
  // Use more specific selectors to avoid picking up text from other places
  const bronzeNode = page.locator('.react-flow__node').filter({
    hasText: 'Bronze Layer',
  });
  await expect(bronzeNode).toBeVisible();

  const silverNode = page.locator('.react-flow__node').filter({
    hasText: 'Silver Layer',
  });
  await expect(silverNode).toBeVisible();

  const goldNode = page.locator('.react-flow__node').filter({
    hasText: 'Gold Layer',
  });
  await expect(goldNode).toBeVisible();

  // Verify the diagram has proper ReactFlow styling
  const styledNodes = page.locator(".react-flow__node");
  const styledNodeCount = await styledNodes.count();
  console.log(`Found ${styledNodeCount} styled node elements with proper ReactFlow classes`);
  expect(styledNodeCount).toBeGreaterThan(10);

  // Take a final screenshot to verify complete diagram
  await page.screenshot({
    path: "test-results/architecture-diagram-final.png",
    fullPage: true,
  });

  console.log("Architecture diagram test completed successfully!");
});
