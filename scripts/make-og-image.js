// Retakes the card the project is shared with (site/og-image.html), at two sizes:
//
//   npm run og-image   ->  site/og-image.png, the landing page's link preview
//                          docs/social-preview.png, the GitHub repository's social preview
//
// GitHub's is not read from the repository: upload it by hand under Settings > General >
// Social preview. It has to be under 1 MB. Retake both after `npm run screenshot`, which they show.
//
// Needs a browser for Playwright: npx playwright-core install chromium-headless-shell
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const CARDS = [
  // The size link previews are cropped to. site/index.html repeats it in og:image:width and :height.
  { file: 'site/og-image.png', size: { width: 1200, height: 630 } },
  // The size GitHub asks for.
  { file: 'docs/social-preview.png', size: { width: 1280, height: 640 } },
];

const browser = await chromium.launch();
for (const { file, size } of CARDS) {
  const card = await browser.newPage({ viewport: size });
  await card.goto(pathToFileURL(path.join(ROOT, 'site', 'og-image.html')).href);
  await card.screenshot({ path: path.join(ROOT, file) });
  await card.close();
  console.log(`${file} (${Math.round(fs.statSync(path.join(ROOT, file)).size / 1024)} KB)`);
}
await browser.close();
