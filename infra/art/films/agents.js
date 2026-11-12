// Works with your AI assistant (wide, 10s). Asks, tool names and replies follow the
// home page "agents" examples (website/src/i18n/dictionaries/en.json) and the MCP
// tools in apps/api. The chat window is a generic one: no assistant's brand.
const DUR = 10;
const POS = '#2BD38A';
const SEND = 'M4 12l16-8-6 16-2-6z',
  LINK =
    'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
  SHIELD = 'M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z';

// A chat window: the ask types in, the tools light up one by one, the reply lands.
function chat(t, at, { ask, tools, reply, extra = '' }, { x = 1010, y = 150, w = 800 } = {}) {
  const k = back(seg(t, at - 0.15, 0.5));
  const typedTo = Math.floor(clamp((t - at) * 34, 0, ask.length));
  const askDone = at + ask.length / 34;
  const toolHtml = tools
    .map((name, i) => {
      const on = t >= askDone + 0.15 + i * 0.2;
      const q = back(seg(t, askDone + 0.15 + i * 0.2, 0.3));
      return `<span style="display:inline-flex;align-items:center;gap:10px;height:52px;padding:0 20px;border-radius:26px;background:${on ? ACC : '#1c1a29'};color:${on ? '#fff' : '#6E6A8A'};font-family:ui-monospace,Menlo,monospace;font-size:24px;font-weight:700;transform:scale(${on ? Math.min(q, 1.08) : 0.9});opacity:${on ? 1 : 0}">${ic('M13 3L4 14h7l-1 7 9-11h-7z', on ? '#fff' : '#6E6A8A', 22)}${name}</span>`;
    })
    .join('');
  const replyAt = askDone + 0.25 + tools.length * 0.2;
  const r = eo(seg(t, replyAt, 0.4));
  return `<div class="abs" style="left:${x}px;top:${y}px;width:${w}px;transform:translateX(${(1 - Math.min(k, 1)) * 500}px) rotate(${(1 - Math.min(k, 1)) * 4}deg);opacity:${k > 0 ? 1 : 0}">
    <div style="border-radius:40px;background:#15141d;box-shadow:0 40px 80px rgba(0,0,0,.55),inset 0 0 0 2px #2a2838;padding:34px">
      <div style="display:flex;align-items:center;gap:12px;font-size:22px;font-weight:700;color:#8E8AA8"><i style="width:14px;height:14px;border-radius:7px;background:${POS}"></i>Your assistant · Waves connected</div>
      <div style="display:flex;justify-content:flex-end;margin-top:26px"><div style="max-width:620px;padding:20px 26px;border-radius:30px 30px 8px 30px;background:#fff;color:#14142B;font-size:32px;font-weight:700;line-height:1.3">${ask.slice(0, typedTo)}${typedTo < ask.length ? `<i style="display:inline-block;width:3px;height:30px;background:${ACC};vertical-align:middle;margin-left:2px"></i>` : ''}</div></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:22px;min-height:52px">${toolHtml}</div>
      <div style="margin-top:20px;opacity:${r};transform:translateY(${(1 - r) * 24}px)"><div style="font-size:32px;font-weight:700;line-height:1.35">${reply}</div>${extra}</div>
    </div></div>`;
}
const replyTime = (at, ask, n) => at + ask.length / 34 + 0.25 + n * 0.2;
const rowsHtml = (t, at, rows, max) =>
  `<div style="display:grid;gap:12px;margin-top:20px">${rows
    .map(([k, v, n], i) => {
      const g = eio(seg(t, at + 0.2 + i * 0.12, 0.6));
      return `<div style="position:relative;height:62px;border-radius:18px;background:#1c1a29;overflow:hidden"><div class="abs" style="left:0;top:0;bottom:0;width:${(g * n * 100) / max}%;background:${ACC};opacity:.55"></div><div class="abs" style="inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 22px;font-size:28px;font-weight:700"><span>${k}</span><span class="num">${inr(n * g)}</span></div></div>`;
    })
    .join('')}</div>`;

// ---------- Scene A: add an expense by asking (0 – 3.4)
const A = {
  ask: 'Add ₹2,400 cab to Goa Trip, split equally',
  tools: ['list_members', 'add_expense'],
  reply: 'Added Cab · ₹2,400 to Goa Trip, paid by you.',
};
function sceneA(t) {
  const rt = replyTime(0.45, A.ask, 2);
  const extra = rowsHtml(t, rt, [['4 people', 0, 600]], 600).replace(
    />₹[\d,]+</,
    `>₹${Math.round(600 * eio(seg(t, rt + 0.2, 0.6)))} each<`,
  );
  return (
    slab(t, 0, 640) +
    flood(t, rt, 1410, 520) +
    head(t, 0.1, ['Ask your', 'assistant.'], 120, 230, 150, ['assistant.']) +
    sub(t, rt + 0.1, 'Waves keeps the books.', 120, 560) +
    (t > rt + 0.15
      ? `<div class="abs h num" style="left:120px;top:660px;font-size:170px;transform:scale(${back(seg(t, rt + 0.15, 0.4))});transform-origin:0 50%">₹600<span style="color:${ACC}"> each</span></div>`
      : '') +
    chat(t, 0.45, { ...A, extra })
  );
}

