import { once } from "node:events";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test as base, expect } from "@playwright/test";

const directory = process.env.SAM_EXAMPLE_DIRECTORY;
if (!directory) throw new Error("Run browser tests through npm run test:browser");
const { createDemoServer } = await import(pathToFileURL(join(directory, "server.mjs")).href);
const test = base.extend({
  demo: async ({ page }, use) => {
    const server = createDemoServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(url);
      await expect(page.locator("#rows tr")).toHaveCount(25);
      await use(url);
      expect(errors).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  },
});

const row = (page, name = "000001") =>
  page.getByRole("checkbox", { name: `Select Invoice ${name}`, exact: true });
const pageCheckbox = (page) =>
  page.getByRole("checkbox", { name: "Select eligible rows on this page" });

function gate() {
  let release;
  const promise = new Promise((done) => {
    release = done;
  });
  return { promise, release };
}

test("keeps row selection across pages and shows a mixed page checkbox", async ({ page, demo }) => {
  expect(demo).toMatch(/^http:\/\/127\.0\.0\.1:/);
  await row(page).check();
  await expect(page.locator("#selection-summary")).toHaveText("1 selected.");
  await expect(pageCheckbox(page)).toHaveJSProperty("indeterminate", true);
  await expect(row(page, "000011")).toBeDisabled();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator("#page-summary")).toContainText("Page 2 ");
  await expect(pageCheckbox(page)).not.toBeChecked();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(row(page)).toBeChecked();
  await pageCheckbox(page).check();
  await expect(pageCheckbox(page)).toHaveJSProperty("indeterminate", false);
  await expect(pageCheckbox(page)).toBeChecked();
  await pageCheckbox(page).uncheck();
  await expect(page.locator("#selection-summary")).toHaveText("Nothing selected.");
});

test("keeps keyboard focus when a checkbox updates the table", async ({ page, demo }) => {
  expect(demo).toBeTruthy();
  await row(page).focus();
  await row(page).press("Space");
  await expect(row(page)).toBeChecked();
  await expect(row(page)).toBeFocused();
  await row(page).press("Space");
  await expect(row(page)).not.toBeChecked();
  await expect(row(page)).toBeFocused();
  await pageCheckbox(page).focus();
  await pageCheckbox(page).press("Space");
  await expect(pageCheckbox(page)).toBeChecked();
  await expect(pageCheckbox(page)).toBeFocused();
});

test("sends a compact all-matching request and executes its exclusions", async ({ page, demo }) => {
  await page.getByRole("button", { name: "Select all matching" }).click();
  await expect(row(page)).toBeChecked();
  await row(page).uncheck();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(pageCheckbox(page)).toBeChecked();
  const request = page.waitForRequest(
    (value) => value.url() === `${demo}/api/tenants/north/invoices/mark-reviewed/preview`,
  );
  await page.getByRole("button", { name: "Preview selection" }).click();
  const body = (await request).postDataJSON();
  expect(body).toMatchObject({ protocolVersion: 1, mode: "allMatching", excludedIds: ["row-1"] });
  expect(Object.keys(body).sort()).toEqual([
    "excludedIds",
    "mode",
    "protocolVersion",
    "scopeToken",
  ]);
  expect(JSON.stringify(body).length).toBeLessThan(250);
  await expect(page.locator("#action-result")).toContainText("eligible invoices at preview time");
  const applied = page.waitForResponse((value) => value.url().endsWith("/mark-reviewed/apply"));
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  const result = await (await applied).json();
  expect(result.count).toBeGreaterThan(30_000);
  await expect(page.locator("#selection-summary")).toHaveText("Nothing selected.");
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(row(page)).toBeEnabled();
  await expect(row(page, "000003")).toBeDisabled();
});

test("ignores a delayed B response after returning from filter A to B to A", async ({
  page,
  demo,
}) => {
  const delayed = gate();
  await row(page).check();
  await page.route("**/api/tenants/north/invoices?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("status") === "paid") await delayed.promise;
    await route.continue();
  });
  const requested = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("status") === "paid",
  );
  await page.getByLabel("Status filter").selectOption("paid");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await requested;
  await page.getByLabel("Status filter").selectOption("all");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(row(page)).toBeVisible();
  await expect(row(page)).not.toBeChecked();
  const lateResponse = page.waitForResponse(
    (response) =>
      response.url().startsWith(demo) &&
      new URL(response.url()).searchParams.get("status") === "paid",
  );
  delayed.release();
  await lateResponse;
  await expect(row(page)).toBeVisible();
  await expect(page.locator("#selection-summary")).toHaveText("Nothing selected.");
});

