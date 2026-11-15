// Home, voice works offline: with no signal the mic still hears an expense, the
// phone's own recogniser and parser turn it into an expense, and it is saved to
// wait for the network. Strings follow voiceScreen in apps/mobile/src/i18n (en)
// and the on-device engine in apps/mobile/src/lib/voiceEnginePure.ts.
const T = { mic: 0.5, talk: 0.8, think: 2.9, ready: 3.4, add: 5.0, saved: 5.35, chip: 6.2 };
const SAID = 'Dinner eighteen hundred, split with four';
const POS = '#16935B',
  LAV = '#EFEDFA';
const ic = (d, c, s = 18, w = 2) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const MIC = 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  CHECK = 'M5 12.5l4.5 4.5L19 7.5',
  CLOUD_OFF = 'M3 3l18 18M8 8a5 5 0 0 0-2 9.5h11M12 6a5 5 0 0 1 6 5 3.5 3.5 0 0 1 2 5',
  PHONE = 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2';

// Signal bars stay hollow the whole film: nothing here needs the network.
const signal = `<div class="abs" style="left:283px;top:17px;display:flex;gap:2px;align-items:flex-end;z-index:31">${[
  5, 8, 11, 14,
]
  .map(
    (h) =>
      `<i style="width:3px;height:${h}px;border-radius:1px;box-shadow:inset 0 0 0 1.2px #B9B7C8"></i>`,
  )
  .join('')}</div>`;

function status(t) {
  if (t < T.mic) return 'Tap and speak';
  if (t < T.think) return 'Listening…';
  if (t < T.ready) return 'Understanding your expense…';
  if (t < T.saved) return 'Expense ready';
  return 'Added';
}

// The mic disc: a pulse while listening, a soft wave of bars under it.
function mic(t) {
  const on = t >= T.mic && t < T.think;
  const pulse = on ? 1 + 0.08 * Math.sin((t - T.mic) * 9) : 1;
  const bars = Array.from({ length: 13 }, (_, i) => {
    const h = on ? 6 + 22 * Math.abs(Math.sin(t * 7 + i * 0.9) * Math.sin(t * 3.1 + i * 0.4)) : 4;
    return `<i style="width:4px;height:${h}px;border-radius:2px;background:${on ? ACC : '#D9D6E8'}"></i>`;
  }).join('');
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:14px">
    <div style="width:96px;height:96px;border-radius:48px;background:${on ? ACC : LAV};display:flex;align-items:center;justify-content:center;transform:scale(${pulse});box-shadow:${on ? '0 0 0 12px rgba(122,90,248,.15)' : 'none'}">${ic(MIC, on ? '#fff' : ACC, 40, 2)}</div>
    <div style="display:flex;gap:4px;align-items:center;height:30px">${bars}</div></div>`;
}

function card(t) {
  const k = eo(seg(t, T.ready, 0.4));
  if (k <= 0) return '';
  const added = t >= T.saved;
  const row = (l, v) =>
    `<div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #EFEEF5;font-size:13px"><span class="muted">${l}</span><span style="font-weight:700">${v}</span></div>`;
  return `<div class="card" style="margin-top:14px;padding:14px;opacity:${k};transform:translateY(${(1 - k) * 20}px)">
    <div style="display:flex;align-items:center;gap:11px;padding-bottom:10px">
      <span style="width:40px;height:40px;border-radius:12px;background:${LAV};display:flex;align-items:center;justify-content:center;font-size:19px">🍲</span>
      <span style="flex:1"><div style="font-size:16px;font-weight:800">Dinner</div><div class="muted" style="font-size:11.5px">Manali trip</div></span>
      <span class="num" style="font-size:20px;font-weight:800">${count(t, T.ready, 0.6, 1800)}</span>
    </div>
    ${row('Category', 'Food & drink')}${row('Split with', '4 people · ₹450 each')}
    <div style="margin-top:10px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:15px;font-weight:700;background:${added ? POS + '1A' : ACC};color:${added ? POS : '#fff'}">${added ? ic(CHECK, POS, 17, 2.6) + 'Added' : 'Add expense'}</div>
  </div>`;
}

function chip(t) {
  const k = eo(seg(t, T.chip, 0.35));
  if (k <= 0) return '';
  return `<div style="margin-top:12px;display:flex;justify-content:center;opacity:${k};transform:translateY(${(1 - k) * 12}px)"><span style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:15px;background:#fff;box-shadow:inset 0 0 0 1.5px #D9D6E8;font-size:13px;font-weight:700;color:#55556B">${ic(CLOUD_OFF, '#7B7B8F', 15)}Offline · 1 waiting to sync</span></div>`;
}

function screen(t) {
  const heard = t >= T.talk ? typed(t, T.talk, SAID, 21) : '';
  return `<div class="page">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:22px">‹</span>
      <span style="flex:1"></span>
      <span style="display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:13px;background:${LAV};font-size:11px;font-weight:700;color:${ACC}">${ic(PHONE, ACC, 13)}On this phone</span>
    </div>
    <div style="margin-top:14px;font-size:24px;font-weight:800;letter-spacing:-.02em">Just say it naturally</div>
    <div class="muted" style="font-size:12px;margin-top:2px">${status(t)}</div>
    <div style="margin-top:22px">${mic(t)}</div>
    <div class="card" style="margin-top:16px;padding:12px 14px;min-height:72px">
      <div class="lbl">${t < T.think ? 'Hearing' : 'You said'}</div>
      <div style="margin-top:4px;font-size:16px;font-weight:600;line-height:1.35">${heard || '<span class="muted">…</span>'}</div>
    </div>
    ${card(t)}${chip(t)}
  </div>`;
}

function FILM(t) {
  const taps = finger(t, T.mic, 165, 206) + finger(t, T.add, 165, 586);
  const scr =
    screen(t) +
    signal +
    `<div class="abs" style="left:0;top:0;width:330px;height:715px;zoom:1.18">${taps}</div>`;
  return (
    words(
      t,
      ['No signal', 'Just say it', 'Understood', 'Saved'],
      [
        [0, T.mic],
        [T.mic, T.think],
        [T.think, T.saved],
        [T.saved, 99],
      ],
    ) +
    big(t, [
      [T.ready + 0.2, T.saved, () => inr(1800)],
      [T.saved + 0.2, 99, () => 'Offline'],
    ]) +
    phone(scr)
  );
}
