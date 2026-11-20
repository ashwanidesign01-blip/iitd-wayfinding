/* The wayfinding app: home + search, route preview, navigation (live GPS or simulated), arrival.
   Routes come from the designer's drawings (data/routes.js). Phone-first: works in Safari and Chrome on phones. */
(function () {
  const ALL = window.ROUTES, API = window.ARTWORK_API, root = window.ARTWORK_ROOT, map = window.__map;
  const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg';
  const MPU = 1.289;                                              // metres per artwork unit (Step 2 fit)
  const SPEED = { wheelchair: 0.9, pedestrian: 1.3 };             // m/s for time estimates
  const KIND = {
    smooth:   { c: '#00AEEF', label: 'Smooth footpath' },
    steep:    { c: '#EDA13A', label: 'Steep footpath' },
    road:     { c: '#ED1C24', label: 'On the road' },
    footpath: { c: '#00AEEF', label: 'Footpath' }
  };
  const START = {
    gate:    { name: 'Main Gate 1', qr: 'G-01' },
    zanskar: { name: 'Zanskar Hostel', qr: 'Z-01' }
  };
  const DEST = [
    { id: 'lhc', name: 'Lecture Hall Complex', cat: 'Academic', al: 'lhc lecture halls classrooms', ready: true },
    ...['Main Building', 'Central Library', 'Central Workshop', 'Textile Building', 'Synergy Building', 'IIT Hospital', 'SAC Complex', 'Bharti School']
      .map(n => ({ id: n, name: n, cat: 'Route not mapped yet', al: '', ready: false }))
  ];
  const S = { screen: 'home', from: 'gate', to: null, prof: 'wheelchair', R: null, pos: 0, play: false, mult: 8,
    voice: false, gps: false, watch: null, follow: true, camB: 0, off: 0, said: {}, q: '' };

  // ---------------------------------------------------------------- route building
  function buildRoute(prof, from, to) {
    const G = ALL[prof], src = G.places[from].node, dst = G.places[to].node;
    const adj = new Map(); G.edges.forEach((e, i) => [e.a, e.b].forEach(n => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(i); }));
    const dist = new Map([[src, 0]]), prev = new Map(), done = new Set(), pq = [[0, src]];
    while (pq.length) {
      let bi = 0; for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
      const [d, u] = pq.splice(bi, 1)[0]; if (done.has(u)) continue; done.add(u); if (u === dst) break;
      for (const ei of adj.get(u) || []) { const e = G.edges[ei], v = e.a === u ? e.b : e.a;
        if (d + e.len_m < (dist.get(v) ?? Infinity)) { dist.set(v, d + e.len_m); prev.set(v, [u, ei]); pq.push([d + e.len_m, v]); } }
    }
    if (!prev.has(dst)) return null;
    const legs = []; let cur = dst;
    while (cur !== src) { const [u, ei] = prev.get(cur), e = G.edges[ei]; legs.unshift({ kind: e.kind, pts: e.a === u ? e.pts : e.pts.slice().reverse() }); cur = u; }
    // one point list with distance (m) and surface
    const P = []; let s = 0;
    for (const l of legs) for (const p of l.pts) {
      if (P.length) { const q = P[P.length - 1].p, d = Math.hypot(p[0] - q[0], p[1] - q[1]) * MPU; if (d < 0.01) continue; s += d; }
      P.push({ p, s, kind: l.kind });
    }
    for (let i = 1; i < P.length; i++) P[i].kind = P[i].kind;     // segment i-1..i uses P[i].kind
    const total = s;
    const at = d => { d = Math.max(0, Math.min(total, d)); let i = 1; while (i < P.length - 1 && P[i].s < d) i++;
      const a = P[i - 1], b = P[i], t = (d - a.s) / ((b.s - a.s) || 1); return [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t]; };
    const kindAt = d => { let i = 1; while (i < P.length - 1 && P[i].s < d) i++; return P[i].kind; };
    // turns (heading change over 10 m either side)
    const hd = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
    const ang = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    const turns = [];
    for (let d = 12; d < total - 12; d += 2) {
      const t = ang(hd(at(d), at(d + 10)) - hd(at(d - 10), at(d)));
      if (Math.abs(t) > 0.7) { const last = turns[turns.length - 1];
        if (last && d - last.s < 20) { if (Math.abs(t) > Math.abs(last.t)) Object.assign(last, { s: d, t }); } else turns.push({ s: d, t }); }
    }
    // pieces between surface changes and turns
    const cuts = new Set([0, total]);
    for (let i = 2; i < P.length; i++) if (P[i].kind !== P[i - 1].kind) cuts.add(P[i - 1].s);
    const turnAt = new Map(); turns.forEach(t => { cuts.add(t.s); turnAt.set(t.s, t); });
    const B = [...cuts].sort((x, y) => x - y), raw = [];
    for (let i = 1; i < B.length; i++) raw.push({ s0: B[i - 1], s1: B[i], kind: kindAt((B[i - 1] + B[i]) / 2), turn: turnAt.get(B[i - 1]) });
    const pieces = [];
    for (const pc of raw) { const last = pieces[pieces.length - 1];
      if (last && !pc.turn && (pc.kind === last.kind || pc.s1 - pc.s0 < 3)) last.s1 = pc.s1; else pieces.push({ ...pc }); }
    const r5 = m => Math.max(5, Math.round(m / 5) * 5);
    const toPlace = ALL[prof].places[to].name, steps = to === 'lhc' && prof === 'pedestrian';
    // list for the preview, and maneuvers for navigation
    const list = [{ icon: 'start', text: `Start at ${START[from].name}` }], man = [];
    pieces.forEach((pc, i) => {
      const len = r5(pc.s1 - pc.s0), prevK = i ? pieces[i - 1].kind : null, k = pc.kind;
      const turnTxt = pc.turn && i ? `Turn ${Math.abs(pc.turn.t) > 2 ? 'sharp ' : ''}${pc.turn.t > 0 ? 'right' : 'left'}` : null;
      let icon = 'up', text, sub = '';
      if (k === 'steep') { icon = 'steep'; text = `Steep section, ${len} m`; sub = 'Go slowly; ask for help if needed'; }
      else if (k === 'road') { icon = 'road'; text = `Use the road for ${len} m`; sub = 'No accessible footpath here; keep to the edge'; }
      else if (k === 'smooth' && prevK && prevK !== 'smooth') { icon = 'smooth'; text = `Back on the footpath, ${len} m`; }
      else text = `Continue ${len} m`, sub = KIND[k].label;
      if (turnTxt) list.push({ icon: pc.turn.t > 0 ? 'right' : 'left', text: turnTxt });
      list.push({ icon, text, sub });
      if (i === 0) man.push({ s: 0, icon: 'up', text: `Head along the ${KIND[k].label.toLowerCase()}`, sub: `${len} m` });
      else if (turnTxt) man.push({ s: pc.s0, icon: pc.turn.t > 0 ? 'right' : 'left', text: turnTxt,
        sub: k === 'steep' ? 'Then a steep section – go slowly' : k === 'road' ? 'Then use the road – keep to the edge' : `Then continue ${len} m` });
      else if (k !== prevK || k !== 'smooth') man.push({ s: pc.s0, icon, text: k === 'steep' ? 'Steep section ahead' : k === 'road' ? 'Move onto the road' : 'Back onto the footpath', sub: k === 'road' ? `${len} m with no accessible footpath · keep to the edge` : k === 'steep' ? `${len} m · go slowly` : `Continue ${len} m` });
    });
    list.push({ icon: 'flag', text: `Arrive at ${toPlace}`, sub: steps ? 'This entrance has 7 steps' : prof === 'wheelchair' ? 'Ramp entrance, step-free' : '' });
    man.push({ s: total, icon: 'flag', text: `Arrive at ${DEST.find(d => d.id === to).name}`, sub: steps ? 'Main entrance – 7 steps' : 'Ramp entrance – step-free', arrive: true });
    const by = {}; for (let i = 1; i < P.length; i++) by[P[i].kind] = (by[P[i].kind] || 0) + P[i].s - P[i - 1].s;
    return { prof, from, to, P, total, at, kindAt, pieces, list, man, by, toPlace, steps,
      ll: d => API.svgToLngLat(at(d)),
      bearing: d => { const a = API.svgToLngLat(at(d - 4)), b = API.svgToLngLat(at(d + 6));
        const k = Math.cos(a[1] * Math.PI / 180); return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180 / Math.PI + 360) % 360; } };
  }

  // ---------------------------------------------------------------- drawing on the map
  const mk = (tag, a) => { const el = document.createElementNS(NS, tag); for (const k in a) el.setAttribute(k, a[k]); return el; };
  const poly = (pts, a) => mk('polyline', { points: pts.map(p => p.join(',')).join(' '), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', ...a });
  const gRoute = mk('g', { id: 'appRoute' }); root.appendChild(gRoute);
  let doneLine = null;
  function drawRoute() {
    gRoute.innerHTML = ''; doneLine = null; const R = S.R; if (!R) return;
    const pts = R.P.map(q => q.p);
    gRoute.appendChild(poly(pts, { stroke: '#fff', 'stroke-width': 13, 'stroke-opacity': .95 }));
    let run = [R.P[0].p], k = R.P[1] ? R.P[1].kind : 'smooth';
    const flush = () => { if (run.length > 1) gRoute.appendChild(poly(run, { stroke: KIND[k].c, 'stroke-width': 8 })); };
    for (let i = 1; i < R.P.length; i++) { if (R.P[i].kind !== k) { flush(); run = [R.P[i - 1].p]; k = R.P[i].kind; } run.push(R.P[i].p); }
    flush();
    doneLine = poly([pts[0]], { stroke: '#9CA3AF', 'stroke-width': 8 }); gRoute.appendChild(doneLine);
  }
  function drawDone() {
    if (!doneLine) return; const R = S.R, pts = [];
    for (const q of R.P) { if (q.s > S.pos) break; pts.push(q.p); } pts.push(R.at(S.pos));
    doneLine.setAttribute('points', pts.map(p => p.join(',')).join(' '));
  }
  // HTML markers stay upright when the map turns
  const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html || ''; return d; };
  const meEl = el('me', '<div class="cone"></div><div class="dot"></div>');
  const me = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'map' });
  const pin = new maplibregl.Marker({ element: el('pin', '<svg width="40" height="52" viewBox="-21 -50 42 52" aria-hidden="true"><path d="M0 0C-6 -12 -18 -20 -18 -32a18 18 0 1 1 36 0C18 -20 6 -12 0 0Z" fill="#ED1C24" stroke="#fff" stroke-width="4"/><circle cy="-32" r="7" fill="#fff"/></svg>'), anchor: 'bottom' });
  const startDot = new maplibregl.Marker({ element: el('startdot') });
  function placeMarkers() {
    const R = S.R;
    if (!R) { pin.remove(); me.setLngLat(startLL()).addTo(map); setRot(0, false); startDot.remove(); return; }
    pin.setLngLat(R.ll(R.total)).addTo(map);
    if (S.screen === 'arrived') { me.remove(); startDot.remove(); return; }
    me.setLngLat(R.ll(S.pos)).addTo(map); setRot(R.bearing(S.pos), true);
    if (S.screen === 'nav') startDot.setLngLat(R.ll(0)).addTo(map); else startDot.remove();
  }
  function setRot(b, cone) { meEl.classList.toggle('nocone', !cone); if (me.setRotation) me.setRotation(b); }
  const startLL = () => { const G = ALL.wheelchair; return API.svgToLngLat(G.nodes[G.places[S.from].node]); };

  // ---------------------------------------------------------------- camera
  const drawnBearing = () => API.info().bearing;
  const sheetH = () => $('#sheet').offsetHeight;
  function fitTo(lls, animate) {
    const lo = lls.map(p => p[0]), la = lls.map(p => p[1]);
    map.fitBounds([[Math.min(...lo), Math.min(...la)], [Math.max(...lo), Math.max(...la)]],
      { bearing: map.getBearing(), padding: { top: 90, bottom: sheetH() + 30, left: 40, right: 70 }, duration: animate ? 600 : 0, maxZoom: 18 });
  }
  function camHome(animate) {
    const G = ALL.wheelchair, pts = [startLL(), API.svgToLngLat(G.nodes[G.places.lhc.node])];
    fitTo(pts, animate);
  }
  function camRoute(animate) { const R = S.R; fitTo(R.P.filter((_, i) => i % 3 === 0).map(q => API.svgToLngLat(q.p)).concat([R.ll(R.total)]), animate); }
  function camNav(snap) {
    const R = S.R, b = R.bearing(S.pos);
    let d = b - S.camB; while (d > 180) d -= 360; while (d < -180) d += 360;
    S.camB = snap ? b : S.camB + d * 0.12;
    if (!S.follow) return;
    const top = $('#navcard').offsetHeight + 30;
    map.jumpTo({ center: R.ll(S.pos), bearing: S.camB, zoom: snap ? 18.2 : map.getZoom(), padding: { top, bottom: sheetH(), left: 0, right: 0 } });
  }
  const resetPadding = () => map.jumpTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } });

  // ---------------------------------------------------------------- screens
  const I = (n, c) => `<svg class="ic ${c || ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtM = m => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';
  const fmtT = (m, prof) => Math.max(1, Math.round(m / SPEED[prof] / 60)) + ' min';
  function render() {
    document.body.dataset.screen = S.screen;
    $('#sheet').className = 'sheet ' + S.screen;
    $('#navcard').hidden = S.screen !== 'nav';
    $('#recenter').hidden = !(S.screen === 'nav' && !S.follow);
    const sh = $('#sheet');
    if (S.screen === 'home') {
      sh.innerHTML = `<div class="grab"></div><h1>Where to?</h1>
        <div class="srch">${I('search')}<input id="q" type="search" placeholder="Search a building or place" aria-label="Search destinations" autocomplete="off" value="${esc(S.q)}"></div>
        <p class="here">You are at <button class="link" data-act="from">${START[S.from].name}</button> · QR ${START[S.from].qr}</p>
        <ul class="list" id="results">${results()}</ul>`;
    } else if (S.screen === 'preview') {
      const R = S.R, d = DEST.find(x => x.id === S.to), tags = [];
      if (S.prof === 'wheelchair') {
        if (R.by.steep) tags.push(`<li>${I('steep', 'sm')}Steep sections (${Math.round(R.by.steep)} m)</li>`);
        if (R.by.road) tags.push(`<li>${I('road', 'sm')}On the road for ${Math.round(R.by.road)} m</li>`);
        tags.push(`<li>${I('check', 'sm')}No steps · ramp entrance</li>`);
      } else tags.push(`<li>${I('stairs', 'sm')}Entrance has 7 steps</li>`);
      sh.innerHTML = `<div class="grab"></div>
        <div class="titlerow"><h1>${esc(d.name)}</h1><button class="x" data-act="close" aria-label="Close">${I('close')}</button></div>
        <div class="fromrow"><span>From</span><button class="pill" data-act="from">${START[S.from].name}</button></div>
        <button class="chk" role="checkbox" aria-checked="${S.prof === 'wheelchair'}" data-act="sf"><span class="box">${I('check')}</span>${I('chair')}<span>Step-free</span></button>
        <hr>
        <div class="res"><div><div class="big">${fmtT(R.total, S.prof)} · ${fmtM(R.total)}</div><ul class="tags">${tags.join('')}</ul></div>
          <button class="go" data-act="go">Go</button></div>
        <ol class="dirs">${R.list.map(s => `<li><span class="di di-${s.icon}">${I(icon(s.icon))}</span><span><b>${esc(s.text)}</b>${s.sub ? `<br><small>${esc(s.sub)}</small>` : ''}</span></li>`).join('')}</ol>`;
    } else if (S.screen === 'nav') {
      sh.innerHTML = `<div class="grab"></div>
        <div class="stats"><span class="big" id="remT"></span><span class="sm" id="remD"></span></div>
        <div class="bar" aria-hidden="true"><i id="barI"></i></div>
        <p class="gpsline" id="gpsline"></p>
        <div class="sim" id="sim" ${S.gps ? 'hidden' : ''}><span class="lbl">Simulate</span>
          <button class="mini" data-act="play" id="playB">${S.play ? 'Pause' : 'Play'}</button>
          ${[1, 4, 8].map(m => `<button class="mini" data-act="speed" data-v="${m}" aria-pressed="${S.mult === m}">${m}×</button>`).join('')}</div>
        <div class="ctl">
          <button class="go sec" data-act="gps" aria-pressed="${S.gps}">${I('target')} ${S.gps ? 'Live GPS on' : 'Use my location'}</button>
          <button class="go sec sq" data-act="voice" aria-pressed="${S.voice}" aria-label="Voice guidance ${S.voice ? 'on' : 'off'}">${I(S.voice ? 'voice' : 'mute')}</button>
          <button class="go" data-act="end">End</button></div>`;
      updateNav(true);
    } else if (S.screen === 'arrived') {
      const R = S.R;
      sh.innerHTML = `<div class="grab"></div><h1>You have arrived</h1>
        <p class="arr"><b>${esc(DEST.find(x => x.id === S.to).name)}</b><br>${R.steps ? 'Main entrance – 7 steps.' : 'Ramp entrance – step-free.'}</p>
        <div class="ctl"><button class="go sec" data-act="again">Route again</button><button class="go" data-act="done">Done</button></div>`;
    }
    placeMarkers();
  }
  const icon = n => ({ start: 'dot', up: 'up', left: 'left', right: 'right', steep: 'steep', road: 'road', smooth: 'check', flag: 'flag' }[n] || n);
  function results() {
    const q = S.q.trim().toLowerCase();
    const list = DEST.filter(d => !q ? d.ready : (d.name + ' ' + d.al).toLowerCase().includes(q));
    if (!list.length) return `<li class="empty">No place matches “${esc(S.q)}”.</li>`;
    return list.map(d => {
      if (!d.ready) return `<li><div class="item off"><span class="badge">${I('building')}</span><span><span class="nm">${esc(d.name)}</span><span class="sb">${d.cat}</span></span></div></li>`;
      const r = buildRoute(S.prof, S.from, d.id);
      return `<li><button class="item" data-act="pick" data-id="${d.id}"><span class="badge">${I('hall')}</span><span><span class="nm">${esc(d.name)}</span><span class="sb">${d.cat}</span></span>
        <span class="eta">${fmtT(r.total, S.prof)}<small>${fmtM(r.total)}</small></span></button></li>`;
    }).join('');
  }

  // ---------------------------------------------------------------- navigation
  function nextMan() { const R = S.R; return R.man.find(m => m.s > S.pos + 2) || R.man[R.man.length - 1]; }
  function updateNav(force) {
    const R = S.R, m = nextMan(), left = Math.max(0, m.s - S.pos), rem = Math.max(0, R.total - S.pos);
    const near = left < 12;
    $('#navcard').innerHTML = `<div class="big ${m.icon}">${I(icon(m.icon))}</div><div class="txt">
      <div class="in">${m.arrive && near ? 'Arriving' : near ? 'Now' : 'In ' + Math.max(5, Math.round(left / 5) * 5) + ' m'}</div>
      <h2>${esc(m.text)}</h2><p>${esc(m.sub || '')}</p><p class="on">On: ${KIND[R.kindAt(S.pos + 0.5)].label.toLowerCase()}</p></div>`;
    const t = $('#remT'); if (t) { t.textContent = fmtT(rem, S.prof) + ' left'; $('#remD').textContent = fmtM(rem) + ' to go'; $('#barI').style.width = (S.pos / R.total * 100) + '%'; }
    // voice: announce each maneuver once when it becomes next, and again when close
    const key = R.man.indexOf(m);
    if (!S.said['a' + key] && S.pos > 1) { S.said['a' + key] = 1; speak(`In ${Math.max(5, Math.round(left / 5) * 5)} metres, ${m.text}`); }
    if (near && !S.said['n' + key]) { S.said['n' + key] = 1; speak(m.arrive ? `You have arrived at ${DEST.find(x => x.id === S.to).name}` : m.text); }
    me.setLngLat(R.ll(S.pos)); setRot(R.bearing(S.pos), true); drawDone();
    if (S.pos >= R.total - 2) arrive();
  }
  function speak(t) { if (!S.voice || !window.speechSynthesis) return; try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } catch (e) {} }
  let wake = null;
  async function keepAwake(on) {
    try { if (on && navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); else if (!on && wake) { wake.release(); wake = null; } } catch (e) {}
  }
  function startNav() {
    S.screen = 'nav'; S.pos = 0; S.play = false; S.follow = true; S.said = {}; S.off = 0;
    render(); camNav(true); keepAwake(true);
    speak(S.R.man[0].text);
  }
  function stopNav(to) { gpsOff(); S.play = false; keepAwake(false); resetPadding(); S.screen = to; render(); if (to === 'preview') camRoute(true); }
  function arrive() { gpsOff(); S.play = false; keepAwake(false); resetPadding(); S.pos = S.R.total; S.screen = 'arrived'; render(); camRoute(true); }

  // ---- live GPS: snap the phone's position onto the route
  function toast(t, ms) { const b = $('#toast'); b.textContent = t; b.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => b.hidden = true, ms || 4000); }
  function gpsOn() {
    if (!navigator.geolocation) { toast('This browser has no location service. Using simulation.'); return; }
    if (!window.isSecureContext) { toast('Location needs a secure (https) address. Using simulation until the app is hosted.', 6000); return; }
    S.gps = true; S.play = false; render();
    $('#gpsline').textContent = 'Waiting for your location…';
    S.watch = navigator.geolocation.watchPosition(onFix, err => {
      gpsOff(); render();
      toast(err.code === 1 ? 'Location permission was refused. Allow it in browser settings, or keep using the simulation.' : 'Could not get your location here. Using simulation.', 6000);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  function gpsOff() { if (S.watch != null) navigator.geolocation.clearWatch(S.watch); S.watch = null; S.gps = false; }
  function onFix(p) {
    const acc = p.coords.accuracy, line = $('#gpsline');
    if (acc > 35) { if (line) line.textContent = `Weak GPS signal (±${Math.round(acc)} m) – waiting for a better fix`; return; }
    const q = API.lngLatToSvg([p.coords.longitude, p.coords.latitude]), R = S.R;
    // nearest point on the route, preferring the stretch just behind/ahead of the last position
    let best = null;
    for (let i = 1; i < R.P.length; i++) {
      const a = R.P[i - 1], b = R.P[i], dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((q[0] - a.p[0]) * dx + (q[1] - a.p[1]) * dy) / l2));
      const off = Math.hypot(q[0] - a.p[0] - t * dx, q[1] - a.p[1] - t * dy) * MPU, s = a.s + (b.s - a.s) * t;
      const score = off + (s < S.pos - 30 || s > S.pos + 120 ? 40 : 0);
      if (!best || score < best.score) best = { score, off, s };
    }
    if (best.off > 25) {
      S.off++;
      if (line) line.textContent = `You are about ${Math.round(best.off)} m from the route (±${Math.round(acc)} m)`;
      if (S.off === 3) { toast('You seem to be off the route. Head back to the coloured path.', 6000); speak('You seem to be off the route'); }
      return;
    }
    S.off = 0; S.pos = Math.max(S.pos - 5, best.s);
    if (line) line.textContent = `Live GPS · ±${Math.round(acc)} m`;
    updateNav(); camNav(false);
  }

  // ---------------------------------------------------------------- events
  function pick(id) { S.to = id; S.R = buildRoute(S.prof, S.from, id); S.screen = 'preview'; drawRoute(); render(); camRoute(true); }
  function openFrom() {
    $('#panelFrom').innerHTML = `<div class="ph2"><h2>Start from</h2><button class="x" data-act="closeFrom" aria-label="Close">${I('close')}</button></div>
      <ul class="list">${Object.entries(START).map(([k, v]) => `<li><button class="item" data-act="setFrom" data-id="${k}"><span class="badge">${I('dot')}</span><span><span class="nm">${v.name}</span><span class="sb">QR ${v.qr}</span></span></button></li>`).join('')}</ul>
      <p class="hint">Scanning the QR code at a start point sets this automatically.</p>`;
    $('#fromModal').hidden = false;
  }
  function setFrom(k) {
    S.from = k; $('#fromModal').hidden = true;
    if (S.to) { S.R = buildRoute(S.prof, S.from, S.to); drawRoute(); render(); camRoute(true); } else { render(); camHome(true); }
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]'); if (!t) { if (e.target.id === 'fromModal') $('#fromModal').hidden = true; return; }
    const a = t.dataset.act;
    if (a === 'pick') pick(t.dataset.id);
    else if (a === 'close') { S.to = null; S.R = null; drawRoute(); S.screen = 'home'; render(); camHome(true); }
    else if (a === 'from') openFrom();
    else if (a === 'closeFrom') $('#fromModal').hidden = true;
    else if (a === 'setFrom') setFrom(t.dataset.id);
    else if (a === 'sf') { S.prof = S.prof === 'wheelchair' ? 'pedestrian' : 'wheelchair'; pick(S.to); }
    else if (a === 'go') startNav();
    else if (a === 'end') stopNav('preview');
    else if (a === 'play') { S.play = !S.play; if (S.play && S.pos >= S.R.total - 2) S.pos = 0; S.follow = true; t.textContent = S.play ? 'Pause' : 'Play'; $('#recenter').hidden = true; }
    else if (a === 'speed') { S.mult = +t.dataset.v; document.querySelectorAll('[data-act=speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === S.mult))); }
    else if (a === 'gps') { if (S.gps) { gpsOff(); render(); } else gpsOn(); }
    else if (a === 'voice') { S.voice = !S.voice; render(); if (S.voice) speak('Voice guidance on'); }
    else if (a === 'recenter') { S.follow = true; t.hidden = true; camNav(true); }
    else if (a === 'again') { S.pos = 0; S.screen = 'preview'; render(); camRoute(true); }
    else if (a === 'done') { S.to = null; S.R = null; drawRoute(); S.screen = 'home'; render(); map.easeTo({ bearing: drawnBearing(), duration: 500 }); setTimeout(() => camHome(true), 520); }
    else if (a === 'layer') {
      const v = t.getAttribute('aria-pressed') === 'true' ? 'standard' : t.dataset.v;
      document.querySelectorAll('[data-act=layer]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      const btn = document.querySelector(`[data-view="${v}"]`); if (btn) btn.click();
    }
    else if (a === 'settings') { const p = $('#panel'); p.hidden = !p.hidden; }
  });
  document.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; $('#results').innerHTML = results(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'q') { const b = document.querySelector('#results button.item'); if (b) b.click(); } });
  // stop following when the person pans the map during navigation
  map.on('dragstart', () => { if (S.screen === 'nav') { S.follow = false; $('#recenter').hidden = false; } });

  // simulated walking
  let lastT = 0;
  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    if (S.screen === 'nav' && !S.gps) {
      if (S.play) { S.pos = Math.min(S.R.total, S.pos + dt * SPEED[S.prof] * S.mult); updateNav(); }
      if (S.screen === 'nav') camNav(false);
    }
    requestAnimationFrame(frame);
  }

  // QR start points: a printed QR opens the app address ending in #qr-gate or #qr-zanskar
  function fromHash() { const k = location.hash.replace('#qr-', ''); if (START[k]) { S.from = k; return true; } return false; }
  window.addEventListener('hashchange', () => { if (fromHash()) { if (S.screen === 'nav') stopNav('home'); S.to = null; S.R = null; drawRoute(); S.screen = 'home'; render(); camHome(true); } });
  fromHash();
  render();
  setTimeout(() => camHome(false), 50);
  requestAnimationFrame(frame);
  window.__app = { S, buildRoute, pick, startNav, updateNav, camNav };
})();
