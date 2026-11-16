import { expect, test, type Page } from "@playwright/test";
import { encodeShareHash } from "../../src/share.ts";
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

test("a tempo set by an event survives a live edit of another stream; the document's tempo applies when it starts", async ({ page }) => {
  await page.goto("/");
  const cps = () => page.evaluate(() => (window as unknown as { tidal: { cps: number } }).tidal.cps);
  // A one-time cps(2) event in d2 (cycle 0 only).
  await setCode(page, 'd1(sound("bd*4"))\nd2(sound("cp").cps(2).playFor(0, 1))');
  await playAndWait(page);
  await expect.poll(cps).toBe(2);
  // Edit only d1: the live update keeps the tempo the event set.
  await setCode(page, 'd1(sound("bd*8"))\nd2(sound("cp").cps(2).playFor(0, 1))');
  await page.waitForTimeout(1500);
  await expect.poll(() => statusText(page)).toContain("Updated");
  expect(await cps()).toBe(2);
  // Changing the tempo on purpose (the tempo field) still applies at once.
  await page.fill("#tempoInput", "1.2");
  await expect.poll(cps).toBe(1.2);
  // After Stop, Play starts the document again at its tempo.
  await page.click("#stopBtn");
  await page.fill("#tempoInput", "0.9");
  await playAndWait(page);
  await expect.poll(cps).toBe(2); // the cps(2) event at cycle 0 runs again
});

for (const withName of [true, false]) {
  test(`a live edit waiting for its bank keeps the working stream, then ${withName ? "commits when the sound arrives" : "stays held back when it does not"}`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("https://banks.test/**", async (route) => {
      if (route.request().url().endsWith(".json")) {
        await held;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(withName ? { zork: ["z.wav"] } : { other: ["o.wav"] }) });
      } else {
        await route.fulfill({ status: 404, body: "" });
      }
    });
    await page.goto("/");
    const d1Sound = () => page.evaluate(() => {
      const t = (window as unknown as { tidal: { channels: Map<string, { query(b: number, e: number): { value: { s: string } }[] }> } }).tidal;
      return t.channels.get("d1")?.query(0, 1)[0]?.value.s;
    });
    await setCode(page, 'd1(sound("bd*2"))');
    await playAndWait(page);
    await setCode(page, 'samples("https://banks.test/kit/strudel.json")\nd1(sound("zork*2"))');
    await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("Waiting for samples (zork)");
    expect(await d1Sound()).toBe("bd"); // the working stream stays
    release();
    if (withName) {
      await expect.poll(d1Sound, { timeout: 5000 }).toBe("zork");
    } else {
      await expect.poll(() => statusText(page), { timeout: 5000 }).toContain('Unknown sound "zork"');
      expect(await d1Sound()).toBe("bd");
    }
  });
}

/** Counts the engine's evaluations from now on (the engine exists once something has played). */
async function countEvaluations(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __evals: number; tidal: { eval: (...args: unknown[]) => unknown } };
    w.__evals = 0;
    const original = w.tidal.eval;
    w.tidal.eval = function (this: unknown, ...args: unknown[]) {
      w.__evals++;
      return original.apply(this, args);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __evals: number }).__evals);
}

