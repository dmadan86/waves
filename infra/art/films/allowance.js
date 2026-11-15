// Companies, allowance: an employee adds bata by days, then fuel by km, and the
// statement takes the advance off. Screens and strings follow
// apps/mobile/src/app/group/[id]/company-entry.tsx and CompanyStatementView.tsx (en).
const RATE = 700,
  DAYS = 6,
  KM = 42,
  PER_KM = 9,
  ADV = 2000;
const BATA = RATE * DAYS,
  FUEL = KM * PER_KM,
  OWED = BATA + FUEL - ADV;
const T = { bata: 0.6, days: 0.95, spent: 2.7, fuel: 3.2, km: 3.7, dist: 4.0, save: 5.3 };

const icon = (d, c) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const DOC = '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  CAL = '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>';
function tile(on, ic, title, sub) {
  return `<div style="flex:1;border-radius:16px;padding:12px;background:${on ? '#EEEAFE' : '#F7F6FC'};border:2px solid ${on ? ACC : 'transparent'}">
    <div style="width:34px;height:34px;border-radius:50%;background:${on ? ACC : '#E9E4FF'};display:flex;align-items:center;justify-content:center">${icon(ic, on ? '#fff' : ACC)}</div>
    <div style="margin-top:8px;font-size:14px;font-weight:800;line-height:1.2">${title}</div><div class="muted" style="font-size:11px;font-weight:500;margin-top:2px">${sub}</div></div>`;
}
const field = (label, val, big) =>
  `<div class="lbl" style="margin-top:12px">${label}</div><div style="margin-top:6px;border-bottom:1.5px solid #E4E2EE;padding-bottom:6px;font-size:${big ? 22 : 17}px;font-weight:700;min-height:${big ? 36 : 30}px" class="num">${val}</div>`;
const framed = (val) =>
  `<div style="margin-top:6px;border:1.5px solid #E4E2EE;border-radius:12px;padding:8px 12px;font-size:17px;font-weight:700" class="num">${val}</div>`;
const chip = (on, s) =>
  `<span style="display:inline-block;padding:7px 13px;border-radius:99px;font-size:13px;font-weight:700;margin:0 6px 6px 0;background:${on ? ACC : '#F1EFF8'};color:${on ? '#fff' : INK}">${s}</span>`;

function entryScreen(t) {
  const bata = t > T.bata && t < T.spent;
  const pressSave = t > T.save && t < T.save + 0.3 ? 0.94 : 1;
  let form;
  if (bata) {
    form =
      field('Days', typed(t, T.days, String(DAYS)), true) +
      `<div class="lbl" style="margin-top:12px">Daily rate</div>${framed(inr(RATE))}` +
      `<div style="margin-top:14px;font-size:16px;font-weight:800" class="num">Total: ${count(t, T.days + 0.3, 0.6, BATA)}</div>`;
  } else {
    const fuelOn = t > T.fuel && t > T.spent,
      km = t > T.km;
    form =
      `<div style="display:flex;justify-content:space-between"><span class="lbl">Category</span><span style="font-size:12px;font-weight:700;color:${ACC}">View all ›</span></div>
      <div style="margin-top:8px">${['Fuel', 'Travel', 'Food', 'Stay', 'Materials', 'Repairs'].map((c, i) => chip(i === 0 && fuelOn, c)).join('')}</div>` +
      (fuelOn
        ? `<div style="margin-top:2px;opacity:${eo(seg(t, T.fuel, 0.3))}">${chip(!km, 'Amount')}${chip(km, 'Mileage')}</div>`
        : '') +
      (km
        ? `<div style="opacity:${eo(seg(t, T.km, 0.3))}">${field('Distance (km)', typed(t, T.dist, String(KM)), true)}<div class="lbl" style="margin-top:10px">Rate per km</div>${framed(inr(PER_KM))}
        <div style="margin-top:12px;font-size:16px;font-weight:800" class="num">Total: ${count(t, T.dist + 0.3, 0.5, FUEL)}</div></div>`
        : field('Amount', '', true));
  }
  return `<div class="page">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:36px;height:36px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800">‹</div>
      <div style="flex:1"><div style="font-size:24px;font-weight:800;letter-spacing:-.02em">Add entry</div><div class="muted" style="font-size:12px;font-weight:500">Sharma Builders</div></div>
      <div style="height:36px;padding:0 18px;border-radius:12px;background:${ACC};color:#fff;font-weight:700;font-size:15px;display:flex;align-items:center;transform:scale(${pressSave})">Save</div>
    </div>
    <div class="card" style="margin-top:16px;padding:10px;display:flex;gap:8px">${tile(!bata, DOC, 'I spent', 'Record expense')}${tile(bata, CAL, 'Bata (daily allowance)', 'Daily allowance')}</div>
    <div class="card" style="margin-top:12px;padding:6px 16px 16px">${form}</div>
    <div class="card" style="margin-top:12px;padding:12px 16px">
      <div class="lbl">Date</div><div style="margin-top:6px;font-size:15px;font-weight:700">Today, 11 Nov 2026</div>
      <div class="lbl" style="margin-top:12px">Paid by</div><div style="margin-top:6px;font-size:15px;font-weight:700">Ravi Kumar</div>
      <div class="lbl" style="margin-top:12px">Notes (optional)</div><div class="muted" style="margin-top:6px;font-size:14px;font-weight:500;display:flex;justify-content:space-between">Note (optional)<span style="color:${ACC};font-weight:800">＋ Photo</span></div>
    </div>
  </div>`;
}

