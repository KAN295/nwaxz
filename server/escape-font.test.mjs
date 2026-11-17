import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../public/assets/fonts/escape/", import.meta.url);

test("bundled escape fonts are small WOFF2 subsets shipped with their OFL licence", () => {
  for (const [file, maxKiB] of [["noto-serif-sc-bold-escape.woff2", 400], ["noto-serif-sc-black-title.woff2", 60]]) {
    const bytes = fs.readFileSync(new URL(file, dir));
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", file);
    assert.ok(bytes.length < maxKiB * 1024, `${file} is ${Math.round(bytes.length / 1024)} KiB`);
  }
  assert.match(fs.readFileSync(new URL("OFL.txt", dir), "utf8"), /SIL Open Font License/);
  const theme = fs.readFileSync(new URL("../src/escape/theme.css", import.meta.url), "utf8");
  assert.match(theme, /@font-face\{font-family:"Escape Serif";src:url\('\/assets\/fonts\/escape\/noto-serif-sc-bold-escape\.woff2'\)/);
  assert.match(theme, /font-display:swap/);
});
