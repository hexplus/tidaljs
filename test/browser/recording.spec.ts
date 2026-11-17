import { expect, test } from "@playwright/test";
import { engine, playAndWait, setCode, statusText } from "./helpers.ts";

test("a recording is saved as a file, and the button follows the engine", async ({ page }) => {
  await page.goto("/");
  await setCode(page, 'd1(sound("superpiano*4").note("c e g b"))');
  await playAndWait(page);
  await page.click("#recordBtn");
  await expect(page.locator("#recordBtn")).toHaveText("Stop recording");
  expect((await engine(page))?.recording).toBe(true);
  await page.waitForTimeout(800);
  const download = page.waitForEvent("download");
  await page.click("#recordBtn");
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^tidaljs-recording/);
  await expect(page.locator("#recordBtn")).toHaveText("Record");
  await expect.poll(() => statusText(page)).toContain("saved");
  expect((await engine(page))?.recording).toBe(false);
});

test("a recorder that cannot start leaves nothing behind, says so, and can be tried again", async ({ page }) => {
  await page.addInitScript(() => {
    const Real = window.MediaRecorder;
    const w = window as unknown as { __breakRecorder: boolean };
    w.__breakRecorder = true;
    window.MediaRecorder = class extends Real {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        if (w.__breakRecorder) throw new Error("no recorder here");
        super(stream, options);
      }
    } as typeof MediaRecorder;
  });
  await page.goto("/");
  await setCode(page, 'd1(sound("bd*2"))');
  await playAndWait(page);
  await page.click("#recordBtn");
  await expect.poll(() => statusText(page)).toContain("Recording failed: no recorder here");
  await expect(page.locator("#recordBtn")).toHaveText("Record");
  expect((await engine(page))?.recording).toBe(false);
  // Retry once the recorder works.
  await page.evaluate(() => { (window as unknown as { __breakRecorder: boolean }).__breakRecorder = false; });
  await page.click("#recordBtn");
  await expect(page.locator("#recordBtn")).toHaveText("Stop recording");
  const download = page.waitForEvent("download");
  await page.waitForTimeout(400);
  await page.click("#recordBtn");
  await download;
  await expect(page.locator("#recordBtn")).toHaveText("Record");
});
