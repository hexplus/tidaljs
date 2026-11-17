import { expect, test, type Page } from "@playwright/test";
import { setCode } from "./helpers.ts";

const editor = (page: Page) => page.locator("#codeEditor");

async function saveSketch(page: Page, title: string, code: string) {
  await setCode(page, code);
  await page.click("#tabLibrary");
  await page.fill("#sketchTitle", title);
  await page.locator(".library-save").getByRole("button", { name: /^Save/ }).click();
  await expect(page.locator(".library-save").getByRole("button", { name: "Saved" })).toBeVisible();
}

test("unsaved code, title and tempo are protected; cancelling keeps them; a clean draft is replaced without asking", async ({ page }) => {
  await page.goto("/");
  await saveSketch(page, "Mine", 'd1(sound("bd*2"))');

  // Reopening the same sketch with edits asks; keeping them keeps them.
  await setCode(page, 'd1(sound("bd*3"))');
  await page.locator(".sketch").getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText('Reopen "Mine"?');
  await page.getByRole("button", { name: "Keep my changes" }).click();
  await expect(editor(page)).toHaveValue('d1(sound("bd*3"))');

  // Loading an example asks too.
  await page.click("#tabExamples");
  await page.locator("#exampleList .example").first().click();
  await expect(page.getByRole("dialog")).toContainText("Load");
  await page.getByRole("button", { name: "Keep my changes" }).click();
  await expect(editor(page)).toHaveValue('d1(sound("bd*3"))');

  // Discarding reopens the saved version, which is clean again.
  await page.click("#tabLibrary");
  await page.locator(".sketch").getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Discard and reopen" }).click();
  await expect(editor(page)).toHaveValue('d1(sound("bd*2"))');

  // Only the title changed: still unsaved.
  await page.fill("#sketchTitle", "Renamed");
  await page.click("#tabExamples");
  await page.locator("#exampleList .example").first().click();
  await page.getByRole("button", { name: "Keep my changes" }).click();
  await page.click("#tabLibrary");
  await page.fill("#sketchTitle", "Mine");

  // Only the tempo changed (the code does not set it): still unsaved.
  await page.fill("#tempoInput", "1.2");
  await page.locator(".sketch").getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText('Reopen "Mine"?');
  await page.getByRole("button", { name: "Discard and reopen" }).click();

  // A clean draft: an example loads without a question, and so does the next one.
  await page.click("#tabExamples");
  await page.locator("#exampleList .example").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#exampleList .example").nth(1).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // After a reload, an edited draft is still known to be unsaved.
  await setCode(page, 'd1(sound("cp"))');
  await page.waitForTimeout(400);
  await page.reload();
  await page.locator("#exampleList .example").first().click();
  await expect(page.getByRole("dialog")).toContainText("Load");
});
