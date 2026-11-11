// Personal, transactions: the ledger newest first by day, narrowed by the Income
// tab, then by a search. Screen and strings follow
// apps/mobile/src/app/personal/transactions.tsx (en).
const T = { add: 0.6, income: 2.7, all: 4.75, search: 5.15, type: 5.45 };
const INC = '#16935B',
  EXP = '#C8283E',
  LAV = '#EFEDFA';
const G = {
  // category badge: tint, glyph
  transport: [
    '#CFE6FA',
    '#2875CE',
    'M5 16V9l2-4h10l2 4v7M5 16h14M7 19v-3M17 19v-3M7 12h.01M17 12h.01',
  ],
  food: ['#FBE0C4', '#B4600F', 'M6 3v8M9 3v8M6 11h3v10M16 3c-2 2-2 6 0 8v10'],
  salary: ['#C7EDE4', '#0F6B54', 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  groceries: ['#F8D7DA', '#A3243B', 'M4 5h2l2 11h10l2-8H7M10 20h.01M17 20h.01'],
  freelance: ['#DCD9FB', '#4A2FBF', 'M4 7h16v12H4zM9 7V5h6v2'],
  rent: ['#FBE0C4', '#8A4B0F', 'M4 11l8-7 8 7v9H4zM10 20v-5h4v5'],
};
const ROWS = [
  {
    day: 'Today',
    id: 'uber1',
    title: 'Uber',
    cat: 'Transport',
    g: 'transport',
    amt: 312,
    m: 'UPI',
  },
  {
    day: 'Today',
    id: 'swiggy',
    title: 'Swiggy',
    cat: 'Food & drink',
    g: 'food',
    amt: 420,
    m: 'UPI',
  },
  {
    day: 'Yesterday',
    id: 'salary',
    title: 'Salary',
    cat: 'Salary',
    g: 'salary',
    amt: 48000,
    m: 'Bank transfer',
    inc: 1,
  },
  {
    day: 'Yesterday',
    id: 'bazaar',
    title: 'Big Bazaar',
    cat: 'Groceries',
    g: 'groceries',
    amt: 1150,
    m: 'Card',
  },
  {
    day: 'Sun, 9 November',
    id: 'free',
    title: 'Logo design',
    cat: 'Freelance',
    g: 'freelance',
    amt: 6500,
    m: 'UPI',
    inc: 1,
  },
  {
    day: 'Sun, 9 November',
    id: 'uber2',
    title: 'Uber',
    cat: 'Transport',
    g: 'transport',
    amt: 245,
    m: 'UPI',
  },
  {
    day: 'Sun, 9 November',
    id: 'rent',
    title: 'Rent',
    cat: 'Rent',
    g: 'rent',
    amt: 18000,
    m: 'Bank transfer',
  },
];
const sgn = (n, inc) => (inc ? '+' : '-') + inr(n);
const ic = (d, c, s = 18, w = 2) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

// How much of each row is shown at t (0 hidden .. 1 shown): entry at the start, then the filters.
function shown(t, r, i) {
  const enter = r.id === 'uber1' ? eo(seg(t, T.add, 0.45)) : 1; // the newest entry lands on top
  const tabOut = r.inc ? 0 : seg(t, T.income + 0.1, 0.35) * (1 - seg(t, T.all + 0.05, 0.35));
  const query = 'uber'.slice(0, Math.floor(clamp((t - T.type) * 8, 0, 4)));
  const searchOut =
    query && !r.title.toLowerCase().startsWith(query) ? seg(t, T.type + 0.05, 0.3) : 0;
  return enter * (1 - eio(Math.max(tabOut, searchOut)));
}
function tab(on, label, color, d, rot) {
  return `<div style="flex:1;min-width:0;height:34px;border-radius:17px;display:flex;align-items:center;justify-content:center;gap:2px;background:${on ? ACC : '#fff'}">
    <span style="width:17px;height:17px;border-radius:9px;flex:none;display:flex;align-items:center;justify-content:center;background:${on ? 'rgba(255,255,255,.18)' : color + '18'};transform:rotate(${rot || 0}deg)">${ic(d, on ? '#fff' : color, 11, 2.8)}</span>
    <span style="font-size:10px;font-weight:${on ? 700 : 500};color:${on ? '#fff' : '#7B7B8F'};white-space:nowrap">${label}</span></div>`;
}
function screen(t) {
  const tabNow = t > T.income + 0.05 && t < T.all + 0.05 ? 'income' : 'all';
  const q =
    t > T.search ? typed(t, T.type, 'uber') : '<span class="muted">Search transactions…</span>';
  const vis = ROWS.map((r, i) => shown(t, r, i));
  let list = '',
    day = null;
  ROWS.forEach((r, i) => {
    const v = vis[i];
    if (r.day !== day) {
      day = r.day;
      const idx = ROWS.map((x, j) => j).filter((j) => ROWS[j].day === day),
        dv = Math.max(...idx.map((j) => vis[j]));
      const net = idx.reduce(
          (s, j) => s + (vis[j] > 0.5 ? (ROWS[j].inc ? 1 : -1) * ROWS[j].amt : 0),
          0,
        ),
        n = idx.filter((j) => vis[j] > 0.5).length;
      list += `<div style="height:${dv * 40}px;opacity:${dv};overflow:hidden;display:flex;align-items:flex-end;gap:8px;padding:0 4px 7px">
        <span style="flex:1;font-size:14px;font-weight:600">${day}</span>
        <span style="padding:2px 9px;border-radius:11px;background:${LAV};font-size:11px;color:#7B7B8F">${Math.max(n, 1)} transaction${n === 1 ? '' : 's'}</span>
        <span class="num" style="font-size:14px;font-weight:700;color:${net >= 0 ? INC : EXP}">${sgn(Math.abs(net), net >= 0)}</span></div>`;
    }
    const first = i === 0 || ROWS[i - 1].day !== r.day,
      last = i === ROWS.length - 1 || ROWS[i + 1].day !== r.day;
    const [bg, fg, d] = G[r.g];
    list += `<div style="height:${v * 62}px;opacity:${v};overflow:hidden"><div style="height:62px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#fff;border-top:${first ? 0 : 1}px solid #EFEEF5;border-radius:${first ? '16px 16px' : '0 0'} ${last ? '16px 16px' : '0 0'}">
      <span style="width:38px;height:38px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex:none">${ic(d, fg, 18)}</span>
      <span style="flex:1;min-width:0"><div style="font-size:15px;font-weight:600">${r.title}</div><div class="muted" style="font-size:12px">${r.cat}</div></span>
      <span style="text-align:right"><div class="num" style="font-size:15px;font-weight:700;color:${r.inc ? INC : EXP}">${sgn(r.amt, r.inc)}</div><div class="muted" style="font-size:11px">${r.m}</div></span>
      <span style="color:#C4C3D0;font-size:16px">›</span></div></div>`;
  });
  return `<div class="page">
    <div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1"><div style="font-size:26px;font-weight:800;letter-spacing:-.02em">Transactions</div><div class="muted" style="font-size:11px">All your expenses, income and transfers in one place.</div></div>
      ${ic('M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', ACC, 24)}
      <div style="width:38px;height:38px;border-radius:19px;background:${ACC};display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:500;line-height:1">+</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <div style="flex:1;height:42px;border-radius:21px;background:${LAV};display:flex;align-items:center;gap:8px;padding:0 13px;font-size:14px">${ic('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', '#7B7B8F', 16)}${q}</div>
      <div style="width:42px;height:42px;border-radius:21px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(42,30,107,.08)">${ic('M4 6h16M7 12h10M10 18h4', INK, 18)}</div>
    </div>
    <div style="display:flex;gap:4px;margin-top:10px">
      ${tab(tabNow === 'all', 'All', ACC, 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01')}
      ${tab(false, 'Expenses', EXP, 'M12 4v16M6 14l6 6 6-6', -45)}
      ${tab(tabNow === 'income', 'Income', INC, 'M12 20V4M6 10l6-6 6 6', 45)}
      ${tab(false, 'Transfers', '#2875CE', 'M4 8h14l-3-3M20 16H6l3 3')}
    </div>
    <div style="margin-top:4px">${list}</div>
  </div>`;
}

function FILM(t) {
  const taps =
    finger(t, T.income, 205, 159) + finger(t, T.all, 40, 159) + finger(t, T.search, 120, 109);
  const scr =
    screen(t) +
    `<div class="abs" style="left:0;top:0;width:330px;height:715px;zoom:1.18">${taps}</div>`;
  return (
    words(
      t,
      ['Newest first', 'By type', 'By search'],
      [
        [T.add, T.income],
        [T.income, T.all],
        [T.all, 99],
      ],
    ) +
    big(t, [
      [T.add + 0.4, T.income, () => '-' + inr(312)],
      [T.income + 0.5, T.all, () => '+' + inr(54500)],
      [T.type + 0.6, 99, () => '2 rides'],
    ]) +
    phone(scr)
  );
}
