/* The wayfinding app: home + search, route preview, navigation (live GPS, or a walk preview), arrival.
   Routes come from the designer's drawings (data/routes.js). Phone-first: Safari and Chrome on phones.
   UX: one main action per screen, map always visible, compass + map key top right, layers + recentre on the
   right edge, accessibility information before time, patterns as well as colours, screen-reader friendly. */
(function () {
  const ALL = window.ROUTES, API = window.ARTWORK_API, root = window.ARTWORK_ROOT, map = window.__map;
  const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg';
  const MPU = 1.289;                                              // metres per artwork unit (Step 2 fit)
  const SPEED = { wheelchair: 0.9, pedestrian: 1.3 };             // m/s for time estimates
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KIND = {
    smooth:   { c: '#00AEEF', label: 'Smooth footpath' },
    steep:    { c: '#EDA13A', label: 'Steep footpath' },
    road:     { c: '#ED1C24', label: 'On the road' },
    footpath: { c: '#00AEEF', label: 'Footpath' }
  };
  const START = { gate: { name: 'Main Gate 1', qr: 'G-01' }, zanskar: { name: 'Zanskar Hostel', qr: 'Z-01' } };
  const DEST = [
    { id: 'lhc', name: 'Lecture Hall Complex', cat: 'Academic', al: 'lhc lecture halls classrooms', ready: true },
    { id: 'Main Building', cat: 'Offices' }, { id: 'Central Library', cat: 'Academic' }, { id: 'Central Workshop', cat: 'Academic' },
    { id: 'Textile Building', cat: 'Academic' }, { id: 'Synergy Building', cat: 'Academic' }, { id: 'Bharti School', cat: 'Academic' },
    { id: 'IIT Hospital', cat: 'Medical' }, { id: 'Zanskar Hostel', cat: 'Hostels' }, { id: 'SAC Complex', cat: 'Sports & culture' }
  ].map(d => ({ name: d.name || d.id, al: '', ready: false, ...d }));
  const CATS = ['All', ...new Set(DEST.map(d => d.cat))];
  const store = { get(k, d) { try { const v = localStorage.getItem('iitd.' + k); return v == null ? d : v; } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem('iitd.' + k, v); } catch (e) {} } };
  const S = { screen: 'home', from: 'gate', to: null, prof: store.get('prof', 'wheelchair'), R: null, pos: 0, play: false, mult: 8,
    voice: store.get('voice', '0') === '1', gps: false, watch: null, follow: true, camB: 0, off: 0, raw: null, said: {}, q: '', cat: 'All',
    allSteps: false, homeOpen: false, view: 'standard', orient: 'drawn', navNorth: false, preview: false,
    test: store.get('test', '0') === '1' };

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
    const P = []; let s = 0;
    for (const l of legs) for (const p of l.pts) {
      if (P.length) { const q = P[P.length - 1].p, d = Math.hypot(p[0] - q[0], p[1] - q[1]) * MPU; if (d < 0.01) continue; s += d; }
      P.push({ p, s, kind: l.kind });
    }
    const total = s;
    const at = d => { d = Math.max(0, Math.min(total, d)); let i = 1; while (i < P.length - 1 && P[i].s < d) i++;
      const a = P[i - 1], b = P[i], t = (d - a.s) / ((b.s - a.s) || 1); return [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t]; };
    const kindAt = d => { let i = 1; while (i < P.length - 1 && P[i].s < d) i++; return P[i].kind; };
    const hd = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
    const ang = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    const turns = [];
    for (let d = 12; d < total - 12; d += 2) {
      const t = ang(hd(at(d), at(d + 10)) - hd(at(d - 10), at(d)));
      if (Math.abs(t) > 0.7) { const last = turns[turns.length - 1];
        if (last && d - last.s < 20) { if (Math.abs(t) > Math.abs(last.t)) Object.assign(last, { s: d, t }); } else turns.push({ s: d, t }); }
    }
    const cuts = new Set([0, total]);
    for (let i = 2; i < P.length; i++) if (P[i].kind !== P[i - 1].kind) cuts.add(P[i - 1].s);
    const turnAt = new Map(); turns.forEach(t => { cuts.add(t.s); turnAt.set(t.s, t); });
    const B = [...cuts].sort((x, y) => x - y), raw = [];
    for (let i = 1; i < B.length; i++) raw.push({ s0: B[i - 1], s1: B[i], kind: kindAt((B[i - 1] + B[i]) / 2), turn: turnAt.get(B[i - 1]) });
    const pieces = [];
    for (const pc of raw) { const last = pieces[pieces.length - 1];
      if (last && !pc.turn && (pc.kind === last.kind || pc.s1 - pc.s0 < 3)) last.s1 = pc.s1; else pieces.push({ ...pc }); }
    const r5 = m => Math.max(5, Math.round(m / 5) * 5);
    const steps = to === 'lhc' && prof === 'pedestrian', destName = DEST.find(d => d.id === to).name;
    const list = [{ icon: 'start', text: `Start at ${START[from].name}` }], man = [];
    pieces.forEach((pc, i) => {
      const len = r5(pc.s1 - pc.s0), prevK = i ? pieces[i - 1].kind : null, k = pc.kind;
      const dir = pc.turn && i ? (pc.turn.t > 0 ? 'right' : 'left') : null;
      const turnTxt = dir ? `Turn ${Math.abs(pc.turn.t) > 2 ? 'sharp ' : ''}${dir}` : null;
      let icon = 'up', text, sub = '';
      if (k === 'steep') { icon = 'steep'; text = `Steep section, ${len} m`; sub = 'Go slowly; ask for help if needed'; }
      else if (k === 'road') { icon = 'road'; text = `Use the road for ${len} m`; sub = 'No accessible footpath here; keep to the edge'; }
      else if (k === 'smooth' && prevK && prevK !== 'smooth') { icon = 'smooth'; text = `Back on the footpath, ${len} m`; }
      else { text = `Continue ${len} m`; sub = KIND[k].label; }
      if (turnTxt) list.push({ icon: dir, text: turnTxt });
      list.push({ icon, text, sub });
      if (i === 0) man.push({ s: 0, icon: 'up', text: `Head along the ${KIND[k].label.toLowerCase()}`, sub: `${len} m` });
      else if (turnTxt) man.push({ s: pc.s0, icon: dir, text: turnTxt, kind: k,
        sub: k === 'steep' ? `Then steep for ${len} m – go slowly` : k === 'road' ? `Then use the road for ${len} m` : `Then ${len} m` });
      else if (k !== prevK || k !== 'smooth') man.push({ s: pc.s0, icon, kind: k,
        text: k === 'steep' ? `Steep section, ${len} m` : k === 'road' ? `Use the road, ${len} m` : 'Back onto the footpath',
        sub: k === 'road' ? 'No accessible footpath – keep to the edge' : k === 'steep' ? 'Go slowly; ask for help if needed' : `${len} m` });
    });
    list.push({ icon: 'flag', text: `Arrive at ${destName}`, sub: steps ? 'Main entrance – 7 steps' : prof === 'wheelchair' ? 'Ramp entrance – step-free' : '' });
    man.push({ s: total, icon: 'flag', text: `Arrive at ${destName}`, sub: steps ? 'Main entrance – 7 steps' : 'Ramp entrance – step-free', arrive: true });
    const by = {}; for (let i = 1; i < P.length; i++) by[P[i].kind] = (by[P[i].kind] || 0) + P[i].s - P[i - 1].s;
    return { prof, from, to, P, total, at, kindAt, list, man, by, steps, destName,
      ll: d => API.svgToLngLat(at(d)),
      bearing: d => { const a = API.svgToLngLat(at(d - 4)), b = API.svgToLngLat(at(d + 6));
        const k = Math.cos(a[1] * Math.PI / 180); return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180 / Math.PI + 360) % 360; } };
  }

  // ---------------------------------------------------------------- drawing on the map (colour + pattern)
  const mk = (tag, a) => { const el = document.createElementNS(NS, tag); for (const k in a) el.setAttribute(k, a[k]); return el; };
  const poly = (pts, a) => mk('polyline', { points: pts.map(p => p.join(',')).join(' '), fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', ...a });
  const gRoute = mk('g', { id: 'appRoute', 'aria-hidden': 'true' }); root.appendChild(gRoute);
  let doneLine = null, backLine = null;
  function drawRoute() {
    gRoute.innerHTML = ''; doneLine = backLine = null; const R = S.R; if (!R) return;
    gRoute.appendChild(poly(R.P.map(q => q.p), { stroke: '#fff', 'stroke-width': 13, 'stroke-opacity': .95 }));
    const runs = []; let run = [R.P[0].p], k = R.P[1] ? R.P[1].kind : 'smooth';
    for (let i = 1; i < R.P.length; i++) { if (R.P[i].kind !== k) { runs.push({ k, run }); run = [R.P[i - 1].p]; k = R.P[i].kind; } run.push(R.P[i].p); }
    runs.push({ k, run });
    for (const r of runs) {
      gRoute.appendChild(poly(r.run, { stroke: KIND[r.k].c, 'stroke-width': 8 }));
      // patterns so colour is never the only cue
      if (r.k === 'steep') gRoute.appendChild(poly(r.run, { stroke: '#262626', 'stroke-width': 3, 'stroke-dasharray': '1 7' }));
      if (r.k === 'road') gRoute.appendChild(poly(r.run, { stroke: '#fff', 'stroke-width': 2, 'stroke-dasharray': '6 6', 'stroke-linecap': 'butt' }));
    }
    doneLine = poly([R.P[0].p], { stroke: '#9CA3AF', 'stroke-width': 8 }); gRoute.appendChild(doneLine);
    backLine = poly([R.P[0].p], { stroke: '#262626', 'stroke-width': 3, 'stroke-dasharray': '2 6' }); backLine.style.display = 'none'; gRoute.appendChild(backLine);
  }
  function drawDone() {
    if (!doneLine) return; const pts = [];
    for (const q of S.R.P) { if (q.s > S.pos) break; pts.push(q.p); } pts.push(S.R.at(S.pos));
    doneLine.setAttribute('points', pts.map(p => p.join(',')).join(' '));
  }
  const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html || ''; return d; };
  const meEl = el('me', '<div class="cone"></div><div class="dot"></div>');
  const me = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'map' });
  const rawM = new maplibregl.Marker({ element: el('rawdot') });
  const pin = new maplibregl.Marker({ element: el('pin', '<svg width="40" height="52" viewBox="-21 -50 42 52" aria-hidden="true"><path d="M0 0C-6 -12 -18 -20 -18 -32a18 18 0 1 1 36 0C18 -20 6 -12 0 0Z" fill="#ED1C24" stroke="#fff" stroke-width="4"/><circle cy="-32" r="7" fill="#fff"/></svg>'), anchor: 'bottom' });
  const startDot = new maplibregl.Marker({ element: el('startdot') });
  const startLL = () => { const G = ALL.wheelchair; return API.svgToLngLat(G.nodes[G.places[S.from].node]); };
  function setRot(b, cone) { meEl.classList.toggle('nocone', !cone); if (me.setRotation) me.setRotation(b); }
  function placeMarkers() {
    const R = S.R; rawM.remove();
    if (!R) { pin.remove(); startDot.remove(); me.setLngLat(startLL()).addTo(map); setRot(0, false); return; }
    pin.setLngLat(R.ll(R.total)).addTo(map);
    if (S.screen === 'arrived') { me.remove(); startDot.remove(); return; }
    me.setLngLat(R.ll(S.pos)).addTo(map); setRot(R.bearing(S.pos), S.screen === 'nav');
    if (S.screen === 'nav') startDot.setLngLat(R.ll(0)).addTo(map); else startDot.remove();
  }

  // ---------------------------------------------------------------- camera
  const drawnBearing = () => API.info().bearing;
  const sheetH = () => $('#sheet').offsetHeight;
  const dur = d => RM ? 0 : d;
  function fitTo(lls, animate) {
    const lo = lls.map(p => p[0]), la = lls.map(p => p[1]);
    map.fitBounds([[Math.min(...lo), Math.min(...la)], [Math.max(...lo), Math.max(...la)]],
      { bearing: map.getBearing(), padding: { top: 70, bottom: sheetH() + 30, left: 40, right: 76 }, duration: animate ? dur(600) : 0, maxZoom: 18 });
  }
  function camHome(animate) { const G = ALL.wheelchair; fitTo([startLL(), API.svgToLngLat(G.nodes[G.places.lhc.node])], animate); }
  function camRoute(animate) { const R = S.R; fitTo(R.P.filter((_, i) => i % 3 === 0).map(q => API.svgToLngLat(q.p)).concat([R.ll(R.total)]), animate); }
  function camNav(snap) {
    const R = S.R, b = S.navNorth ? 0 : R.bearing(S.pos);
    let d = b - S.camB; while (d > 180) d -= 360; while (d < -180) d += 360;
    S.camB = snap || RM ? b : S.camB + d * 0.12;
    if (!S.follow) return;
    map.jumpTo({ center: R.ll(S.pos), bearing: S.camB, zoom: snap ? 18.2 : map.getZoom(),
      padding: { top: $('#navcard').offsetHeight + 30, bottom: sheetH(), left: 0, right: 0 } });
  }
  const resetPadding = () => map.jumpTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } });

  // ---------------------------------------------------------------- compass (top right)
  function updateCompass() {
    const b = map.getBearing(), c = $('#compass');
    c.querySelector('.needle').style.transform = `rotate(${-b}deg)`;
    const north = Math.abs(((b % 360) + 360) % 360) < 1 || Math.abs(((b % 360) + 360) % 360 - 360) < 1;
    c.setAttribute('aria-label', S.screen === 'nav'
      ? (S.navNorth ? 'Map faces north. Tap to face your direction of travel' : 'Map faces your direction of travel. Tap to face north')
      : (north ? 'Map faces north. Tap to show the campus as drawn' : 'Tap to turn the map to face north'));
  }
  map.on('rotate', updateCompass); map.on('move', updateCompass);
  function compassTap() {
    if (S.screen === 'nav') { S.navNorth = !S.navNorth; S.follow = true; $('#recenter').hidden = true; camNav(true); }
    else { S.orient = S.orient === 'north' ? 'drawn' : 'north'; map.easeTo({ bearing: S.orient === 'north' ? 0 : drawnBearing(), duration: dur(500) }); }
    updateCompass();
  }

  // ---------------------------------------------------------------- map key (?) – changes with the layer on screen
  const sw = {
    line: (c, extra) => `<svg width="40" height="14" aria-hidden="true"><line x1="4" y1="7" x2="36" y2="7" stroke="#fff" stroke-width="10" stroke-linecap="round"/><line x1="4" y1="7" x2="36" y2="7" stroke="${c}" stroke-width="6" stroke-linecap="round"/>${extra || ''}</svg>`,
    fp: (fill, stroke) => `<svg width="40" height="14" aria-hidden="true"><rect x="2" y="3" width="36" height="8" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`
  };
  const KEY = {
    route: { title: 'Your route', rows: [
      [sw.line('#00AEEF'), 'Smooth footpath'],
      [sw.line('#EDA13A', '<line x1="4" y1="7" x2="36" y2="7" stroke="#262626" stroke-width="3" stroke-dasharray="1 7" stroke-linecap="round"/>'), 'Steep footpath – go slowly (dotted)'],
      [sw.line('#ED1C24', '<line x1="4" y1="7" x2="36" y2="7" stroke="#fff" stroke-width="2" stroke-dasharray="6 6"/>'), 'On the road – no accessible footpath (dashed)'],
      [sw.line('#9CA3AF'), 'Already travelled'],
      ['<span class="kdot me-k"></span>', 'You are here (cone shows your direction)'],
      ['<svg width="22" height="28" viewBox="-21 -50 42 52" aria-hidden="true"><path d="M0 0C-6 -12 -18 -20 -18 -32a18 18 0 1 1 36 0C18 -20 6 -12 0 0Z" fill="#ED1C24" stroke="#fff" stroke-width="4"/><circle cy="-32" r="7" fill="#fff"/></svg>', 'Destination entrance']] },
    standard: { title: 'On the map', rows: [
      ['<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#6B9E5A"/><path d="M8 12h7M12 8l4 4-4 4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>', 'Building entrance (green arrow)'],
      ['<span class="ktag"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h5v-5h5v-5h5V5h3" stroke="#262626" stroke-width="2.5" fill="none"/></svg>7 Steps</span>', 'Steps, with the number of steps'],
      [sw.fp('#E4E3D7', '#C9C8BA'), 'Building'], [sw.fp('#D4D584', '#D4D584'), 'Lawn or green area'], [sw.fp('#C0BAB2', '#ADA79F'), 'Road']] },
    accessibility: { title: 'Accessibility layer', rows: [
      [sw.fp('#FFFFFF', '#6B9E5A'), 'Accessible footpath'], [sw.fp('#EDA13A', '#EDA13A'), 'Steep footpath'], [sw.fp('#ED1C24', '#ED1C24'), 'Footpath not accessible for wheelchairs'],
      ['<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="3" fill="#165395"/><circle cx="12" cy="6.5" r="1.6" fill="#fff"/><path d="M12 9v5h4l2 4M12 11.5h4M9.5 12.5a4.2 4.2 0 1 0 5.5 6" stroke="#fff" stroke-width="1.6" fill="none"/></svg>', 'Accessibility sign'],
      ['<span class="ktag"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h5v-5h5v-5h5V5h3" stroke="#262626" stroke-width="2.5" fill="none"/></svg>7 Steps</span>', 'Steps, with the number of steps']] },
    parking: { title: 'Parking layer', rows: [
      ['<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="3" fill="#165395"/><path d="M9 18V6h4a3.5 3.5 0 0 1 0 7H9" stroke="#fff" stroke-width="2.2" fill="none"/></svg>', 'Parking area']] }
  };
  function openKey() {
    const sec = [KEY.route, KEY[S.view] || KEY.standard];
    $('#keyPanel').innerHTML = `<div class="ph2"><h2 id="keyTitle" tabindex="-1">Map key</h2><button class="x" data-act="closeKey" aria-label="Close map key">${I('close')}</button></div>` +
      sec.map(s => `<h3>${s.title}</h3><ul class="keylist">${s.rows.map(([g, t]) => `<li><span class="kg">${g}</span><span>${t}</span></li>`).join('')}</ul>`).join('');
    $('#keyModal').hidden = false; $('#keyTitle').focus();
  }

  // ---------------------------------------------------------------- layers (one button, right edge)
  function setView(v) {
    S.view = v; const btn = document.querySelector(`[data-view="${v}"]`); if (btn) btn.click();
    document.querySelectorAll('[data-act=view]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === v)));
    $('#layersBtn').classList.toggle('on', v !== 'standard'); $('#layersMenu').hidden = true;
    const ab = $('#accessBtn'); ab.classList.toggle('on', v === 'accessibility'); ab.setAttribute('aria-pressed', String(v === 'accessibility')); $('#layersBtn').setAttribute('aria-expanded', 'false');
  }

  // ---------------------------------------------------------------- screens
  const I = (n, c) => `<svg class="ic ${c || ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtM = m => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';
  const fmtT = (m, prof) => Math.max(1, Math.round(m / SPEED[prof] / 60)) + ' min';
  const icon = n => ({ start: 'dot', up: 'up', left: 'left', right: 'right', steep: 'steep', road: 'road', smooth: 'check', flag: 'flag' }[n] || n);
  function strip(R) {
    const c = [];
    if (S.prof === 'wheelchair') {
      c.push(['check', 'No steps', 'ok']);
      if (R.by.steep) c.push(['steep', `Steep ${Math.round(R.by.steep / 5) * 5} m`, 'warn']);
      if (R.by.road) c.push(['road', `Road ${Math.round(R.by.road / 10) * 10} m`, 'alert']);
      c.push(['chair', 'Ramp entrance', 'ok']);
    } else c.push(['stairs', 'Entrance: 7 steps', 'warn']);
    return `<ul class="strip" aria-label="On this route">${c.map(([i, t, k]) => `<li class="${k}">${I(i, 'sm')}${t}</li>`).join('')}</ul>`;
  }
  let lastScreen = null;
  function render() {
    document.body.dataset.screen = S.screen; document.body.classList.toggle('searching', S.screen === 'home' && S.homeOpen);
    const sh = $('#sheet'); sh.className = 'sheet ' + S.screen;
    $('#navcard').hidden = S.screen !== 'nav';
    $('#recenter').hidden = !((S.screen === 'nav' && !S.follow) || S.screen === 'home');
    if (S.screen === 'home' && !S.homeOpen) {
      sh.className = 'sheet home mini';
      sh.innerHTML = `<h1 class="sr">Where to?</h1><button class="pillsearch" data-act="openSearch" aria-label="Where to? Search a building or place">${I('search')}<span>Where to?</span></button>`;
    } else if (S.screen === 'home') {
      sh.className = 'sheet home open';
      const counts = {}; DEST.forEach(d => counts[d.cat] = (counts[d.cat] || 0) + 1);
      const CI = { All: 'search', Academic: 'hall', Offices: 'building', Medical: 'cross', Hostels: 'bed', 'Sports & culture': 'ball' };
      sh.innerHTML = `<div class="grab" aria-hidden="true"></div>
        <div class="srchrow"><button class="x" data-act="closeSearch" aria-label="Close search">${I('back')}</button>
          <div class="srch">${I('search')}<input id="q" type="search" placeholder="Where to?" aria-label="Search a building or place" autocomplete="off" value="${esc(S.q)}"></div></div>
        <p class="here">From <button class="link" data-act="from" aria-label="From ${START[S.from].name}. Change starting point">${START[S.from].name}</button></p>
        <div class="cats" role="group" aria-label="Type of place">${CATS.map(c => `<button class="cat" data-act="cat" data-v="${c}" aria-pressed="${S.cat === c}"><span>${c}</span></button>`).join('')}</div>
        <h2 class="lh">${S.cat === 'All' ? 'Places' : esc(S.cat)}</h2>
        <ul class="list" id="results" aria-label="Places">${results()}</ul>`;
    } else if (S.screen === 'preview') {
      const R = S.R;
      sh.innerHTML = `<div class="grab" aria-hidden="true"></div>
        <div class="titlerow"><h1 tabindex="-1">${esc(R.destName)}</h1><button class="x" data-act="close" aria-label="Close and choose another place">${I('close')}</button></div>
        <div class="fromrow"><span>From</span><button class="pill" data-act="from" aria-label="From ${START[S.from].name}. Change starting point">${START[S.from].name}</button></div>
        <div class="seg2" role="radiogroup" aria-label="How are you travelling?">
          <button role="radio" aria-checked="${S.prof === 'wheelchair'}" data-act="prof" data-v="wheelchair">${I('chair', 'sm')}Wheelchair</button>
          <button role="radio" aria-checked="${S.prof === 'pedestrian'}" data-act="prof" data-v="pedestrian">${I('walk', 'sm')}Walking</button></div>
        ${strip(R)}
        <div class="res"><div class="big">${fmtT(R.total, S.prof)}<small>${fmtM(R.total)}</small></div>
          <button class="go" data-act="go" aria-label="Go. Start directions to ${esc(R.destName)}">Go</button></div>
        <button class="more" data-act="steps" aria-expanded="${S.allSteps}">${S.allSteps ? 'Hide steps' : `See all ${R.list.length} steps`}</button>
        ${S.allSteps ? `<ol class="dirs" aria-label="Directions">${R.list.map(s => `<li><span class="di di-${s.icon}" aria-hidden="true">${I(icon(s.icon))}</span><span><b>${esc(s.text)}</b>${s.sub ? `<br><small>${esc(s.sub)}</small>` : ''}</span></li>`).join('')}</ol>` : ''}`;
    } else if (S.screen === 'nav') {
      sh.innerHTML = `<div class="navbar"><div class="navstats"><b id="remT"></b><span id="remD"></span><div class="bar" aria-hidden="true"><i id="barI"></i></div></div>
          <button class="go end" data-act="end">End</button></div>
        <p class="gpsline" id="gpsline" role="status"></p>
        <div id="offroute" class="offroute" hidden role="alert"><b>You're off the route.</b> Head back to the coloured path.<button class="mini wide" data-act="wayback">Show the way back</button></div>
        <div class="sim" id="sim" ${S.gps && !S.test ? 'hidden' : ''}><span class="lbl">${S.test ? 'Test walk' : 'Walk preview'}</span>
          <button class="mini" data-act="play" id="playB">${S.play ? 'Pause' : 'Play'}</button>
          ${[1, 4, 8].map(m => `<button class="mini" data-act="speed" data-v="${m}" aria-pressed="${S.mult === m}" aria-label="Speed ${m} times">${m}×</button>`).join('')}</div>`;
      updateNav(true);
    } else if (S.screen === 'arrived') {
      const R = S.R;
      sh.innerHTML = `<div class="grab" aria-hidden="true"></div><div class="arrok" aria-hidden="true">${I('check')}</div><h1 tabindex="-1">You've arrived</h1>
        <p class="arr"><b>${esc(R.destName)}</b><br>${R.steps ? 'Use the main entrance ahead of you – it has 7 steps.' : 'Use the wheelchair accessible ramp ahead of you to enter the building.'}</p>
        <button class="go wide" data-act="done">Done</button><button class="more" data-act="another">Plan another route</button>`;
    }
    document.documentElement.style.setProperty('--sheet-h', sheetH() + 'px');
    placeMarkers(); updateCompass();
    if (S.screen !== lastScreen) { lastScreen = S.screen; const h = sh.querySelector('h1') || $('#navcard h2'); if (h && S.screen !== 'home') h.focus({ preventScroll: true }); }
  }
  function results() {
    const q = S.q.trim().toLowerCase();
    const list = DEST.filter(d => (S.cat === 'All' || d.cat === S.cat) && (!q || (d.name + ' ' + d.al + ' ' + d.cat).toLowerCase().includes(q)))
      .sort((a, b) => b.ready - a.ready);
    if (!list.length) return `<li class="empty">No place matches “${esc(S.q)}”.</li>`;
    return list.map(d => {
      if (!d.ready) return `<li><div class="item off" aria-label="${esc(d.name)}, directions coming soon"><span class="badge">${I('building')}</span><span><span class="nm">${esc(d.name)}</span><span class="sb">${d.cat} · Directions coming soon</span></span></div></li>`;
      const r = buildRoute(S.prof, S.from, d.id);
      return `<li><button class="item" data-act="pick" data-id="${d.id}" aria-label="${esc(d.name)}, ${fmtT(r.total, S.prof)}, ${fmtM(r.total)}"><span class="badge">${I('hall')}</span><span><span class="nm">${esc(d.name)}</span><span class="sb">${d.cat}</span></span>
        <span class="eta">${fmtT(r.total, S.prof)}<small>${fmtM(r.total)}</small></span></button></li>`;
    }).join('');
  }

  // ---------------------------------------------------------------- navigation
  function nextMan() { const R = S.R; return R.man.find(m => m.s > S.pos + 2) || R.man[R.man.length - 1]; }
  const say = m => `${m.text}${m.sub ? '. ' + m.sub : ''}`;
  function updateNav() {
    const R = S.R, m = nextMan(), left = Math.max(0, m.s - S.pos), rem = Math.max(0, R.total - S.pos);
    const near = left < 12, soon = left <= 50 && (m.kind === 'steep' || m.kind === 'road' || m.icon === 'steep' || m.icon === 'road');
    const dist = m.arrive && near ? 'Arriving' : near ? 'Now' : 'In ' + Math.max(5, Math.round(left / 5) * 5) + ' m';
    const card = $('#navcard'), html = `<div class="big ${m.icon}" aria-hidden="true">${I(icon(m.icon))}</div>
      <div class="txt"><div class="in">${dist}</div><h2 tabindex="-1">${esc(m.text)}</h2>${m.sub ? `<p>${esc(m.sub)}</p>` : ''}</div>
      <button class="vbtn" data-act="voice" aria-pressed="${S.voice}" aria-label="Voice guidance ${S.voice ? 'on' : 'off'}">${I(S.voice ? 'voice' : 'mute')}</button>`;
    if (card.dataset.k !== dist + m.text) { card.innerHTML = html; card.dataset.k = dist + m.text; }
    card.classList.toggle('soon', soon);
    const t = $('#remT'); if (t) { t.textContent = fmtT(rem, S.prof); $('#remD').textContent = fmtM(rem); $('#barI').style.width = (S.pos / R.total * 100) + '%'; }
    const key = R.man.indexOf(m);
    if (!S.said['a' + key] && S.pos > 1) { S.said['a' + key] = 1; speak(`In ${Math.max(5, Math.round(left / 5) * 5)} metres, ${say(m)}`); }
    if (soon && left > 15 && !S.said['w' + key]) { S.said['w' + key] = 1; speak(`${m.text} in ${Math.round(left / 5) * 5} metres`); }
    if (near && !S.said['n' + key]) { S.said['n' + key] = 1; speak(m.arrive ? `You have arrived at ${R.destName}` : m.text); }
    me.setLngLat(R.ll(S.pos)); setRot(R.bearing(S.pos), true); drawDone();
    if (S.pos >= R.total - 2) arrive();
  }
  function speak(t) { if (!S.voice || !window.speechSynthesis) return; try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } catch (e) {} }
  let wake = null;
  async function keepAwake(on) { try { if (on && navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); else if (!on && wake) { wake.release(); wake = null; } } catch (e) {} }
  function startNav() {
    S.screen = 'nav'; S.pos = 0; S.play = false; S.follow = true; S.said = {}; S.off = 0; S.navNorth = false;
    render(); camNav(true); keepAwake(true); speak(say(S.R.man[0]));
    if (!S.test) gpsOn(); else $('#gpsline').textContent = 'Test mode: walk is simulated.';
  }
  function leaveNav() { gpsOff(); S.play = false; keepAwake(false); resetPadding(); if (backLine) backLine.style.display = 'none'; }
  function stopNav(to) { leaveNav(); S.screen = to; render(); if (to === 'preview') camRoute(true); }
  function arrive() { leaveNav(); S.pos = S.R.total; S.screen = 'arrived'; render(); camRoute(true); }

  // ---- live GPS, snapped onto the route
  function gpsLine(t) { const l = $('#gpsline'); if (l) l.textContent = t; }
  function noGps(t) { S.gps = false; render(); gpsLine(t + ' Follow the steps, or tap Play to preview the walk.'); }
  function gpsOn() {
    if (!navigator.geolocation || !window.isSecureContext) { noGps('Your location isn’t available here.'); return; }
    S.gps = true; S.play = false; render(); gpsLine('Finding your location…');
    S.watch = navigator.geolocation.watchPosition(onFix, err => { gpsOff();
      noGps(err.code === 1 ? 'Location permission is off – you can allow it in your browser settings.' : 'Your location isn’t available here.'); },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  function gpsOff() { if (S.watch != null) navigator.geolocation.clearWatch(S.watch); S.watch = null; S.gps = false; }
  function onFix(p) {
    const acc = p.coords.accuracy;
    if (acc > 35) { gpsLine(`Weak GPS signal (±${Math.round(acc)} m) – waiting for a better fix`); return; }
    const ll = [p.coords.longitude, p.coords.latitude], q = API.lngLatToSvg(ll), R = S.R; let best = null;
    for (let i = 1; i < R.P.length; i++) {
      const a = R.P[i - 1], b = R.P[i], dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((q[0] - a.p[0]) * dx + (q[1] - a.p[1]) * dy) / l2));
      const off = Math.hypot(q[0] - a.p[0] - t * dx, q[1] - a.p[1] - t * dy) * MPU, s = a.s + (b.s - a.s) * t;
      const score = off + (s < S.pos - 30 || s > S.pos + 120 ? 40 : 0);
      if (!best || score < best.score) best = { score, off, s, pt: [a.p[0] + t * dx, a.p[1] + t * dy] };
    }
    S.raw = { ll, q, pt: best.pt };
    if (best.off > 25) {
      if (++S.off >= 3) { $('#offroute').hidden = false; if (S.off === 3) speak('You are off the route. Head back to the coloured path.'); }
      gpsLine(`About ${Math.round(best.off)} m from the route`);
      rawM.setLngLat(ll).addTo(map); backLine.setAttribute('points', [q, best.pt].map(p => p.join(',')).join(' ')); backLine.style.display = '';
      return;
    }
    S.off = 0; $('#offroute').hidden = true; rawM.remove(); backLine.style.display = 'none';
    S.pos = Math.max(S.pos - 5, best.s); gpsLine(`Live location · ±${Math.round(acc)} m`);
    updateNav(); camNav(false);
  }
  function wayBack() {
    if (!S.raw) return; S.follow = false; $('#recenter').hidden = false;
    fitTo([S.raw.ll, API.svgToLngLat(S.raw.pt)], true);
  }

  // ---------------------------------------------------------------- events
  function pick(id) { S.to = id; S.R = buildRoute(S.prof, S.from, id); S.screen = 'preview'; drawRoute(); render(); camRoute(true); }
  function openFrom() {
    $('#panelFrom').innerHTML = `<div class="ph2"><h2 id="fromTitle" tabindex="-1">Where are you?</h2><button class="x" data-act="closeFrom" aria-label="Close">${I('close')}</button></div>
      <ul class="list">${Object.entries(START).map(([k, v]) => `<li><button class="item" data-act="setFrom" data-id="${k}"><span class="badge">${I('dot')}</span><span><span class="nm">${v.name}</span><span class="sb">QR ${v.qr}</span></span></button></li>`).join('')}</ul>
      <p class="hint">Scanning the QR code at a start point sets this for you.</p>`;
    $('#fromModal').hidden = false; $('#fromTitle').focus();
  }
  function setFrom(k) { S.from = k; $('#fromModal').hidden = true; if (S.to) pick(S.to); else { render(); camHome(true); } }
  function home() { S.to = null; S.R = null; S.homeOpen = false; S.q = ''; S.cat = 'All'; drawRoute(); S.screen = 'home'; render(); camHome(true); }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) { if (e.target.id === 'fromModal') $('#fromModal').hidden = true; if (e.target.id === 'keyModal') $('#keyModal').hidden = true;
      if (!e.target.closest('#layersMenu')) { $('#layersMenu').hidden = true; $('#layersBtn').setAttribute('aria-expanded', 'false'); } return; }
    const a = t.dataset.act;
    if (a === 'pick') pick(t.dataset.id);
    else if (a === 'openSearch') { S.homeOpen = true; render(); const q = $('#q'); if (q) q.focus(); }
    else if (a === 'closeSearch') { S.homeOpen = false; S.q = ''; S.cat = 'All'; render(); camHome(true); }
    else if (a === 'cat') { S.cat = t.dataset.v; document.querySelectorAll('[data-act=cat]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.cat))); $('#results').innerHTML = results(); $('.lh').textContent = S.cat === 'All' ? 'Places' : S.cat; }
    else if (a === 'close') home();
    else if (a === 'from') openFrom();
    else if (a === 'closeFrom') $('#fromModal').hidden = true;
    else if (a === 'setFrom') setFrom(t.dataset.id);
    else if (a === 'prof') { if (S.prof !== t.dataset.v) { S.prof = t.dataset.v; store.set('prof', S.prof); pick(S.to); } }
    else if (a === 'steps') { S.allSteps = !S.allSteps; render(); }
    else if (a === 'go') startNav();
    else if (a === 'end') stopNav('preview');
    else if (a === 'play') { S.play = !S.play; if (S.play && S.pos >= S.R.total - 2) S.pos = 0; S.follow = true; t.textContent = S.play ? 'Pause' : 'Play'; $('#recenter').hidden = true; }
    else if (a === 'speed') { S.mult = +t.dataset.v; document.querySelectorAll('[data-act=speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === S.mult))); }
    else if (a === 'voice') { S.voice = !S.voice; store.set('voice', S.voice ? '1' : '0'); $('#navcard').dataset.k = ''; updateNav(); if (S.voice) speak('Voice guidance on'); }
    else if (a === 'recenter') { if (S.screen === 'home') { if (S.raw) map.easeTo({ center: S.raw.ll, zoom: Math.max(map.getZoom(), 17), duration: dur(600) }); else camHome(true); } else { S.follow = true; t.hidden = true; camNav(true); } }
    else if (a === 'wayback') wayBack();
    else if (a === 'again') { S.pos = 0; S.screen = 'preview'; render(); camRoute(true); }
    else if (a === 'done') { home(); if (S.orient === 'drawn') map.easeTo({ bearing: drawnBearing(), duration: dur(500) }); }
    else if (a === 'compass') compassTap();
    else if (a === 'key') openKey();
    else if (a === 'access') setView(S.view === 'accessibility' ? 'standard' : 'accessibility');
    else if (a === 'another') { home(); S.homeOpen = true; render(); const q = $('#q'); if (q) q.focus(); }
    else if (a === 'closeKey') $('#keyModal').hidden = true;
    else if (a === 'layers') { const m = $('#layersMenu'); m.hidden = !m.hidden; t.setAttribute('aria-expanded', String(!m.hidden)); e.stopPropagation(); }
    else if (a === 'view') setView(t.dataset.v);
  });
  document.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; $('#results').innerHTML = results(); } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'q') { const b = document.querySelector('#results button.item'); if (b) b.click(); }
    if (e.key === 'Escape') { if (S.screen === 'home' && S.homeOpen && $('#keyModal').hidden && $('#fromModal').hidden) { S.homeOpen = false; render(); } $('#keyModal').hidden = true; $('#fromModal').hidden = true; $('#layersMenu').hidden = true; }
  });
  map.on('dragstart', () => { if (S.screen === 'nav') { S.follow = false; $('#recenter').hidden = false; } });
  // test mode lives in the design-team tools panel (open with #tools)
  const tm = $('#testMode'); if (tm) { tm.checked = S.test; tm.addEventListener('change', () => { S.test = tm.checked; store.set('test', S.test ? '1' : '0'); }); }

  let lastT = 0;
  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    if (S.screen === 'nav' && !S.gps) {
      if (S.play) { S.pos = Math.min(S.R.total, S.pos + dt * SPEED[S.prof] * S.mult); updateNav(); }
      if (S.screen === 'nav') camNav(false);
    }
    requestAnimationFrame(frame);
  }
  // QR start points (#qr-gate, #qr-zanskar) and the design-team tools (#tools)
  function fromHash() {
    const h = location.hash.slice(1);
    $('#panel').hidden = h !== 'tools';
    const k = h.replace('qr-', ''); if (START[k]) { S.from = k; return true; } return false;
  }
  window.addEventListener('hashchange', () => { if (fromHash()) { if (S.screen === 'nav') leaveNav(); home(); } });
  fromHash();
  render();
  setTimeout(() => camHome(false), 50);
  requestAnimationFrame(frame);
  window.__app = { S, buildRoute, pick, startNav, updateNav, camNav, openKey, setView };
})();
