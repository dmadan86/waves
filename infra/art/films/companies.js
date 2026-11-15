// Companies (wide, 10s): one expense moves through the company. Ravi snaps a
// fuel receipt, Suresh approves it in a tap, the week's attendance becomes
// wages, and Anita sees the company cash. Names, screens and figures follow the
// companies hero film and website companyMock strings (en).
const DUR = 10;
const POS = '#2BD38A',
  INK = '#14142B',
  MUTED = '#7B7B8F',
  LAV = '#F1EFF8';

// A light-screen phone on the dark stage.
function phone(inner, { x = 1340, y = 540, rot = 0, s = 1, enter = 1 } = {}) {
  const e = Math.min(enter, 1.04);
  return `<div class="abs" style="left:${x - 230}px;top:${y - 470 + (1 - e) * 900}px;width:460px;height:940px;border-radius:74px;background:#15141b;padding:13px;box-shadow:0 40px 80px rgba(0,0,0,.6),inset 0 0 0 2px #3a3846;transform:rotate(${rot + (1 - e) * 12}deg) scale(${s})">
    <div style="position:relative;height:100%;border-radius:62px;overflow:hidden;background:#F3F1FB;color:${INK};padding:70px 26px 0">
      <div class="abs" style="left:34px;top:22px;font-size:18px;font-weight:800">9:41</div>${inner}</div></div>`;
}
const who = (n, role, c, at, t) => {
  const k = back(seg(t, at, 0.4));
  return `<div class="abs" style="left:120px;top:820px;display:flex;align-items:center;gap:18px;transform:translateY(${(1 - Math.min(k, 1)) * 40}px);opacity:${k > 0 ? 1 : 0}"><span style="width:64px;height:64px;border-radius:32px;background:${c};display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800">${n[0]}</span><span><div style="font-size:32px;font-weight:800">${n}</div><div style="font-size:24px;color:#9C98B8">${role}</div></span></div>`;
};
const btn = (label, on, done) =>
  `<div style="height:64px;border-radius:32px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:22px;font-weight:800;background:${done ? POS + '22' : on ? ACC : LAV};color:${done ? '#13824F' : on ? '#fff' : INK}">${done ? ic(CHECK, '#13824F', 24, 3) : ''}${label}</div>`;

// ---------- Scene A: Ravi snaps the receipt and submits (0 – 2.8)
function sceneA(t) {
  const shot = t >= 0.9;
  const amt = Math.round(2150 * eio(seg(t, 1.0, 0.6)));
  const fly = eio(seg(t, 2.25, 0.4));
  const receipt = `<div style="margin:30px auto 0;width:300px;padding:22px;background:#fff;font-family:ui-monospace,Menlo,monospace;font-size:15px;line-height:1.55;color:#333;transform:rotate(-3deg);box-shadow:0 10px 30px rgba(0,0,0,.25)">INDIAN OIL · FILLING STN<br>DATE 12/11 09:12<br>PRODUCT  HSD DIESEL<br>QTY      23.4 L<br>--------------------<br><b>TOTAL   ₹2,150.00</b></div>`;
  const camera = `<div class="abs" style="inset:0;background:#0d0c14;padding-top:90px">${receipt}<div class="abs" style="left:50%;bottom:70px;width:84px;height:84px;margin-left:-42px;border-radius:42px;border:6px solid #fff"></div><div class="abs" style="inset:0;background:#fff;opacity:${t > 0.85 && t < 1.1 ? 1 - seg(t, 0.88, 0.2) : 0}"></div></div>`;
  const form = `<div style="font-size:30px;font-weight:800">New expense</div>
    <div style="margin-top:22px;font-size:16px;font-weight:700;color:${MUTED}">Amount</div>
    <div class="h num" style="font-size:72px;margin-top:4px">${inr(amt)}</div>
    <div style="display:flex;gap:8px;margin-top:18px">${['Fuel', 'Food', 'Travel', 'Supplies'].map((c, i) => `<span style="padding:9px 16px;border-radius:20px;font-size:17px;font-weight:700;background:${i ? LAV : ACC};color:${i ? INK : '#fff'}">${c}</span>`).join('')}</div>
    <div style="margin-top:20px;padding:16px;border-radius:18px;background:#fff;font-size:19px">Diesel · Van KA-05</div>
    <div style="margin-top:12px;padding:16px;border-radius:18px;background:#fff;font-size:17px;display:flex;gap:10px;align-items:center">${ic(CHECK, '#13824F', 22, 3)}Receipt attached</div>
    <div style="margin-top:24px">${btn('Submit for approval', true, false)}</div>`;
  return (
    slab(t, 0, 640) +
    head(t, 0.1, ['Snap it.', 'Submit it.'], 120, 230, 160, ['Submit']) +
    who('Ravi Kumar', 'Driver', '#F59E0B', 0.5, t) +
    `<div style="transform:translateX(${fly * 1400}px) rotate(${fly * 14}deg)">${phone(shot ? form : camera, { enter: back(seg(t, 0, 0.6)) })}</div>` +
    press(t, 0.85, 1340, 880) +
    press(t, 2.1, 1340, 565)
  );
}

