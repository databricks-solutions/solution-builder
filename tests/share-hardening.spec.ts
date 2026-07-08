/**
 * E2E for hardened direct project sharing (roles + accept/decline + clone).
 *
 * Runs against the DEV stack (vite :5175 → backend :8010), NOT the prod :9000
 * build wired into playwright.config.ts, because that build predates this
 * feature. Two users are simulated with per-context `X-Forwarded-Email` headers
 * (the backend trusts that header whenever present — see core/_headers.py).
 *
 * Prereqs: `./scripts/dev.sh`-style dev servers running, i.e.
 *   VITE_BACKEND_URL=http://127.0.0.1:8010 vite --port 5175   (UI)
 *   uvicorn ... --port 8010                                   (API)
 */
import { test, expect, request, type APIRequestContext } from "@playwright/test";

const UI = "http://localhost:5175";
const API = "http://127.0.0.1:8010";
const OWNER = "cal.reynolds@databricks.com";
const VIEWER = `pw.viewer.${Date.now()}@databricks.com`;

async function ownerApi(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: API,
    extraHTTPHeaders: { "X-Forwarded-Email": OWNER },
  });
}

test("viewer: invitation → accept → read-only → clone", async ({ browser }) => {
  const owner = await ownerApi();

  // --- Setup: pick an owner-owned project and share it as a pending viewer ---
  const projects = await (await owner.get("/api/projects")).json();
  const target = projects.find((p: any) => p.owner_email === OWNER);
  expect(target, "need at least one project owned by the owner").toBeTruthy();

  const shareResp = await owner.post(
    `/api/projects/${target.id}/share`,
    { data: { email: VIEWER, role: "viewer", message: "please review" } }
  );
  expect(shareResp.ok()).toBeTruthy();
  const share = await shareResp.json();
  expect(share.role).toBe("viewer");
  expect(share.status).toBe("pending");

  // --- Viewer drives the UI ---
  const ctx = await browser.newContext({
    baseURL: UI,
    extraHTTPHeaders: { "X-Forwarded-Email": VIEWER },
  });
  // Suppress the first-run onboarding guide that otherwise covers the page for
  // brand-new users (see components/guide/guide-modal.tsx STORAGE_KEY).
  await ctx.addInitScript(() => {
    window.localStorage.setItem("guide-seen-v2", "true");
  });
  const page = await ctx.newPage();

  try {
    // 1. Invitation shows up and can be accepted.
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Invitations" })).toBeVisible();
    const invite = page
      .locator("div")
      .filter({ hasText: target.name })
      .filter({ has: page.getByRole("button", { name: "Accept" }) })
      .first();
    await invite.getByRole("button", { name: "Accept" }).click();

    // 2. After accepting it appears under "Shared with Me" as View only.
    await expect(
      page.getByRole("heading", { name: "Shared with Me" })
    ).toBeVisible();
    const tile = page.getByRole("button").filter({ hasText: target.name }).first();
    await expect(tile).toBeVisible();
    await expect(tile.getByText("View only")).toBeVisible();

    // 3. Opening it shows the read-only banner + composer CTA (no editing).
    await tile.click();
    await page.waitForURL(/\/project\//);
    await expect(page.getByText(/Read-only/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Make (a copy|my own copy to edit)/i }).first()
    ).toBeVisible();

    // 4. Cloning navigates to a fresh project the viewer owns (banner gone).
    const beforeUrl = page.url();
    await page
      .getByRole("button", { name: /Make (a copy|my own copy to edit)/i })
      .first()
      .click();
    await page.waitForURL((u) => /\/project\//.test(u.href) && u.href !== beforeUrl, {
      timeout: 30_000,
    });
    await expect(page.getByText(/Read-only/i)).toHaveCount(0);

    // The clone is owned by the viewer and editable — the composer is back.
    const cloneId = page.url().split("/project/")[1]?.split(/[/?]/)[0];
    expect(cloneId).toBeTruthy();
    const cloneMeta = await (
      await ctx.request.get(`${API}/api/projects/${cloneId}`, {
        headers: { "X-Forwarded-Email": VIEWER },
      })
    ).json();
    expect(cloneMeta.user_email).toBe(VIEWER);
    expect(cloneMeta.my_role).toBe("owner");

    // --- Cleanup ---
    await ctx.request.delete(`${API}/api/projects/${cloneId}`, {
      headers: { "X-Forwarded-Email": VIEWER },
    });
  } finally {
    await owner.delete(`/api/projects/${target.id}/share/${share.id}`);
    await ctx.close();
    await owner.dispose();
  }
});

test("owner: Share button in the workspace header shares a project", async ({
  browser,
}) => {
  const owner = await ownerApi();
  const projects = await (await owner.get("/api/projects")).json();
  const target = projects.find((p: any) => p.owner_email === OWNER);
  const guest = `pw.guest.${Date.now()}@databricks.com`;

  const ctx = await browser.newContext({
    baseURL: UI,
    extraHTTPHeaders: { "X-Forwarded-Email": OWNER },
  });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("guide-seen-v2", "true");
  });
  const page = await ctx.newPage();

  try {
    await page.goto(`/project/${target.id}`);

    // The header exposes a visible Share button (not a hover-only tile icon).
    // exact:true so it doesn't also match "Share as template" in the stepper.
    const shareBtn = page.getByRole("button", { name: "Share", exact: true });
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();

    // Dialog opens; fill it in, choose Editor, share.
    await expect(page.getByRole("heading", { name: "Share Project" })).toBeVisible();
    await page.getByPlaceholder("colleague@databricks.com").fill(guest);
    await page.getByRole("button", { name: /Editor/ }).click();
    await page.getByRole("button", { name: "Share", exact: true }).last().click();

    // The invitee shows up in the "Shared with" list.
    await expect(page.getByText(guest)).toBeVisible();
    await expect(page.getByText("Invitation pending")).toBeVisible();
  } finally {
    // Cleanup any share we created for the guest.
    const shares = await (
      await owner.get(`/api/projects/${target.id}/shares`)
    ).json();
    const mine = shares.find((s: any) => s.shared_with_email === guest);
    if (mine)
      await owner.delete(`/api/projects/${target.id}/share/${mine.id}`);
    await ctx.close();
    await owner.dispose();
  }
});

test("viewer write is blocked at the API (defense in depth)", async ({}) => {
  const owner = await ownerApi();
  const viewer = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { "X-Forwarded-Email": VIEWER + ".ro" },
  });
  const projects = await (await owner.get("/api/projects")).json();
  const target = projects.find((p: any) => p.owner_email === OWNER);

  const share = await (
    await owner.post(`/api/projects/${target.id}/share`, {
      data: { email: VIEWER + ".ro", role: "viewer" },
    })
  ).json();
  await viewer.post(`/api/projects/${target.id}/share/respond`, {
    data: { accept: true },
  });

  try {
    // Read OK, write 403, delete 403.
    expect((await viewer.get(`/api/projects/${target.id}`)).status()).toBe(200);
    expect(
      (
        await viewer.patch(`/api/projects/${target.id}`, {
          data: { description: "nope" },
        })
      ).status()
    ).toBe(403);
    expect((await viewer.delete(`/api/projects/${target.id}`)).status()).toBe(403);
  } finally {
    await owner.delete(`/api/projects/${target.id}/share/${share.id}`);
    await viewer.dispose();
    await owner.dispose();
  }
});
