import { expect, test } from "@playwright/test";
import { engine, holdAudioStart, playAndWait, releaseAudioStart, setCode, statusText } from "./helpers.ts";

test("Stop while the audio starts: the waiting Play never starts the music", async ({ page }) => {
  await holdAudioStart(page);
  await page.goto("/");
  await setCode(page, 'd1(sound("bd*2"))');
  await page.click("#playBtn");
  await page.click("#playBtn"); // a second click shares the same start
  await page.click("#stopBtn");
  await releaseAudioStart(page);
  await page.waitForTimeout(500);
  expect((await engine(page))?.playing).toBe(false);
  expect(await statusText(page)).toContain("Stopped");
  // The next Play works.
  await playAndWait(page);
});

test("Stop while samples load: their arrival neither restarts the music nor replaces the status", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("https://samples.test/**", async (route) => {
    if (route.request().url().endsWith(".json")) {
      await held;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ kick: ["kick.wav"] }) });
    } else {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await page.goto("/");
  await setCode(page, 'samples("https://samples.test/kit/strudel.json")\nd1(sound("kick*2"))');
  await playAndWait(page);
  await expect.poll(() => statusText(page)).toContain("Loading samples");
  await page.click("#stopBtn");
  release();
  await page.waitForTimeout(1000);
  expect((await engine(page))?.playing).toBe(false);
  expect(await statusText(page)).toContain("Stopped");
  // The bank arrived for the next run, without the code having run again.
  expect(await page.evaluate(() => (window as unknown as { tidal: { sampleBanks: Map<string, string[]> } }).tidal.sampleBanks.get("kick"))).toEqual([
    "https://samples.test/kit/kick.wav",
  ]);
});

test("a failed sample load is reported once, with a deliberate retry", async ({ page }) => {
  let manifestRequests = 0;
  await page.route("https://samples.test/**", (route) => {
    manifestRequests++;
    return route.fulfill({ status: 500, body: "" });
  });
  await page.goto("/");
  await setCode(page, 'samples("https://samples.test/broken/strudel.json")\nd1(sound("kick*2"))');
  await page.click("#playBtn");
  await expect(page.locator("#statusAction")).toHaveText("Retry");
  // Live updates do not ask again by themselves.
  await page.locator("#codeEditor").press("End");
  await page.locator("#codeEditor").type(" ");
  await page.waitForTimeout(1500);
  expect(manifestRequests).toBe(1);
  await page.click("#statusAction");
  await expect.poll(() => manifestRequests).toBe(2);
});

test("standalone one-shots play fully, stay independent of the loops, and Stop ends them", async ({ page }) => {
  await page.goto("/");
  await setCode(page, 'once(sound("bd sn hh cp").slow(4))');
  await page.click("#playBtn");
  await expect.poll(async () => (await engine(page))?.oneShots).toBe(true);
  expect((await engine(page))?.playing).toBe(false);
  // Running other code (no loops, then loops, then none) does not cut it.
  await setCode(page, "// nothing");
  await page.click("#playBtn");
  await setCode(page, 'd1(sound("hh*2"))');
  await playAndWait(page);
  await setCode(page, "");
  await page.click("#playBtn");
  expect((await engine(page))?.oneShots).toBe(true);
  // Stop does.
  await page.click("#stopBtn");
  expect((await engine(page))?.oneShots).toBe(false);
});
