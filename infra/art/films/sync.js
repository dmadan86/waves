// Home, works offline: with no signal three expenses are saved on the phone and
// wait; the signal returns and the queue is sent oldest first, then the balance
// settles for everyone. Strings follow the home page "offline" band (en) and the
// sync engine's order guarantee (ADR-005).
const T = { add: [0.5, 1.5, 2.5], online: 3.4, sent: [3.9, 4.3, 4.7], synced: 5.1 };
const POS = '#16935B',
  LAV = '#EFEDFA';
// Newest on top; added (and later sent) in the order homestay, firewood, tea.
const ROWS = [
  { title: 'Tea', amt: 120, n: 2 },
  { title: 'Firewood', amt: 300, n: 1 },
  { title: 'Homestay dinner', amt: 1800, n: 0 },
];
const ic = (d, c, s = 18, w = 2) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const CHECK = 'M5 12.5l4.5 4.5L19 7.5',
  CLOUD_OFF = 'M3 3l18 18M8 8a5 5 0 0 0-2 9.5h11M12 6a5 5 0 0 1 6 5 3.5 3.5 0 0 1 2 5',
  SYNC = 'M20 11a8 8 0 0 0-14.5-4.5M4 4v3h3M4 13a8 8 0 0 0 14.5 4.5M20 20v-3h-3';
const added = (t) => T.add.filter((a) => t >= a).length;
const sentN = (t) => T.sent.filter((a) => t >= a).length;

// Signal bars at the top of the screen: hollow while offline, filling back in.
function signal(t) {
  const k = seg(t, T.online, 0.5);
  return `<div class="abs" style="left:283px;top:17px;display:flex;gap:2px;align-items:flex-end;z-index:31">${[
    5, 8, 11, 14,
  ]
    .map((h, i) => {
      const on = k > i / 4;
      return `<i style="width:3px;height:${h}px;border-radius:1px;background:${on ? INK : 'transparent'};box-shadow:inset 0 0 0 1.2px ${on ? INK : '#B9B7C8'}"></i>`;
    })
    .join('')}</div>`;
}

function chip(t) {
  const n = added(t);
  if (t < T.online)
    return `<span style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:15px;background:#fff;box-shadow:inset 0 0 0 1.5px #D9D6E8;font-size:13px;font-weight:700;color:#55556B">${ic(CLOUD_OFF, '#7B7B8F', 15)}Offline${n ? ` · ${n} waiting` : ''}</span>`;
  if (t < T.synced)
    return `<span style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:15px;background:${LAV};font-size:13px;font-weight:700;color:${ACC}"><span style="display:inline-flex;transform:rotate(${(t - T.online) * 360}deg)">${ic(SYNC, ACC, 15)}</span>Syncing · ${3 - sentN(t)} left</span>`;
  const k = eo(seg(t, T.synced, 0.3));
  return `<span style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:15px;background:${ACC};font-size:13px;font-weight:700;color:#fff;transform:scale(${0.9 + 0.1 * k})">${ic(CHECK, '#fff', 15, 2.6)}Synced</span>`;
}

function pill(t, r) {
  const at = T.sent[r.n];
  if (t < at)
    return `<span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:12px;border:1.5px dashed #C9C6DA;font-size:11px;font-weight:600;color:#7B7B8F">Waiting</span>`;
  const k = eo(seg(t, at, 0.3));
  return `<span style="display:inline-flex;align-items:center;gap:3px;height:24px;padding:0 9px;border-radius:12px;background:${POS}1A;font-size:11px;font-weight:700;color:${POS};transform:scale(${0.85 + 0.15 * k})">${ic(CHECK, POS, 12, 2.8)}Sent</span>`;
}

// Everyone else's copy of the group catches up: one avatar ticks per phone.
function others(t) {
  const k = eo(seg(t, T.synced + 1.1, 0.4));
  if (k <= 0) return '';
  const who = [
    ['Ravi', '#F59E0B'],
    ['Asha', '#10B981'],
    ['Dev', '#3B82F6'],
  ];
  return `<div class="card" style="margin-top:12px;margin-right:62px;padding:12px 14px;opacity:${k};transform:translateY(${(1 - k) * 16}px)">
    <div style="font-size:12px;font-weight:700">Same on everyone's phone</div>
    <div style="display:flex;gap:10px;margin-top:9px">${who
      .map(([n, c], i) => {
        const on = t >= T.synced + 1.5 + i * 0.35;
        return `<span style="display:flex;align-items:center;gap:6px"><span style="position:relative;width:30px;height:30px;border-radius:15px;background:${c};color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center">${n[0]}<span style="position:absolute;right:-4px;bottom:-4px;width:15px;height:15px;border-radius:8px;background:${on ? POS : '#D9D6E8'};border:2px solid #fff;display:flex;align-items:center;justify-content:center">${on ? ic(CHECK, '#fff', 9, 3.5) : ''}</span></span></span>`;
      })
      .join('')}</div></div>`;
}