// ---------- Scene B: who owes me (3.4 – 5.6)
const B = {
  ask: 'Who owes me in Goa Trip?',
  tools: ['get_balances'],
  reply: 'You are owed ₹2,000 in Goa Trip.',
};
function sceneB(t) {
  const rt = replyTime(3.6, B.ask, 1);
  const extra = rowsHtml(
    t,
    rt,
    [
      ['Ravi', 0, 1200],
      ['Priya', 0, 800],
    ].map(([k, , n]) => [k, 0, n]),
    1200,
  );
  return (
    slab(t, 3.4, 140, 10) +
    head(t, 3.48, ['Who owes', 'you?'], 120, 230, 150, ['you?']) +
    (t > rt
      ? `<div class="abs h num" style="left:120px;top:600px;font-size:220px;color:${ACC};transform:scale(${back(seg(t, rt, 0.4))});transform-origin:0 50%">+${count(t, rt, 0.7, 2000)}</div>`
      : '') +
    chat(t, 3.6, { ...B, extra })
  );
}
const count = (t, at, d, to) => inr(to * eo(seg(t, at, d)));

// ---------- Scene C: settle up, never moves money (5.6 – 8.2)
const C = {
  ask: 'Settle up with Arjun',
  tools: ['settlement_plan', 'record_settlement', 'payment_link'],
  reply: 'You owe Arjun ₹1,350. Recorded, and pending until Arjun confirms.',
};
function sceneC(t) {
  const rt = replyTime(5.75, C.ask, 3);
  const b = back(seg(t, rt + 0.35, 0.4));
  const extra = `<div style="margin-top:20px;display:inline-flex;align-items:center;gap:12px;height:66px;padding:0 30px;border-radius:33px;background:#fff;color:#14142B;font-size:26px;font-weight:800;transform:scale(${Math.max(0, b)})">${ic(LINK, ACC, 26)}Pay in your own UPI app</div>`;
  return (
    slab(t, 5.6, 700, -10) +
    head(t, 5.68, ['It never', 'moves money.'], 120, 230, 128, ['never']) +
    sub(t, 6.1, 'Paying stays in your bank app. You approve it there.', 120, 540) +
    chat(t, 5.75, { ...C, extra })
  );
}

// ---------- Scene D: you stay in control (8.2 – 9.2)
function sceneD(t) {
  const lines = [
    'You approve each connection with a sign-in.',
    'It sees only your own groups, as the app does.',
    'It can never move money.',
    'Disconnect whenever you like.',
  ];
  return (
    slab(t, 8.2, 380, 8) +
    head(t, 8.25, ['You stay', 'in control.'], 120, 200, 150, ['control.']) +
    `<div class="abs" style="left:930px;top:250px;display:grid;gap:22px">${lines
      .map((l, i) => {
        const q = back(seg(t, 8.35 + i * 0.08, 0.35));
        return `<div style="display:flex;align-items:center;gap:20px;font-size:34px;font-weight:700;transform:translateX(${(1 - Math.min(q, 1)) * 400}px);opacity:${q > 0 ? 1 : 0}"><span style="width:62px;height:62px;border-radius:31px;background:${ACC};display:flex;align-items:center;justify-content:center;flex:none">${ic(i ? CHECK : SHIELD, '#fff', 32, 2.6)}</span>${l}</div>`;
      })
      .join('')}</div>`
  );
}

// ---------- Scene E: end card (9.2 – 10)
function sceneE(t) {
  const k = back(seg(t, 9.22, 0.4));
  const chips = ['Claude', 'ChatGPT', 'Cursor', 'VS Code', 'Any MCP client']
    .map((c, i) => {
      const q = back(seg(t, 9.4 + i * 0.05, 0.35));
      return `<span style="display:inline-flex;align-items:center;gap:12px;height:66px;padding:0 28px;border-radius:33px;background:#1c1a29;font-size:28px;font-weight:700;transform:translateY(${(1 - Math.min(q, 1)) * 60}px);opacity:${q > 0 ? 1 : 0}"><i style="width:12px;height:12px;border-radius:6px;background:${ACC}"></i>${c}</span>`;
    })
    .join('');
  return (
    flood(t, 9.18, 960, 540) +
    `<div class="abs" style="left:0;right:0;top:280px;display:flex;flex-direction:column;align-items:center;gap:34px">
    <div style="display:flex;align-items:center;gap:34px;transform:scale(${k})"><span style="width:150px;height:150px;border-radius:42px;background:${ACC};display:flex;align-items:center;justify-content:center;font-size:75px;font-weight:800">W</span><span class="h" style="font-size:190px">Waves</span></div>
    <div style="font-size:36px;font-weight:700;color:#B9B5D6;opacity:${eo(seg(t, 9.35, 0.3))}">Works with your AI assistant, over MCP</div>
    <div style="display:flex;gap:16px">${chips}</div></div>`
  );
}

const SCENES = [
  [0, sceneA],
  [3.4, sceneB],
  [5.6, sceneC],
  [8.2, sceneD],
  [9.2, sceneE],
];
