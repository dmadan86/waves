// Watch and widgets (wide, 10s). Screens follow website/src/components/wearables-band.tsx,
// drawn from apps/mobile/targets/watch/Views.swift and targets/widgets (en). Wear OS is
// not shown: it is not released.
const DUR = 10;
// The watch: case, crown with ridges that turn, and a black screen.
function watch(inner, { x = 1340, y = 540, s = 1, ry = 0, rx = 0, crown = 0, crownHot = 0 } = {}) {
  return `<div class="abs" style="left:${x - 200}px;top:${y - 245}px;width:400px;height:490px;transform:perspective(1600px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${s});transform-style:preserve-3d">
    <div class="abs" style="left:386px;top:120px;width:34px;height:82px;border-radius:12px;background:repeating-linear-gradient(180deg,#4a4756 0 5px,#2b2934 5px 10px);background-position:0 ${crown}px;box-shadow:0 0 0 ${crownHot * 4}px ${ACC}"></div>
    <div class="abs" style="left:392px;top:236px;width:16px;height:70px;border-radius:8px;background:#2b2934"></div>
    <div class="abs" style="inset:0;border-radius:110px;background:linear-gradient(150deg,#3a3846,#15141b 60%);box-shadow:0 40px 80px rgba(0,0,0,.6), inset 0 0 0 2px #4a4756"></div>
    <div class="abs" style="left:22px;top:22px;right:22px;bottom:22px;border-radius:90px;background:#000;overflow:hidden;padding:44px 34px 30px">${inner}</div>
  </div>`;
}

// ---------- Scene A: say it to your wrist (0 – 3.6)
function sceneA(t) {
  const k = back(seg(t, 0.05, 0.7));
  let inner;
  if (t < 1.4)
    inner = `<div style="font-size:34px;font-weight:700;color:${ACC}">Waves</div><div style="display:grid;gap:10px;margin-top:14px">
      <div class="row">${ic(MIC, ACC, 28)}Speak</div><div class="row">${ic(PLUS, ACC, 28)}Quick add</div><div class="row">${ic(CLOCK, ACC, 28)}Recent</div></div>`;
  else if (t < 2.6) {
    const ph = t - 1.4,
      said = 'Auto 120'.slice(0, Math.floor(clamp((t - 1.7) * 9, 0, 8)));
    const rings = [0, 0.33, 0.66]
      .map((o) => {
        const p = (ph + o) % 1;
        return `<div class="abs" style="left:50%;top:150px;width:${110 + p * 200}px;height:${110 + p * 200}px;transform:translate(-50%,-50%);border-radius:50%;border:3px solid ${ACC};opacity:${1 - p}"></div>`;
      })
      .join('');
    inner = `<div style="position:relative;height:100%">${rings}<div class="abs" style="left:50%;top:150px;width:110px;height:110px;transform:translate(-50%,-50%) scale(${1 + 0.06 * Math.sin(ph * 14)});border-radius:55px;background:${ACC};display:flex;align-items:center;justify-content:center">${ic(MIC, '#fff', 54)}</div>
      <div class="abs" style="left:0;right:0;top:250px;text-align:center;font-size:22px;color:#8E8AA8">Listening…</div>
      <div class="abs num" style="left:0;right:0;top:290px;text-align:center;font-size:44px;font-weight:800">${said}</div></div>`;
  } else {
    const d = seg(t, 2.6, 0.35);
    inner = `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center">
      <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${ACC}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="transform:scale(${back(d)})"><path d="${CHECK}" stroke-dasharray="24" stroke-dashoffset="${24 * (1 - d)}"/></svg>
      <div style="font-size:30px;font-weight:700">Added ₹120 · Auto</div>
      <div style="padding:10px 30px;border-radius:30px;background:#2a2a30;font-size:24px;font-weight:700">Done</div></div>`;
  }
  const quote =
    t > 1.6
      ? `<div class="abs h" style="left:120px;top:640px;font-size:120px;color:${ACC};transform:scale(${back(seg(t, 1.6, 0.35))});transform-origin:0 50%">“${'Auto 120'.slice(0, Math.floor(clamp((t - 1.7) * 9, 0, 8)))}”</div>`
      : '';
  const big =
    t > 2.6
      ? `<div class="abs h num" style="left:120px;top:640px;font-size:170px;color:#fff;transform:scale(${back(seg(t, 2.6, 0.4))});transform-origin:0 50%">+${inr(120)}</div>`
      : quote;
  return (
    slab(t, 0, 620) +
    flood(t, 2.6, 1340, 540) +
    head(t, 0.15, ['Say it', 'to your wrist.'], 120, 200, 150, ['wrist.']) +
    big +
    watch(inner, {
      ry: (1 - Math.min(k, 1.05)) * -50 - 8 * Math.sin(t * 0.8),
      rx: 4,
      s: 0.8 + 0.35 * k,
    }) +
    press(t, 1.3, 1335, 440)
  );
}

