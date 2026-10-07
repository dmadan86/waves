/** Folds the Deepgram and Apple transcripts into test/fixtures/voice-names-heard.json. */
import fs from 'node:fs';
const plan = JSON.parse(fs.readFileSync('plan.json', 'utf8'));
const dg = JSON.parse(fs.readFileSync('dg.json', 'utf8'));
const engines = [
  'deepgram-nova3-en-IN',
  'deepgram-nova3-multi',
  'apple-ondevice-en-IN',
  'apple-ondevice-en-US',
];
const apple = {};
for (const [i, loc] of [
  [2, 'en-IN'],
  [3, 'en-US'],
]) {
  if (!fs.existsSync(`apple-${loc}.jsonl`)) continue;
  for (const line of fs.readFileSync(`apple-${loc}.jsonl`, 'utf8').split('\n').filter(Boolean)) {
    const { path, text } = JSON.parse(line);
    const id = path
      .split('/')
      .pop()
      .replace(/\.wav$/, '');
    apple[`${id}|${i}`] = text;
  }
}
const cases = [];
for (const r of plan) {
  cases.push([r.name, r.voice, r.carrier, 0, dg[`${r.id}|en-IN`] ?? '']);
  cases.push([r.name, r.voice, r.carrier, 1, dg[`${r.id}|multi`] ?? '']);
  for (const i of [2, 3])
    if (apple[`${r.id}|${i}`] !== undefined)
      cases.push([r.name, r.voice, r.carrier, i, apple[`${r.id}|${i}`]]);
}
const out = {
  engines,
  carriers: ['eight thousand for {name}', 'split with {name} and me', '{name} paid five hundred'],
  cases,
};
// one case per line keeps diffs readable
const body = JSON.stringify({ ...out, cases: [] }).replace(
  '"cases":[]',
  '"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(',\n') + '\n]',
);
fs.writeFileSync(
  new URL('../../test/fixtures/voice-names-heard.json', import.meta.url),
  body + '\n',
);
console.log(cases.length);
