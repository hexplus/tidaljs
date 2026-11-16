import { expect, test } from "@playwright/test";
import { encodeShareHash } from "../../src/share.ts";
import { engine, holdAudioStart, playAndWait, releaseAudioStart, setCode, statusText } from "./helpers.ts";

/** Code that counts its runs, so a test can tell whether it ran. */
const SHARED = 'window.__ranShared = (window.__ranShared || 0) + 1\nd1(sound("hh*4"))';
const ranShared = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __ranShared?: number }).__ranShared);

test("a shared song opens for review during a performance and runs only after an explicit approval", async ({ page }) => {
  await page.goto("/");
  await setCode(page, 'd1(sound("bd*2"))');
  await playAndWait(page);

  const hash = await encodeShareHash({ title: "Shared song", code: SHARED, cps: 0.5 });
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.getByRole("button", { name: "Open in editor" }).click();
  // The typed draft is unsaved: replacing it asks first, and keeping it keeps it.
  await page.getByRole("button", { name: "Keep my changes" }).click();
  await expect(page.locator("#codeEditor")).toHaveValue('d1(sound("bd*2"))');
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.getByRole("button", { name: "Open in editor" }).click();
  await page.getByRole("button", { name: "Replace it" }).click();
  await expect(page.locator("#codeEditor")).toHaveValue(SHARED);

  // Opening it ran nothing; live update does not run it either; the music that was playing plays on.
  await page.waitForTimeout(1500);
  expect(await ranShared(page)).toBeUndefined();
  expect((await engine(page))?.playing).toBe(true);

  // Still under review after a reload (provenance kept with the draft).
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator("#codeEditor")).toHaveValue(SHARED);
  await page.click("#playBtn");
  await expect(page.getByRole("dialog")).toContainText("Run code someone else wrote?");
  await page.getByRole("button", { name: "Don't run" }).click();
  expect(await ranShared(page)).toBeUndefined();

  // Allowed: that text runs once; from then on it is the person's code and Play just runs it.
  await page.click("#playBtn");
  await page.getByRole("button", { name: "Allow and run" }).click();
  await expect.poll(() => ranShared(page)).toBe(1);
  await page.click("#playBtn");
  await expect.poll(() => ranShared(page)).toBe(2);
});

test("a reload right after switching away from unreviewed external code never restores it as local", async ({ page }) => {
  await page.goto("/");
  const hash = await encodeShareHash({ title: "Shared song", code: SHARED, cps: 0.5 });
  // Reloaded at once after opening it: still external.
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.getByRole("button", { name: "Open in editor" }).click();
  await expect(page.locator("#codeEditor")).toHaveValue(SHARED);
  await page.reload();
  await expect(page.locator("#codeEditor")).toHaveValue(SHARED);
  await page.click("#playBtn");
  await expect(page.getByRole("dialog")).toContainText("Run code someone else wrote?");
  await page.getByRole("button", { name: "Don't run" }).click();
  // Switched to a built-in example and reloaded at once: the example comes back, local, and the shared code never ran.
  await page.locator("#exampleList .example").first().click();
  const example = await page.locator("#codeEditor").inputValue();
  expect(example).not.toBe(SHARED);
  await page.reload();
  await expect(page.locator("#codeEditor")).toHaveValue(example);
  await page.click("#playBtn");
  await expect.poll(async () => (await engine(page))?.playing).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await ranShared(page)).toBeUndefined();
});

test("a shared song's tempo applies only when it runs, and an empty draft survives a reload", async ({ page }) => {
  await page.goto("/");
  await setCode(page, 'd1(sound("bd*2"))');
  await playAndWait(page);
  const cps = () => page.evaluate(() => (window as unknown as { tidal: { cps: number } }).tidal.cps);
  const before = await cps();
  const hash = await encodeShareHash({ title: "Fast song", code: SHARED, cps: 1.75 });
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.getByRole("button", { name: "Open in editor" }).click();
  await page.getByRole("button", { name: "Replace it" }).click();
  await page.waitForTimeout(300);
  expect(await cps()).toBe(before); // the music playing keeps its tempo
  await page.click("#playBtn");
  await page.getByRole("button", { name: "Allow and run" }).click();
  await expect.poll(cps).toBe(1.75);

  await setCode(page, "");
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator("#codeEditor")).toHaveValue("");
});

test("an approval goes stale when the code changes while the audio starts", async ({ page }) => {
  await holdAudioStart(page);
  await page.goto("/");
  const hash = await encodeShareHash({ title: "Shared song", code: SHARED, cps: 0.5 });
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.getByRole("button", { name: "Open in editor" }).click();
  await page.click("#playBtn");
  await page.getByRole("button", { name: "Allow and run" }).click();
  // The audio is still starting: the code changes before it can run.
  await page.locator("#codeEditor").press("End");
  await page.locator("#codeEditor").type(" // edited");
  await releaseAudioStart(page);
  await expect.poll(() => statusText(page)).toContain("changed after you allowed it");
  expect(await ranShared(page)).toBeUndefined();
  expect((await engine(page))?.playing).toBe(false);
});

test("a SuperCollider file is converted in a worker and opens for review", async ({ page }) => {
  await page.goto("/");
  await page.click("#tabLibrary");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import .scd (alpha)" }).click();
  const scd = 'Pbind(\\instrument, \\default, \\degree, Pseq([0, 2, 4], inf), \\dur, 0.25).play;';
  await (await chooser).setFiles({ name: "melody.scd", mimeType: "text/plain", buffer: Buffer.from(scd) });
  // The editor holds the untouched starting code: it is replaced without a question.
  await expect(page.locator("#codeEditor")).toHaveValue(/Converted from SuperCollider/i);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await statusText(page)).toContain("has not run");
  expect(await engine(page)).toBeNull(); // nothing started the audio, let alone ran the code
  // Played only after the review question.
  await page.click("#playBtn");
  await page.getByRole("button", { name: "Allow and run" }).click();
  await expect.poll(async () => (await engine(page))?.playing).toBe(true);
});

test("an imported file opens for review and does not run during a performance", async ({ page }) => {
  await page.goto("/");
  await setCode(page, 'd1(sound("bd*2"))');
  await playAndWait(page);
  await page.click("#tabLibrary");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await (await chooser).setFiles({ name: "groove.js", mimeType: "text/javascript", buffer: Buffer.from(SHARED) });
  // The typed code is unsaved: replacing it always asks first (after the file is read, so wait for the question).
  await page.getByRole("button", { name: "Discard and open" }).click();
  await expect(page.locator("#codeEditor")).toHaveValue(SHARED);
  await page.waitForTimeout(1500);
  expect(await ranShared(page)).toBeUndefined();
  expect(await statusText(page)).toContain("for review");
});
