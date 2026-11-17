import { expect, test, type Page } from "@playwright/test";
import { setCode } from "./helpers.ts";

/** Rests the mouse on the first `word` of the editor's single line of code. */
async function hoverWord(page: Page, code: string, word: string) {
  const column = code.indexOf(word);
  const point = await page.locator("#codeEditor").evaluate((ta, column) => {
    const style = getComputedStyle(ta);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = style.font;
    const charWidth = ctx.measureText("M".repeat(100)).width / 100;
    const rect = ta.getBoundingClientRect();
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    return {
      x: rect.left + parseFloat(style.paddingLeft) + (column + 0.5) * charWidth,
      y: rect.top + parseFloat(style.paddingTop) + lineHeight / 2,
    };
  }, column);
  await page.mouse.move(point.x, point.y);
}

test("hover help explains globals, methods and mini-notation in the editor", async ({ page }) => {
  await page.goto("/");
  const tooltip = page.locator("#hoverhelp");

  // A signal that only had extended help showed no tooltip before.
  let code = 'sound("hh*8").pan(saw2)';
  await setCode(page, code);
  await hoverWord(page, code, "saw2");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("A rising ramp from -1 to 1");

  // A method with its parameters.
  code = 'sound("bd").gainTake("g", [1, 0.8])';
  await setCode(page, code);
  await hoverWord(page, code, "gainTake");
  await expect(tooltip).toContainText(".gainTake(name, list)");

  // Tidal's "-" rest is not an unknown sound.
  code = 'sound("bd - sn -")';
  await setCode(page, code);
  await hoverWord(page, code, "-");
  await expect(tooltip).toContainText("A rest, the same as ~");
  await expect(tooltip).not.toContainText("Unknown sound");
});