test("clearing while a token is requested never resurrects selection", async ({ page, demo }) => {
  const delayed = gate();
  await page.route("**/mark-reviewed/scope", async (route) => {
    await delayed.promise;
    await route.continue();
  });
  const requested = page.waitForRequest((request) => request.url().endsWith("/scope"));
  await page.getByRole("button", { name: "Select all matching" }).click();
  await requested;
  await page.getByRole("button", { name: "Clear selection" }).click();
  const response = page.waitForResponse(
    (value) => value.url() === `${demo}/api/tenants/north/invoices/mark-reviewed/scope`,
  );
  delayed.release();
  await response;
  await expect(page.locator("#selection-summary")).toHaveText("Nothing selected.");
  await expect(row(page)).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Preview selection" })).toBeDisabled();
});

test("rejects an expired scope and lets the user select again", async ({ page, demo }) => {
  expect(demo).toBeTruthy();
  await page.getByRole("button", { name: "Select all matching" }).click();
  await expect(row(page)).toBeChecked();
  await page.getByText("Request and server checks", { exact: true }).click();
  await page.getByRole("button", { name: "Expire scope tokens" }).click();
  await expect(page.locator("#action-result")).toContainText("Scope tokens expired");
  await page.getByRole("button", { name: "Preview selection" }).click();
  await expect(page.locator("#action-result")).toContainText("server rejected");
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByRole("button", { name: "Select all matching" }).click();
  await page.getByRole("button", { name: "Preview selection" }).click();
  await expect(page.locator("#action-result")).toContainText("eligible invoices at preview time");
});

test("rechecks permission when a previously selected row is submitted", async ({ page, demo }) => {
  expect(demo).toBeTruthy();
  await row(page).check();
  await page.getByText("Request and server checks", { exact: true }).click();
  await page.getByRole("button", { name: "Revoke permission" }).click();
  await expect(page.locator("#action-result")).toContainText("Permission revoked");
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(page.locator("#action-result")).toContainText("server rejected");
});

test("freezes edits while a bulk action is in progress", async ({ page, demo }) => {
  const delayed = gate();
  await row(page).check();
  await page.route("**/mark-reviewed/apply", async (route) => {
    await delayed.promise;
    await route.continue();
  });
  const requested = page.waitForRequest(
    (request) => request.url() === `${demo}/api/tenants/north/invoices/mark-reviewed/apply`,
  );
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await requested;
  await expect(row(page, "000003")).toBeDisabled();
  await expect(pageCheckbox(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Clear selection" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Select all matching" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Apply filter" })).toBeDisabled();
  delayed.release();
  await expect(page.locator("#action-result")).toHaveText("1 invoice marked reviewed.");
  await expect(page.locator("#selection-summary")).toHaveText("Nothing selected.");
  await expect(row(page, "000003")).toBeEnabled();
});

test("handles an empty filter without enabling bulk actions", async ({ page, demo }) => {
  expect(demo).toBeTruthy();
  await page.getByLabel("Search invoices").fill("does-not-exist");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page.locator("#rows tr")).toHaveCount(0);
  await expect(pageCheckbox(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Select all matching" })).toBeDisabled();
  await expect(page.locator("#page-summary")).toContainText("0 matching rows");
});

test("explains endpoint limits and offers a way back to a valid selection", async ({
  page,
  demo,
}) => {
  expect(demo).toBeTruthy();
  for (let index = 0; index < 5; index += 1) {
    await pageCheckbox(page).check();
    if (index < 4) {
      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page.locator("#page-summary")).toContainText(`Page ${index + 2} `);
    }
  }
  await expect(page.locator("#selection-limit")).toContainText("allows 100 selected IDs");
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
  await page.getByRole("button", { name: "Select all matching" }).click();
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeEnabled();
  await expect(page.locator("#selection-limit")).toBeHidden();
  for (let index = 0; index < 5; index += 1) {
    await pageCheckbox(page).uncheck();
    if (index < 4) {
      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page.locator("#page-summary")).toContainText(`Page ${index + 6} `);
    }
  }
  await expect(page.locator("#selection-limit")).toContainText("allows 100 exclusions");
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.locator("#selection-limit")).toBeHidden();
  await expect(page.locator("#selection-summary")).toHaveText("Nothing selected.");
});

test("keeps controls readable at a narrow viewport", async ({ page, demo }, testInfo) => {
  expect(demo).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Apply filter" })).toBeVisible();
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("table.png"), fullPage: true });
});
