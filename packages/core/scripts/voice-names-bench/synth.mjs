/** Speaks every planned sentence with macOS `say` and converts it to 16 kHz mono WAV. */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const rows = JSON.parse(fs.readFileSync('plan.json', 'utf8'));
let k = 0,
  fail = 0;
async function worker() {
  while (k < rows.length) {
    const r = rows[k++];
    const w = `wav/${r.id}.wav`,
      a = `wav/${r.id}.aiff`;
    if (fs.existsSync(w)) continue;
    try {
      await run('say', ['-v', r.voice, '-o', a, r.text]);
      await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', a, w]);
      fs.unlinkSync(a);
    } catch (e) {
      fail++;
      console.error(r.id, e.message.slice(0, 100));
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log('done fail', fail);
