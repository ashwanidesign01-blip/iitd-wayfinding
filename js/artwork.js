/* Step 2 – your SVG artwork drawn live on the map, positioned from your control points.
   Drawing the SVG itself (not an image of it) keeps it crisp at every zoom and keeps your fonts. */
(function () {
  const A = window.ARTWORK, SVG = window.ARTWORK_SVG, $ = s => document.querySelector(s);
  const map = window.__map;
  const NS = 'http://www.w3.org/2000/svg';

  // ---------- georeferencing: least-squares similarity fit (artwork units -> metres) ----------
  const lat0 = A.control[0].lngLat[1], lng0 = A.control[0].lngLat[0];
  const KX = 111320 * Math.cos(lat0 * Math.PI / 180), KY = 110574;
  const C = (re, im) => ({ re, im });
  const add = (a, b) => C(a.re + b.re, a.im + b.im), sub = (a, b) => C(a.re - b.re, a.im - b.im);
  const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const toEN = ([lng, lat]) => C((lng - lng0) * KX, (lat - lat0) * KY);
  const toLL = z => [lng0 + z.re / KX, lat0 + z.im / KY];
  const px = ([u, v]) => C(u, -v);
  function fit() {
    const P = A.control.map(c => px(c.svg)), G = A.control.map(c => toEN(c.lngLat)), n = P.length;
    const pc = P.reduce(add, C(0, 0)), gc = G.reduce(add, C(0, 0));
    pc.re /= n; pc.im /= n; gc.re /= n; gc.im /= n;
    let num = C(0, 0), den = 0;
    for (let i = 0; i < n; i++) {
      const dp = sub(P[i], pc), dg = sub(G[i], gc);
      num = add(num, mul(dg, C(dp.re, -dp.im))); den += dp.re * dp.re + dp.im * dp.im;
    }
    const a = C(num.re / den, num.im / den);
    return { a, b: sub(gc, mul(a, pc)), pc };
  }
  const base = fit();
  function transform() {
    const j = A.adjust, r = j.rotateDeg * Math.PI / 180, s = j.scalePct / 100;
    const a = mul(base.a, C(s * Math.cos(r), s * Math.sin(r)));
    const centre = add(mul(base.a, base.pc), base.b);
    return { a, b: add(sub(centre, mul(a, base.pc)), C(j.eastM, j.northM)) };
  }
  let T = transform();
  const svgToLngLat = pt => toLL(add(mul(T.a, px(pt)), T.b));
  function corners() { const W = A.frame.width, H = A.frame.height; return [[0, 0], [W, 0], [W, H], [0, H]].map(svgToLngLat); }
  function info() {
    const up = mul(T.a, C(0, 1));
    const resid = A.control.map(c => { const g = add(mul(T.a, px(c.svg)), T.b), e = toEN(c.lngLat); return { name: c.name, m: Math.hypot(g.re - e.re, g.im - e.im) }; });
    return { mPerUnit: Math.hypot(T.a.re, T.a.im), bearing: (Math.atan2(up.re, up.im) * 180 / Math.PI + 360) % 360,
      rms: Math.sqrt(resid.reduce((s, r) => s + r.m * r.m, 0) / resid.length), resid };
  }
  const lngLatToSvg = ll => {                                 // inverse of svgToLngLat
    const g = sub(toEN(ll), T.b), d = T.a.re * T.a.re + T.a.im * T.a.im;
    const z = C((g.re * T.a.re + g.im * T.a.im) / d, (g.im * T.a.re - g.re * T.a.im) / d);
    return [z.re, -z.im];
  };
  window.ARTWORK_API = { info, corners, svgToLngLat, lngLatToSvg, pxPerUnit: () => {
    const p = map.project(svgToLngLat([0, 0])), q = map.project(svgToLngLat([100, 0])); return Math.hypot(q.x - p.x, q.y - p.y) / 100; } };

  // ---------- the overlay: one <svg> covering the map, artwork groups inside ----------
  const overlay = document.createElementNS(NS, 'svg');
  overlay.setAttribute('class', 'artwork-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  // Footpath patterns, so accessibility is never shown by colour alone (kept light so the route stays on top)
  const fdefs = document.createElementNS(NS, 'defs');
  fdefs.innerHTML = '<pattern id="fpHatch" patternUnits="userSpaceOnUse" width="1.3" height="1.3" patternTransform="rotate(45)"><rect width="1.3" height="1.3" fill="#F6DAD7"/><rect width="0.32" height="1.3" fill="#D46A62"/></pattern>'
    + '<pattern id="fpChev" patternUnits="userSpaceOnUse" width="2" height="2"><rect width="2" height="2" fill="#F1C878"/><path d="M0.35 1.4L1 0.75L1.65 1.4" fill="none" stroke="#A8741C" stroke-width="0.18"/></pattern>';
  overlay.appendChild(fdefs);
  const root = document.createElementNS(NS, 'g');          // artwork units -> screen pixels
  overlay.appendChild(root);
  const groups = {};
  const keepUpright = {};                                   // per layer: labels and icons that stay readable
  for (const L of A.layers) {
    const g = document.createElementNS(NS, 'g');
    g.innerHTML = SVG[L.id];                                  // parsed as SVG because the parent is SVG
    g.style.display = 'none';
    root.appendChild(g); groups[L.id] = g;
    keepUpright[L.id] = {
      up: [...g.querySelectorAll('[data-up]')].map(el => { const [x, y] = el.dataset.up.split(' '); return { el, x, y, t0: el.dataset.t0 || '' }; }),
      line: [...g.querySelectorAll('[data-line]')].map(el => { const [x, y, a] = el.dataset.line.split(' ').map(Number); return { el, x, y, a, t0: el.dataset.t0 || '' }; })
    };
  }
  // Turn names, labels and icons so they always read upright, whatever way the map faces.
  // (Direction arrows and map features such as ramps and crossings turn with the map on purpose.)
  const uprightAngle = {};
  function keepReadable(id, theta) {
    if (!id || (uprightAngle[id] !== undefined && Math.abs(uprightAngle[id] - theta) < 0.05)) return;
    uprightAngle[id] = theta;
    const K = keepUpright[id];
    for (const u of K.up) u.el.setAttribute('transform', `rotate(${(-theta).toFixed(3)} ${u.x} ${u.y}) ${u.t0}`);
    for (const l of K.line) {
      const t = ((l.a + theta) % 360 + 540) % 360 - 180;     // angle the label would have on screen
      l.el.setAttribute('transform', (Math.abs(t) > 90 ? `rotate(180 ${l.x} ${l.y}) ` : '') + l.t0);
    }
  }
  window.ARTWORK_ROOT = root;                                // later steps draw routes in artwork units here
  const cc = map.getCanvasContainer();
  cc.insertBefore(overlay, cc.querySelector('canvas').nextSibling);   // above the base map, below markers
  overlay.style.opacity = A.opacity;

  let view = 'standard', orient = 'artwork', shown = null;
  function place() {
    const W = A.frame.width, H = A.frame.height;
    const o = map.project(svgToLngLat([0, 0])), x = map.project(svgToLngLat([W, 0])), y = map.project(svgToLngLat([0, H]));
    root.setAttribute('transform', `matrix(${(x.x - o.x) / W} ${(x.y - o.y) / W} ${(y.x - o.x) / H} ${(y.y - o.y) / H} ${o.x} ${o.y})`);
    const z = map.getZoom();
    const want = A.layers.find(L => L.views.includes(view) && z >= L.minzoom && z < L.maxzoom);
    const id = want ? want.id : null;
    if (id !== shown) { if (shown) groups[shown].style.display = 'none'; if (id) groups[id].style.display = ''; shown = id; }
    keepReadable(id, Math.atan2(x.y - o.y, x.x - o.x) * 180 / Math.PI);   // how far the artwork is turned on screen
  }
  map.on('move', place); map.on('rotate', place); map.on('resize', place);

  // ---------- your check points (HTML markers, so they sit above the artwork) ----------
  const checkMarkers = A.control.map(c => {
    const el = document.createElement('div'); el.className = 'check-pt';
    el.innerHTML = '<span class="dot"></span><span class="lbl"></span>'; el.querySelector('.lbl').textContent = c.name;
    return new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat(c.lngLat);
  });
  function showChecks(on) { checkMarkers.forEach(m => on ? m.addTo(map) : m.remove()); }
  showChecks($('#showChecks').checked);

  function refresh() {
    T = transform(); place();
    const i = info(), worst = i.resid.slice().sort((a, b) => b.m - a.m).slice(0, 3);
    $('#alignInfo').textContent = `Scale ${i.mPerUnit.toFixed(3)} m per SVG unit · artwork top faces ${Math.round(i.bearing)}° · ` +
      `average error ${i.rms.toFixed(0)} m (largest: ${worst.map(r => `${r.name} ${r.m.toFixed(0)} m`).join(', ')})`;
    if (orient === 'artwork') map.setBearing(i.bearing);
  }
  function fitCampus(animate) {
    const cs = corners(), lngs = cs.map(c => c[0]), lats = cs.map(c => c[1]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { bearing: orient === 'artwork' ? info().bearing : 0, padding: { top: 60, bottom: 40, left: 20, right: 20 }, animate: !!animate });
  }
  refresh(); fitCampus(false); place();

  // ---------- panel ----------
  $('#opacity').value = Math.round(A.opacity * 100);
  $('#opacity').addEventListener('input', e => { A.opacity = e.target.value / 100; overlay.style.opacity = A.opacity; });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    view = b.dataset.view; place();
    if (map.getZoom() < 16 && view !== 'standard') map.easeTo({ zoom: 16.2, duration: 500 });
  }));
  document.querySelectorAll('[data-orient]').forEach(b => b.addEventListener('click', () => {
    orient = b.dataset.orient;
    document.querySelectorAll('[data-orient]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    map.easeTo({ bearing: orient === 'artwork' ? info().bearing : 0, duration: 600 });
  }));
  $('#fitCampus').addEventListener('click', () => fitCampus(true));
  // test slider: turn the map to any direction (later this follows the phone's compass)
  const turn = $('#turn');
  turn.addEventListener('input', () => { map.setBearing(+turn.value); });
  map.on('rotate', () => { const b = Math.round(((map.getBearing() + 540) % 360) - 180); turn.value = b; $('#turnVal').textContent = b + '°'; });
  $('#showChecks').addEventListener('change', e => showChecks(e.target.checked));
  const step = { e: [1, 0], w: [-1, 0], n: [0, 1], s: [0, -1] };
  document.querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.nudge, j = A.adjust, big = $('#bigSteps').checked ? 5 : 1;
    if (step[k]) { j.eastM += step[k][0] * big; j.northM += step[k][1] * big; }
    if (k === 'rl') j.rotateDeg += 0.25 * big; if (k === 'rr') j.rotateDeg -= 0.25 * big;
    if (k === 'sm') j.scalePct -= 0.5 * big; if (k === 'sp') j.scalePct += 0.5 * big;
    if (k === 'reset') Object.assign(j, { eastM: 0, northM: 0, rotateDeg: 0, scalePct: 100 });
    $('#adjustVals').textContent = `E ${j.eastM} m · N ${j.northM} m · rotate ${j.rotateDeg.toFixed(2)}° · scale ${j.scalePct.toFixed(1)}%`;
    refresh();
  }));
  $('#copyAlign').addEventListener('click', async () => {
    const t = 'adjust: ' + JSON.stringify(A.adjust) + '\ncorners: ' + JSON.stringify(corners().map(c => c.map(v => +v.toFixed(7))));
    try { await navigator.clipboard.writeText(t); $('#msg').textContent = 'Alignment copied. Paste it into our chat.'; }
    catch (e) { $('#msg').textContent = t; }
  });
})();
