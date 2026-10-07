/**
 * Rebuilds test/fixtures/voice-names-heard.json — the spoken-name bench. Run
 * from an empty scratch directory (audio is not committed), on a Mac:
 *
 *   node <this dir>/plan.mjs        # names × carriers × voices → plan.json
 *   node <this dir>/synth.mjs       # macOS `say` + afconvert → wav/*.wav (16 kHz mono)
 *   DG_KEY=… node <this dir>/deepgram.mjs   # Nova-3 en-IN and multi, no keyterms → dg.json
 *   swiftc -O -parse-as-library <this dir>/asr.swift -o asr \
 *     -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker <this dir>/Info.plist
 *   ls $PWD/wav/*.wav > list.txt
 *   ./asr en-IN list.txt apple-en-IN.jsonl && ./asr en-US list.txt apple-en-US.jsonl
 *   node <this dir>/build.mjs       # → test/fixtures/voice-names-heard.json
 *
 * The Deepgram key comes from the environment only; never write it down here.
 */
import fs from 'node:fs';
const names = JSON.parse(
  fs.readFileSync(new URL('../../test/fixtures/voice-names.json', import.meta.url), 'utf8'),
);
const carriers = [
  'eight thousand for {name}',
  'split with {name} and me',
  '{name} paid five hundred',
];
const indian = ['Rishi', 'Aman', 'Tara', 'Lekha', 'Vani', 'Geeta', 'Soumya'];
const west = ['Daniel', 'Samantha', 'Karen'];
const rows = [];
names.forEach((n, i) => {
  carriers.forEach((c, j) => {
    let vs;
    if (n.origin === 'english') vs = [west[(i + j) % 3], indian[(i * 3 + j) % 7]];
    else if (n.origin === 'arabic')
      vs = [j === 1 ? 'Majed' : indian[(i * 3 + j) % 7], west[(i + j) % 3]];
    else vs = [indian[(i * 3 + j) % 7], j === 1 ? indian[(i * 3 + j + 3) % 7] : west[(i + j) % 3]];
    for (const v of vs)
      rows.push({
        id: `${n.name}-${j}-${v}`,
        name: n.name,
        carrier: j,
        voice: v,
        text: c.replace('{name}', n.name),
      });
  });
});
fs.writeFileSync('plan.json', JSON.stringify(rows));
fs.writeFileSync('plan.tsv', rows.map((r) => `${r.id}\t${r.voice}\t${r.text}`).join('\n') + '\n');
console.log(rows.length);