function screen(t) {
  const rows = ROWS.map((r) => {
    const v = eo(seg(t, T.add[r.n] + 0.1, 0.4));
    return `<div style="height:${v * 72}px;opacity:${v};overflow:hidden"><div style="height:72px;display:flex;align-items:center;gap:11px;padding:0 12px;border-top:1px solid #EFEEF5">
      <span style="width:38px;height:38px;border-radius:12px;background:${LAV};display:flex;align-items:center;justify-content:center;flex:none;font-size:18px">${['🍲', '🪵', '☕'][r.n]}</span>
      <span style="flex:1;min-width:0"><div style="font-size:15px;font-weight:700">${r.title}</div><div class="muted" style="font-size:11.5px">You paid · 4 people</div></span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span class="num" style="font-size:15px;font-weight:800">${inr(r.amt)}</span>${pill(t, r)}</span></div></div>`;
  }).join('');
  const any = added(t) > 0;
  const bal = seg(t, T.synced + 0.2, 0.8);
  return `<div class="page">
    <div style="position:relative;height:150px;border-radius:22px;overflow:hidden;background:linear-gradient(180deg,#B9A8FF 0%,#E7E0FF 70%)">
      <svg class="abs" style="left:0;bottom:0" width="302" height="90" viewBox="0 0 302 90"><path d="M0 90L0 55 50 18 88 50 130 6 180 58 222 30 302 72 302 90Z" fill="#7A5AF8" opacity=".55"/><path d="M0 90L0 70 60 44 110 74 170 40 240 70 302 56 302 90Z" fill="#4A2FBF" opacity=".75"/><path d="M122 14l8-8 8 8-4 2-4-3-4 3z" fill="#fff" opacity=".9"/></svg>
      <div class="abs" style="left:14px;top:12px;width:30px;height:30px;border-radius:15px;background:rgba(255,255,255,.75);display:flex;align-items:center;justify-content:center;font-size:20px">‹</div>
      <div class="abs" style="left:16px;bottom:12px;color:#fff"><div style="font-size:24px;font-weight:800;letter-spacing:-.02em">Manali trip</div><div style="font-size:11px;font-weight:600;opacity:.9">4 people · INR</div></div>
    </div>
    <div style="margin-top:12px">${chip(t)}</div>
    <div class="card" style="margin-top:12px;padding:6px 0 2px;overflow:hidden">
      <div style="padding:6px 12px 8px;font-size:13px;font-weight:700">Expenses</div>
      ${any ? '' : `<div class="muted" style="padding:6px 12px 14px;font-size:12px">Nothing yet</div>`}${rows}
    </div>
    <div class="card" style="margin-top:12px;padding:14px;display:flex;align-items:center;gap:12px;background:${bal > 0 ? '#EEEAFE' : '#fff'}">
      <span style="flex:1"><div style="font-size:14px;font-weight:700">Ravi owes you</div><div class="muted" style="font-size:11px">${t >= T.synced ? 'Up to date for everyone' : 'Updates when you are online'}</div></span>
      <span class="num" style="font-size:22px;font-weight:800;color:${bal > 0 ? ACC : '#B9B7C8'}">${bal > 0 ? count(t, T.synced + 0.2, 0.8, 555) : '—'}</span>
    </div>
    ${others(t)}
    <div style="position:absolute;right:14px;top:640px;width:52px;height:52px;border-radius:26px;background:${ACC};display:flex;align-items:center;justify-content:center;color:#fff;font-size:30px;line-height:1;box-shadow:0 6px 16px rgba(122,90,248,.35)">+</div>
  </div>`;
}

function FILM(t) {
  const taps = T.add.map((a) => finger(t, a, 290, 666)).join('');
  const scr =
    screen(t) +
    signal(t) +
    `<div class="abs" style="left:0;top:0;width:330px;height:715px;zoom:1.18">${taps}</div>`;
  return (
    words(
      t,
      ['No signal', 'Saved first', 'Sent in order', 'All synced'],
      [
        [0, T.add[0]],
        [T.add[0], T.online],
        [T.online, T.synced],
        [T.synced, 99],
      ],
    ) +
    big(t, [
      [T.add[0] + 0.3, T.online, (x) => `${added(x)} waiting`],
      [T.sent[0], T.synced, (x) => `${sentN(x)} of 3 sent`],
      [T.synced + 0.3, T.synced + 1.4, (x) => count(x, T.synced + 0.2, 0.8, 555)],
      [
        T.synced + 1.5,
        99,
        (x) => {
          const n = Math.max(1, T.sent.filter((_, i) => x >= T.synced + 1.5 + i * 0.35).length);
          return `${n} friend${n > 1 ? 's' : ''}`;
        },
      ],
    ]) +
    phone(scr)
  );
}
