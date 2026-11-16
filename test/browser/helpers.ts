import { expect, type Page } from "@playwright/test";

/** The engine's state, read in the page. */
export const engine = (page: Page) =>
  page.evaluate(() => {
    const t = (window as unknown as { tidal?: { isPlaying: boolean; playingOneShots: boolean; isRecording: boolean } }).tidal;
    return t ? { playing: t.isPlaying, oneShots: t.playingOneShots, recording: t.isRecording } : null;
  });

/** Puts code in the editor as if typed. */
export async function setCode(page: Page, code: string) {
  await page.fill("#codeEditor", code);
}

/** The status line's text (it is hidden when there is no problem, but keeps its text). */
export const statusText = (page: Page) => page.locator("#statusText").evaluate((el) => el.textContent ?? "");

/** Plays the editor's code and waits until the clock runs. */
export async function playAndWait(page: Page) {
  await page.click("#playBtn");
  await expect.poll(async () => (await engine(page))?.playing).toBe(true);
}

/**
 * Holds the audio start (the AudioWorklet module load that init() awaits)
 * until window.__releaseInit() is called. Install before page.goto().
 */
export async function holdAudioStart(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __releaseInit: () => void; __initGate: Promise<void> };
    let release!: () => void;
    w.__initGate = new Promise<void>((resolve) => { release = resolve; });
    w.__releaseInit = () => release();
    const original = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (this: AudioWorklet, ...args: Parameters<AudioWorklet["addModule"]>) {
      await w.__initGate;
      return original.apply(this, args);
    };
  });
}

export const releaseAudioStart = (page: Page) => page.evaluate(() => (window as unknown as { __releaseInit: () => void }).__releaseInit());