function row(t, at, title, sub, amt, neg) {
  const k = eo(seg(t, at, 0.35));
  return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #EFEEF5;opacity:${k};transform:translateY(${(1 - k) * 14}px)">
    <div style="flex:1"><div style="font-size:15px;font-weight:700">${title}</div><div class="muted" style="font-size:12px;font-weight:500">${sub}</div></div>
    <div class="num" style="font-size:15px;font-weight:800;color:${neg ? '#C8283E' : INK}">${neg ? '− ' : ''}${inr(amt)}</div></div>`;
}
function statementScreen(t) {
  const s = T.save + 0.45;
  return `<div class="page">
    <div style="font-size:24px;font-weight:800;letter-spacing:-.02em">My statement</div><div class="muted" style="font-size:12px;font-weight:500">Sharma Builders</div>
    <div style="margin-top:14px">${chip(true, 'This month')}${chip(false, 'Last month')}${chip(false, 'All time')}</div>
    <div class="card" style="margin-top:8px;padding:18px 18px 8px">
      <div class="lbl">Balance</div>
      <div class="num" style="font-size:38px;font-weight:800;letter-spacing:-.02em;color:${ACC};margin-top:2px">${inr(BATA + FUEL - ADV * eo(seg(t, s + 0.65, 0.5)))}</div>
      <div class="muted" style="font-size:13px;font-weight:600;margin-bottom:8px">Company owes you</div>
      ${row(t, s + 0.05, 'Bata', `${DAYS} days × ${inr(RATE)}`, BATA)}
      ${row(t, s + 0.2, 'Expenses', `Fuel · ${KM} km × ${inr(PER_KM)}`, FUEL)}
      ${row(t, s + 0.4, 'Advances', 'Taken on 3 Nov', ADV, true)}
    </div>
    <div style="margin-top:14px;height:46px;border-radius:14px;background:#fff;border:1.5px solid #E4E2EE;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800">Send on WhatsApp</div>
  </div>`;
}

function FILM(t) {
  const k = eio(seg(t, T.save + 0.25, 0.45)),
    entry = k < 1 ? entryScreen(t) : '',
    st = k > 0 ? statementScreen(t) : '';
  const taps =
    finger(t, T.bata, 237, 190) +
    finger(t, T.spent, 91, 190) +
    finger(t, T.fuel, 56, 306) +
    finger(t, T.km, 150, 380) +
    finger(t, T.save, 279, 72);
  const scr = `<div class="abs" style="inset:0;transform:translateX(${-k * 390}px)">${entry}</div><div class="abs" style="inset:0;transform:translateX(${(1 - k) * 390}px)">${st}</div><div class="abs" style="left:0;top:0;width:330px;height:715px;zoom:1.18">${taps}</div>`;
  return (
    words(
      t,
      ['Days × rate', 'Km × rate', '− Advance', '= Owed'],
      [
        [0.3, T.spent],
        [T.spent, T.save],
        [T.save, 6.45],
        [6.45, 99],
      ],
    ) +
    big(t, [
      [1.5, T.spent, () => inr(BATA)],
      [4.4, T.save, () => inr(FUEL)],
      [6.15, 6.45, () => '− ' + inr(ADV)],
      [6.45, 99, () => inr(OWED)],
    ]) +
    phone(scr)
  );
}