// ---------- Scene B: dial it in (3.6 – 5.3)
function odo(v) {
  // rolling digits: the ones roll freely, higher columns step with a carry roll
  return [100, 10, 1]
    .map((pow) => {
      const p =
        pow === 1 ? v % 10 : (Math.floor(v / pow) + clamp((v % pow) - (pow - 1), 0, 1)) % 10;
      return `<span style="display:inline-block;height:1em;line-height:1em;overflow:hidden;vertical-align:top"><span style="display:block;transform:translateY(${-p}em)">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => `<span style="display:block;height:1em;line-height:1em">${n}</span>`).join('')}</span></span>`;
    })
    .join('');
}
function sceneB(t) {
  const v = 450 * eio(seg(t, 3.85, 0.85)),
    done = t >= 4.95;
  const inner = `<div style="font-size:30px;font-weight:700;color:${ACC}">Quick add</div>
    <div class="h num" style="margin-top:34px;font-size:110px;line-height:1em;height:1em;text-align:center">₹${odo(v)}</div>
    <div style="margin-top:14px;text-align:center;font-size:20px;color:#8E8AA8">Turn the crown</div>
    <div style="margin-top:28px;height:70px;border-radius:35px;background:${done ? '#1f1f24' : ACC};display:flex;align-items:center;justify-content:center;gap:8px;font-size:28px;font-weight:800;color:${done ? ACC : '#fff'}">${done ? ic(CHECK, ACC, 30, 3) + 'Added' : 'Add'}</div>`;
  const hot = t > 3.75 && t < 4.75 ? 1 : 0;
  return (
    slab(t, 3.6, 120, 10) +
    flood(t, 4.95, 1340, 540) +
    head(t, 3.68, ['Dial it in.'], 120, 240, 150, ['in.']) +
    sub(t, 3.95, 'Turn the Digital Crown to the amount, tap Add.', 120, 420) +
    `<div class="abs h num" style="left:120px;top:600px;font-size:220px;line-height:1em;color:${ACC}">₹${odo(v)}</div>` +
    watch(inner, {
      ry: -14 + 6 * Math.sin(t * 1.3),
      rx: 3,
      s: 1.08,
      crown: -v * 1.2,
      crownHot: hot,
    }) +
    press(t, 4.85, 1340, 657)
  );
}

// ---------- Scene C: see what you just added (5.3 – 6.6)
function sceneC(t) {
  const rows = [
    ['Dinner', 600, 'Goa Trip · 2h ago'],
    ['Cab', 350, 'Goa Trip · 1d ago'],
    ['Chai', 40, 'Flat 4B · 2d ago'],
  ];
  const inner =
    `<div style="font-size:32px;font-weight:700;color:${ACC}">Recent</div>` +
    rows
      .map(([n, a, s], i) => {
        const k = back(seg(t, 5.5 + i * 0.12, 0.4));
        return `<div style="margin-top:14px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.12);transform:translateX(${(1 - Math.min(k, 1)) * 320}px)"><div style="display:flex;justify-content:space-between;font-size:30px;font-weight:700"><span>${n}</span><span class="num" style="font-weight:800">${inr(a)}</span></div><div style="font-size:19px;color:#8E8AA8">${s}</div></div>`;
      })
      .join('');
  return (
    slab(t, 5.3, 700, -8) +
    head(t, 5.38, ['See it all,', 'right there.'], 120, 300, 150, ['all,']) +
    watch(inner, { ry: 12 - 6 * seg(t, 5.3, 1.3), rx: -2, s: 1.15 })
  );
}