/** Holds the manifests of https://r6.test until release(banks or an HTTP status) and counts the requests for them. */
async function holdManifest(page: Page) {
  let answer!: (body: Record<string, string[]> | number) => void;
  const held = new Promise<Record<string, string[]> | number>((resolve) => { answer = resolve; });
  const counts = { manifests: 0 };
  await page.route("https://r6.test/**", async (route) => {
    if (!route.request().url().endsWith(".json")) return route.fulfill({ status: 404, body: "" });
    counts.manifests++;
    const body = await held;
    if (typeof body === "number") return route.fulfill({ status: body, body: "" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return { release: answer, counts };
}

const d1Sound = (page: Page) => page.evaluate(() => {
  const t = (window as unknown as { tidal: { channels: Map<string, { query(b: number, e: number): { value: { s: string } }[] }> } }).tidal;
  return t.channels.get("d1")?.query(0, 1)[0]?.value.s;
});
const WAITING = 'samples("https://r6.test/kit/strudel.json")\nd1(sound("zonk*2"))';

test("a held-back edit whose manifest fails is checked again once, then settles with the warning and Retry", async ({ page }) => {
  const manifest = await holdManifest(page);
  await page.goto("/");
  await setCode(page, 'd1(sound("bd*2"))');
  await playAndWait(page);
  const evaluations = await countEvaluations(page);
  await setCode(page, WAITING);
  await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("Waiting for samples (zonk)");
  expect(await evaluations()).toBe(1);
  manifest.release(500);
  await expect.poll(() => statusText(page), { timeout: 5000 }).toContain('Unknown sound "zonk"');
  await expect(page.locator("#statusAction")).toHaveText("Retry");
  await page.waitForTimeout(2000);
  expect(await evaluations()).toBe(2); // the edit, and one check after the load failed: no loop
  expect(manifest.counts.manifests).toBe(1);
  expect(await d1Sound(page)).toBe("bd");
  // Retry still asks again, and checks the edit again.
  await page.click("#statusAction");
  await expect.poll(() => manifest.counts.manifests).toBe(2);
  expect(await evaluations()).toBeGreaterThan(2);
});

test("an invalid samples() argument is an error in the edit: the music stays and nothing runs again", async ({ page }) => {
  await page.goto("/");
  await setCode(page, 'd1(sound("bd*2"))');
  await playAndWait(page);
  const evaluations = await countEvaluations(page);
  await setCode(page, 'samples(42)\nd1(sound("zonk*2"))');
  await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("samples() expects");
  expect(await statusText(page)).toContain("Previous patterns keep playing");
  await page.waitForTimeout(2000);
  expect(await evaluations()).toBe(1);
  expect(await d1Sound(page)).toBe("bd");
  expect((await engine(page))?.playing).toBe(true);
});

for (const action of ["Play", "Stop", "Live update off", "another document"] as const) {
  test(`a check waiting for samples is dropped by ${action}: the manifest arriving later runs nothing`, async ({ page }) => {
    const manifest = await holdManifest(page);
    await page.goto("/");
    await setCode(page, 'd1(sound("bd*2"))');
    await playAndWait(page);
    await setCode(page, WAITING);
    await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("Waiting for samples (zonk)");
    const evaluations = await countEvaluations(page);
    let expected = 0;
    if (action === "Play") {
      await page.click("#playBtn"); // runs the code itself, once
      expected = 1;
      await expect.poll(evaluations).toBe(1);
    } else if (action === "Stop") {
      await page.click("#stopBtn");
    } else if (action === "Live update off") {
      await page.locator("#liveToggle").uncheck();
      await expect.poll(() => statusText(page)).toContain("Live update is off");
    } else {
      const hash = await encodeShareHash({ title: "Other", code: WAITING, cps: 0.8 });
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.getByRole("button", { name: "Open in editor" }).click();
      await page.getByRole("button", { name: "Replace it" }).click();
      await expect.poll(() => statusText(page)).toContain("for review");
    }
    const statusBefore = await statusText(page);
    expect(manifest.counts.manifests).toBe(1);
    manifest.release({ zonk: ["z.wav"] });
    await expect.poll(() => page.evaluate(() => (window as unknown as { tidal: { isLoadingSamples(): boolean } }).tidal.isLoadingSamples())).toBe(false);
    await page.waitForTimeout(1500);
    expect(await evaluations()).toBe(expected); // nothing ran again when the manifest settled
    if (action === "Play") {
      // The Play's own run: it plays the new code, and its message stays its own (no "Updated", no waiting).
      expect(await d1Sound(page)).toBe("zonk");
      expect(await statusText(page)).not.toContain("Waiting for samples");
      expect(await statusText(page)).not.toContain("Updated");
    } else {
      expect(await statusText(page)).toBe(statusBefore);
      if (action !== "Stop") expect(await d1Sound(page)).toBe("bd");
    }
  });
}

test("code whose manifest changes on every run is checked again once: evaluating and fetching stop, the music stays", async ({ page }) => {
  const urls: string[] = [];
  await page.route("https://r7.test/**", (route) => {
    if (!route.request().url().endsWith(".json")) return route.fulfill({ status: 404, body: "" });
    urls.push(route.request().url());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ other: ["o.wav"] }) });
  });
  await page.goto("/");
  await setCode(page, 'd1(sound("bd*2"))');
  await playAndWait(page);
  const evaluations = await countEvaluations(page);
  await setCode(page, 'samples("https://r7.test/" + Math.random() + "/strudel.json")\nd1(sound("zonk*2"))');
  await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("not checked again by itself");
  await page.waitForTimeout(2500);
  expect(await evaluations()).toBe(2); // the edit, and its one check after its manifest arrived
  expect(urls.length).toBe(2);
  expect(new Set(urls).size).toBe(2); // each run asked for another manifest
  expect(await statusText(page)).toContain("Still waiting for samples (zonk)");
  expect(await statusText(page)).toContain("previous patterns keep playing");
  expect(await d1Sound(page)).toBe("bd");
  expect((await engine(page))?.playing).toBe(true);
});

for (const arrives of ["before", "after"] as const) {
  test(`an edit dropped by turning live update off runs again when it is back on (manifest arriving ${arrives})`, async ({ page }) => {
    const manifest = await holdManifest(page);
    await page.goto("/");
    await setCode(page, 'd1(sound("bd*2"))');
    await playAndWait(page);
    await setCode(page, WAITING);
    await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("Waiting for samples (zonk)");
    const evaluations = await countEvaluations(page);
    await page.locator("#liveToggle").uncheck();
    await expect.poll(() => statusText(page)).toContain("Live update is off");
    const loaded = () => page.evaluate(() => !(window as unknown as { tidal: { isLoadingSamples(): boolean } }).tidal.isLoadingSamples());
    if (arrives === "before") {
      manifest.release({ zonk: ["z.wav"] });
      await expect.poll(loaded).toBe(true);
      await page.waitForTimeout(500);
      expect(await evaluations()).toBe(0); // nothing runs with live update off
      await page.locator("#liveToggle").check();
      // Checked again at once: the sound is there, so it commits.
      await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("Updated");
      expect(await evaluations()).toBe(1);
    } else {
      await page.locator("#liveToggle").check();
      // Checked again at once: still waiting for the same manifest (not asked for again), and the status says so.
      await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("Waiting for samples (zonk)");
      expect(await evaluations()).toBe(1);
      manifest.release({ zonk: ["z.wav"] });
      await expect.poll(() => statusText(page), { timeout: 5000 }).toContain("Updated");
      expect(await evaluations()).toBe(2);
    }
    expect(await d1Sound(page)).toBe("zonk");
    expect(manifest.counts.manifests).toBe(1);
    await page.waitForTimeout(1000);
    expect(await evaluations()).toBe(arrives === "before" ? 1 : 2); // and nothing more
  });
}

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
