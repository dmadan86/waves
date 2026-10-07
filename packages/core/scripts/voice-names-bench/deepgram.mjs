/** Transcribes every clip with Deepgram Nova-3 (en-IN and multi), no keyterm boosting. Key from DG_KEY. */
import fs from 'node:fs';
const KEY = process.env.DG_KEY;
const rows = JSON.parse(fs.readFileSync('plan.json', 'utf8'));
const out = fs.existsSync('dg.json') ? JSON.parse(fs.readFileSync('dg.json', 'utf8')) : {};
const jobs = [];
for (const r of rows)
  for (const lang of ['en-IN', 'multi'])
    if (out[`${r.id}|${lang}`] === undefined) jobs.push([r, lang]);
let k = 0,
  n = 0;
async function worker() {
  while (k < jobs.length) {
    const [r, lang] = jobs[k++];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `https://api.deepgram.com/v1/listen?model=nova-3&language=${lang}&numerals=true`,
          {
            method: 'POST',
            headers: { Authorization: `Token ${KEY}`, 'Content-Type': 'audio/wav' },
            body: fs.readFileSync(`wav/${r.id}.wav`),
          },
        );
        const d = await res.json();
        const t = d.results.channels[0].alternatives[0].transcript;
        out[`${r.id}|${lang}`] = t;
        break;
      } catch (e) {
        await new Promise((s) => setTimeout(s, 1000));
      }
    }
    if (++n % 200 === 0) {
      fs.writeFileSync('dg.json', JSON.stringify(out));
      console.log(n);
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
fs.writeFileSync('dg.json', JSON.stringify(out));
console.log('done', Object.keys(out).length);