// ---------- Scene D: home screen widgets (6.6 – 9.0)
const W = (h, body, at, t) => {
  const k = back(seg(t, at, 0.5));
  return `<div style="margin-top:14px;border-radius:30px;background:#fff;color:#14142B;padding:16px;height:${h}px;transform:translateY(${(1 - Math.min(k, 1)) * -260}px) scale(${0.85 + 0.15 * Math.min(k, 1.03)});opacity:${k > 0 ? 1 : 0}">${body}</div>`;
};
const logo = (s = 46) =>
  `<span style="width:${s}px;height:${s}px;border-radius:${s * 0.28}px;background:${ACC};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${s * 0.5}px;font-weight:800;flex:none">W</span>`;
const rb = (d) =>
  `<span style="width:48px;height:48px;border-radius:24px;background:#EEEAFE;display:flex;align-items:center;justify-content:center">${ic(d, ACC, 24)}</span>`;
function sceneD(t) {
  const foodOn = t >= 7.95;
  const cat = (d, l, c, on) =>
    `<span style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px;height:46px;border-radius:23px;background:${on ? ACC : '#F1EFF8'};color:${on ? '#fff' : c};font-size:18px;font-weight:700">${ic(d, on ? '#fff' : c, 20)}<span style="color:${on ? '#fff' : '#14142B'}">${l}</span></span>`;
  const tile = (d, l, s) =>
    `<span style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:12px 4px;border-radius:22px;background:#F1EFF8">${ic(d, ACC, 26)}<span style="font-size:17px;font-weight:700">${l}</span><span style="font-size:12px;color:#7B7B8F">${s}</span></span>`;
  const widgets =
    W(
      84,
      `<div style="display:flex;align-items:center;gap:12px;height:100%">${logo()}<span style="flex:1"><div style="font-size:21px;font-weight:800">Add expense</div><div style="font-size:15px;color:#7B7B8F">Tap to add quickly</div></span>${rb(CAMERA)}${rb(MIC)}${rb(PEN)}</div>`,
      6.85,
      t,
    ) +
    W(
      150,
      `<div style="display:flex;align-items:center;gap:10px;background:#F3F1FB;border-radius:30px;padding:5px 14px 5px 6px">${logo(40)}<span style="flex:1;font-size:18px;color:#55556B">What did you spend on?</span>${ic(MIC, '#14142B', 24)}</div><div style="display:flex;gap:8px;margin-top:14px">${cat(FOOD, 'Food', '#b8690f', foodOn)}${cat(CAR, 'Travel', '#1d68a3')}${cat(BAG, 'Shopping', '#964450')}<span style="width:46px;height:46px;border-radius:23px;background:#F1EFF8;display:flex;align-items:center;justify-content:center;font-weight:800">…</span></div>`,
      7.0,
      t,
    ) +
    W(
      210,
      `<div style="display:flex;align-items:center;gap:12px">${logo()}<span style="flex:1"><div style="font-size:21px;font-weight:800">Waves</div><div style="font-size:15px;color:#7B7B8F">Capture expenses, anywhere</div></span></div><div style="display:flex;gap:8px;margin-top:14px">${tile(CAMERA, 'Photo', 'Add with photo')}${tile(MIC, 'Voice', 'Say it out loud')}${tile(SCAN, 'Scan', 'Scan receipt')}${tile(PEN, 'Manual', 'Type it')}</div>`,
      7.15,
      t,
    );
  const icons = Array.from(
    { length: 8 },
    (_, i) =>
      `<span style="width:82px;height:82px;border-radius:22px;background:rgba(255,255,255,${0.1 + (i % 3) * 0.05})"></span>`,
  ).join('');
  const sh = eo(seg(t, 8.15, 0.45));
  const sheet =
    sh > 0
      ? `<div class="abs" style="left:0;right:0;bottom:0;height:520px;transform:translateY(${(1 - sh) * 540}px);background:#fff;color:#14142B;border-radius:40px 40px 0 0;padding:26px 28px">
      <div style="width:60px;height:6px;border-radius:3px;background:#DDD;margin:0 auto"></div>
      <div style="margin-top:22px;font-size:30px;font-weight:800">Add expense</div>
      <div style="margin-top:18px;display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:24px;background:${ACC};color:#fff;font-size:20px;font-weight:700">${ic(FOOD, '#fff', 22)}Food</div>
      <div class="h num" style="margin-top:28px;font-size:92px">₹<span style="display:inline-block;width:5px;height:76px;background:${ACC};vertical-align:middle;opacity:${Math.floor(t * 3) % 2 ? 1 : 0.2}"></span></div></div>`
      : '';
  const k = back(seg(t, 6.62, 0.55));
  const ph = `<div class="abs" style="left:${1360 - 250}px;top:${70 + (1 - Math.min(k, 1)) * 900}px;width:500px;height:1040px;border-radius:80px;background:#15141b;padding:14px;box-shadow:0 40px 80px rgba(0,0,0,.6),inset 0 0 0 2px #3a3846;transform:rotate(${(1 - Math.min(k, 1)) * 10 + 3 * Math.sin(t)}deg)">
    <div style="position:relative;height:100%;border-radius:66px;overflow:hidden;background:linear-gradient(160deg,#2B1F6B,#5B3FD6 55%,#9D86FF);padding:70px 20px 0">
      <div style="text-align:center;font-family:OG;font-weight:700;font-size:84px;letter-spacing:-.03em">9:41</div>${widgets}
      <div style="display:grid;grid-template-columns:repeat(4,82px);justify-content:space-between;gap:24px;margin-top:26px;padding:0 12px">${icons}</div>${sheet}</div></div>`;
  return (
    slab(t, 6.6, 300, 12) +
    head(t, 6.7, ['On your', 'home screen.'], 120, 220, 150, ['home', 'screen.']) +
    sub(t, 7.6, 'Tap Food. Quick add opens with Food already chosen.', 120, 560) +
    ph +
    press(t, 7.85, 1185, 505)
  );
}