// ---------- Scene B: Suresh approves in a tap (2.8 – 5.0)
function sceneB(t) {
  const done = t >= 3.95;
  const land = back(seg(t, 2.95, 0.45));
  const row = (n, sub, a, c, i) =>
    `<div style="display:flex;align-items:center;gap:12px;padding:16px;border-radius:20px;background:#fff;margin-top:12px;transform:translateY(${(1 - Math.min(back(seg(t, 3.1 + i * 0.08, 0.4)), 1)) * 30}px)"><span style="width:44px;height:44px;border-radius:22px;background:${c};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">${n[0]}</span><span style="flex:1"><div style="font-size:19px;font-weight:800">${n}</div><div style="font-size:14px;color:${MUTED}">${sub}</div></span><span style="text-align:right"><div class="num" style="font-size:19px;font-weight:800">${inr(a)}</div><div style="font-size:13px;color:#B4600F;font-weight:700">Pending</div></span></div>`;
  const inner = `<div style="font-size:28px;font-weight:800">Waiting for approval</div><div style="font-size:15px;color:${MUTED}">Kaveri Packers · you are the manager</div>
    <div style="margin-top:18px;padding:18px;border-radius:24px;background:#fff;box-shadow:0 0 0 3px ${done ? POS : ACC};transform:translateX(${(1 - Math.min(land, 1)) * -500}px) scale(${done ? 1 + 0.04 * Math.sin(Math.PI * seg(t, 3.95, 0.3)) : 1})">
      <div style="display:flex;align-items:center;gap:12px"><span style="width:48px;height:48px;border-radius:24px;background:#F59E0B;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px">R</span><span style="flex:1"><div style="font-size:21px;font-weight:800">Fuel · Ravi</div><div style="font-size:15px;color:${MUTED}">Diesel · Van KA-05</div></span><span class="num" style="font-size:24px;font-weight:800">${inr(2150)}</span></div>
      <div style="display:flex;gap:10px;margin-top:16px"><div style="flex:1">${btn(done ? 'Approved' : 'Approve', true, done)}</div>${done ? '' : `<div style="flex:1">${btn('Reject', false, false)}</div>`}</div>
    </div>${row('Meena', 'Packing tape · Godown stock', 640, '#10B981', 0)}${row('Arjun', 'Auto fare · Client visit', 180, '#3B82F6', 1)}`;
  const stamp = done
    ? `<div class="abs h" style="left:120px;top:600px;font-size:150px;color:${POS};transform:scale(${back(seg(t, 3.95, 0.35))}) rotate(-4deg);transform-origin:0 50%">Approved.</div>`
    : '';
  return (
    slab(t, 2.8, 140, 10) +
    flood(t, 3.95, 1340, 400) +
    head(t, 2.88, ['Approve', 'in a tap.'], 120, 230, 160, ['tap.']) +
    stamp +
    who('Suresh', 'Manager', '#7A5AF8', 3.1, t) +
    phone(inner, { rot: -2 + Math.sin(t) }) +
    press(t, 3.85, 1235, 365)
  );
}

// ---------- Scene C: attendance becomes wages (5.0 – 7.1)
function sceneC(t) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const marked = days.filter((_, i) => i < 6 && t >= 5.3 + i * 0.16).length;
  const total = marked * 700;
  const rec = t >= 6.65;
  const inner = `<div style="font-size:28px;font-weight:800">This week</div><div style="font-size:15px;color:${MUTED}">Ravi Kumar · ₹700 a day</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-top:22px">${days
      .map((d, i) => {
        const on = i < marked,
          off = i === 6;
        const q = on ? back(seg(t, 5.3 + i * 0.16, 0.3)) : 1;
        return `<div style="text-align:center"><div style="font-size:14px;color:${MUTED};font-weight:700">${d}</div><div style="margin-top:6px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;background:${on ? ACC : off ? LAV : '#fff'};color:${on ? '#fff' : MUTED};transform:scale(${q})">${on ? 'P' : off ? '–' : ''}</div></div>`;
      })
      .join('')}</div>
    <div style="margin-top:28px;padding:22px;border-radius:24px;background:#fff"><div style="font-size:17px;font-weight:700;color:${MUTED}">Wages</div><div class="h num" style="font-size:76px;margin-top:4px">${inr(total)}</div><div style="font-size:16px;color:${MUTED}">${marked} days present</div></div>
    <div style="margin-top:18px">${btn(rec ? 'Recorded' : 'Record payment', true, rec)}</div>`;
  return (
    slab(t, 5.0, 700, -10) +
    head(t, 5.08, ['Attendance', 'becomes wages.'], 120, 230, 118, ['wages.']) +
    (marked
      ? `<div class="abs h num" style="left:120px;top:590px;font-size:200px;color:${ACC}">${inr(total)}</div>`
      : '') +
    phone(inner, { rot: 2 - Math.sin(t) }) +
    press(t, 6.55, 1340, 553)
  );
}

