// node render.mjs <film> [--sheet]   (needs playwright + ffmpeg)
// Writes ../videos/<name>.mp4 (H.264 yuv420p, faststart) and <name>.jpg (poster),
// or with --sheet a contact sheet (one frame per half second) in $SHEET_DIR or the temp dir.
// Not next to this file: publish.sh uploads every .png under infra/art.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const [film, flag] = process.argv.slice(2);
const NAMES = {
  allowance: 'companies-allowance',
  transactions: 'personal-transactions',
  sync: 'home-offline-sync',
  voice: 'home-offline-voice',
  wearables: 'home-wearables',
  agents: 'home-agents',
  companies: 'companies-team',
};
// Wide films have their own page and size; the rest are 1080 squares in index.html.
const WIDE = ['wearables', 'agents', 'companies'].includes(film)
  ? { w: 1920, h: 1080, dur: 10 }
  : null;
const name = NAMES[film];
if (!name) throw new Error(`unknown film: ${film}`);
const FPS = 30,
  DUR = WIDE?.dur ?? 8,
  W = WIDE?.w ?? 1080,
  H = WIDE?.h ?? 1080;
const POSTER = {
  allowance: 6.8,
  transactions: 1.6,
  sync: 6.4,
  voice: 4.2,
  wearables: 2.9,
  agents: 2.8,
  companies: 4.2,
}[film];

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(
  WIDE ? `file://${dir}/wide.html?film=${film}` : `file://${dir}/index.html?film=${film}`,
);
await page.waitForFunction(() => window.ready === true);
const shot = async (t, quality = 95) => {
  await page.evaluate((x) => window.seek(x), t);
  return page.screenshot({ type: 'jpeg', quality, clip: { x: 0, y: 0, width: W, height: H } });
};

if (flag === '--sheet') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'film-sheet-'));
  const list = [];
  const N = DUR * 2;
  for (let i = 0; i < N; i++) {
    const f = path.join(tmp, `${String(i).padStart(2, '0')}.jpg`);
    fs.writeFileSync(f, await shot(i / 2 + 0.05, 85));
    list.push(`file '${f}'`);
  }
  fs.writeFileSync(path.join(tmp, 'list.txt'), list.join('\n'));
  const out = path.join(process.env.SHEET_DIR || os.tmpdir(), `sheet-${film}.png`);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(tmp, 'list.txt'),
    '-vf',
    `scale=${W === 1080 ? 270 : 480}:-1,tile=4x${Math.ceil(N / 4)}:padding=4:color=0x555555`,
    '-frames:v',
    '1',
    out,
  ]);
  fs.rmSync(tmp, { recursive: true });
  console.log(out);
} else {
  const out = path.join(dir, '..', 'videos', `${name}.mp4`);
  const ff = spawn(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      String(FPS),
      '-i',
      '-',
      '-vf',
      'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-preset',
      'slow',
      '-crf',
      '16',
      '-tune',
      'animation',
      '-pix_fmt',
      'yuv420p',
      '-color_range',
      'tv',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-movflags',
      '+faststart',
      out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  for (let i = 0; i < FPS * DUR; i++) {
    if (!ff.stdin.write(await shot(i / FPS))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  fs.writeFileSync(path.join(dir, '..', 'videos', `${name}.jpg`), await shot(POSTER, 82));
  console.log(out);
}
if (errs.length) {
  console.error('PAGE ERRORS:', errs);
  process.exitCode = 1;
}
await browser.close();