// ---------- Scene E: end card (9.0 – 10)
function sceneE(t) {
  const k = back(seg(t, 9.02, 0.45));
  const chips = ['Apple Watch', 'iPhone widgets', 'Android widgets']
    .map((c, i) => {
      const q = back(seg(t, 9.25 + i * 0.07, 0.4));
      return `<span style="display:inline-flex;align-items:center;gap:12px;height:66px;padding:0 28px;border-radius:33px;background:#1c1a29;font-size:28px;font-weight:700;transform:translateY(${(1 - Math.min(q, 1)) * 60}px);opacity:${q > 0 ? 1 : 0}"><i style="width:12px;height:12px;border-radius:6px;background:${ACC}"></i>${c}</span>`;
    })
    .join('');
  return (
    flood(t, 8.98, 960, 540) +
    `<div class="abs" style="left:0;right:0;top:300px;display:flex;flex-direction:column;align-items:center;gap:30px">
    <div style="display:flex;align-items:center;gap:34px;transform:scale(${k})">${logo(150)}<span class="h" style="font-size:190px">Waves</span></div>
    <div style="display:flex;gap:16px">${chips}</div></div>`
  );
}

const SCENES = [
  [0, sceneA],
  [3.6, sceneB],
  [5.3, sceneC],
  [6.6, sceneD],
  [9.0, sceneE],
];