// ---------- Scene D: the owner sees the cash (7.1 – 8.8)
function sceneD(t) {
  const cash = 120000 - 2150 * eio(seg(t, 7.5, 0.7));
  const inner = `<div style="display:flex;align-items:center;gap:12px"><span style="width:44px;height:44px;border-radius:14px;background:${ACC};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">K</span><span><div style="font-size:22px;font-weight:800">Kaveri Packers</div><div style="font-size:14px;color:${MUTED}">You are the owner</div></span></div>
    <div style="margin-top:20px;padding:24px;border-radius:28px;background:${ACC};color:#fff"><div style="font-size:16px;font-weight:700;opacity:.85">Company cash</div><div class="h num" style="font-size:66px;margin-top:4px">${inr(cash)}</div><div style="font-size:15px;opacity:.85">${t > 7.5 ? 'Fuel · Ravi Kumar · −₹2,150' : 'Cash you put in the pool'}</div></div>
    <div style="display:flex;gap:12px;margin-top:14px"><div style="flex:1;padding:18px;border-radius:22px;background:#fff"><div style="font-size:14px;color:${MUTED};font-weight:700">Spent this month</div><div class="num" style="font-size:28px;font-weight:800">₹40,106</div></div><div style="flex:1;padding:18px;border-radius:22px;background:#FDF0DE"><div style="font-size:14px;color:#8A4B0F;font-weight:700">Advances</div><div class="num" style="font-size:28px;font-weight:800">₹5,000</div></div></div>
    <div style="margin-top:18px;font-size:18px;font-weight:800">Recent</div>
    ${[
      ['Fuel · Ravi Kumar', 'Approved by Suresh', 2150],
      ['Packing tape · Meena', 'Approved yesterday', 640],
    ]
      .map(([a, b, n], i) => {
        const q = back(seg(t, 7.6 + i * 0.1, 0.4));
        return `<div style="margin-top:10px;padding:14px 16px;border-radius:18px;background:#fff;display:flex;justify-content:space-between;align-items:center;transform:translateX(${(1 - Math.min(q, 1)) * 300}px)"><span><div style="font-size:17px;font-weight:800">${a}</div><div style="font-size:13px;color:${MUTED}">${b}</div></span><span class="num" style="font-size:18px;font-weight:800">−${inr(n)}</span></div>`;
      })
      .join('')}`;
  return (
    slab(t, 7.1, 380, 8) +
    head(t, 7.18, ['The owner', 'sees it all.'], 120, 230, 150, ['all.']) +
    who('Anita', 'Owner', '#10B981', 7.4, t) +
    phone(inner, { rot: -1.5, s: 1.02 })
  );
}

// ---------- Scene E: end card (8.8 – 10)
function sceneE(t) {
  const k = back(seg(t, 8.82, 0.45));
  const chips = ['Expenses', 'Approvals', 'Advances', 'Wages', 'Attendance', 'Bills', 'Tasks']
    .map((c, i) => {
      const q = back(seg(t, 9.0 + i * 0.05, 0.35));
      return `<span style="display:inline-flex;align-items:center;gap:12px;height:62px;padding:0 26px;border-radius:31px;background:#1c1a29;font-size:26px;font-weight:700;transform:translateY(${(1 - Math.min(q, 1)) * 60}px);opacity:${q > 0 ? 1 : 0}"><i style="width:12px;height:12px;border-radius:6px;background:${ACC}"></i>${c}</span>`;
    })
    .join('');
  return (
    flood(t, 8.78, 960, 540) +
    `<div class="abs" style="left:0;right:0;top:260px;display:flex;flex-direction:column;align-items:center;gap:32px">
    <div style="display:flex;align-items:center;gap:34px;transform:scale(${k})"><span style="width:120px;height:120px;border-radius:34px;background:${ACC};display:flex;align-items:center;justify-content:center;font-size:60px;font-weight:800">W</span><span class="h" style="font-size:132px">Waves <span style="color:${ACC}">for companies</span></span></div>
    <div style="display:flex;gap:14px">${chips}</div>
    <div style="font-size:30px;font-weight:700;color:#B9B5D6;opacity:${eo(seg(t, 9.3, 0.3))}">Android and web · iPhone coming soon</div></div>`
  );
}

const SCENES = [
  [0, sceneA],
  [2.8, sceneB],
  [5.0, sceneC],
  [7.1, sceneD],
  [8.8, sceneE],
];
