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
    smooth:   { c: '#0072B2', label: 'Smooth footpath' },
    steep:    { c: '#E69F00', label: 'Steep footpath' },
    road:     { c: '#B3261E', label: 'On the road' },
    footpath: { c: '#0072B2', label: 'Footpath' }
  };
  const START = { gate: { name: 'Main Gate 1', qr: 'G-01' }, zanskar: { name: 'Zanskar Hostel', qr: 'Z-01' }, lhc: { name: 'Lecture Hall Complex', qr: 'L-01' } };
  // routes drawn so far: to and from the Lecture Hall Complex
  const canGo = (from, to) => from !== to && (from === 'lhc' || to === 'lhc') && !!START[from] && !!START[to];
  const DEST = [
    { id: 'lhc', name: 'Lecture Hall Complex', cat: 'Academic', al: 'lhc lecture halls classrooms', ready: true },
    { id: 'Main Building', cat: 'Offices' }, { id: 'Central Library', cat: 'Academic' }, { id: 'Central Workshop', cat: 'Academic' },
    { id: 'Textile Building', cat: 'Academic' }, { id: 'Synergy Building', cat: 'Academic' }, { id: 'Bharti School', cat: 'Academic' },
    { id: 'IIT Hospital', cat: 'Medical' }, { id: 'zanskar', name: 'Zanskar Hostel', cat: 'Hostels', al: 'hostel' }, { id: 'SAC Complex', cat: 'Sports & culture' },
    { id: 'gate', name: 'Main Gate 1', cat: 'Gates', al: 'main gate entrance exit gate 1' }
  ].map(d => ({ name: d.name || d.id, al: '', ...d }));
  const CATS = ['All', 'Offices', 'Academic', 'Medical', 'Hostels', 'Sports & culture', 'Gates'];
  const CI = { Academic: 'hall', Offices: 'building', Medical: 'cross', Hostels: 'bed', 'Sports & culture': 'ball', Gates: 'flag' };
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
    const ped = prof === 'pedestrian', steps = to === 'lhc' && ped, destName = DEST.find(d => d.id === to).name;
    const leave = from === 'lhc' ? (ped ? 'Leave by the main entrance – 7 steps' : 'Leave by the ramp entrance (south-west) – step-free') : '';
    const endSub = to === 'lhc' ? (ped ? 'Main entrance – 7 steps' : 'Ramp entrance – step-free') : '';
    const list = [{ icon: 'start', text: `Start at ${START[from].name}`, sub: leave }], man = [];
    // a short red section with footpath on both sides is a road crossing, not a stretch along the road
    const isCross = i => { const pc = pieces[i]; return pc.kind === 'road' && pc.s1 - pc.s0 <= 25
      && (!pieces[i - 1] || pieces[i - 1].kind !== 'road') && (!pieces[i + 1] || pieces[i + 1].kind !== 'road'); };
    let crossings = 0, crossM = 0;
    pieces.forEach((pc, i) => {
      const len = r5(pc.s1 - pc.s0), prevK = i ? pieces[i - 1].kind : null, k = pc.kind, cross = isCross(i);
      if (cross) { crossings++; crossM += pc.s1 - pc.s0; }
      const toward = `To the footpath towards ${destName}`;
      const dir = pc.turn && i ? (pc.turn.t > 0 ? 'right' : 'left') : null;
      const turnTxt = dir ? `Turn ${Math.abs(pc.turn.t) > 2 ? 'sharp ' : ''}${dir}` : null;
      let icon = 'up', text, sub = '';
      if (k === 'steep') { icon = 'steep'; text = `Steep section, ${len} m`; sub = 'Go slowly; ask for help if needed'; }
      else if (cross) { icon = 'road'; text = 'Cross the road'; sub = `${toward} · about ${len} m`; }
      else if (k === 'road') { icon = 'road'; text = `Use the road for ${len} m`; sub = 'No accessible footpath here; keep to the edge'; }
      else if (k === 'smooth' && prevK && prevK !== 'smooth') { icon = 'smooth'; text = `Back on the footpath, ${len} m`; }
      else { text = `Continue ${len} m`; sub = KIND[k].label; }
      if (turnTxt) list.push({ icon: dir, text: turnTxt });
      list.push({ icon, text, sub });
      if (i === 0) man.push({ s: 0, icon: 'up', text: `Head along the ${KIND[k].label.toLowerCase()}`, sub: `${len} m` });
      else if (turnTxt && cross) man.push({ s: pc.s0, icon: dir, kind: k, cross: true, text: `${turnTxt} and cross the road`, sub: toward });
      else if (turnTxt) man.push({ s: pc.s0, icon: dir, text: turnTxt, kind: k,
        sub: k === 'steep' ? `Then steep for ${len} m – go slowly` : k === 'road' ? `Then use the road for ${len} m` : `Then ${len} m` });
      else if (cross) man.push({ s: pc.s0, icon: 'road', kind: k, cross: true, text: 'Cross the road', sub: `${toward} · ${len} m` });
      else if (k !== prevK || k !== 'smooth') man.push({ s: pc.s0, icon, kind: k,
        text: k === 'steep' ? 'Steep section ahead' : k === 'road' ? 'Road section ahead' : 'Back onto the footpath',
        sub: k === 'road' ? `Keep to the edge · ${len} m` : k === 'steep' ? `Take it slowly · ${len} m` : `${len} m` });
    });
    list.push({ icon: 'flag', text: `Arrive at ${destName}`, sub: endSub });
    man.push({ s: total, icon: 'flag', text: `Arrive at ${destName}`, sub: endSub, arrive: true });
    const by = {}; for (let i = 1; i < P.length; i++) by[P[i].kind] = (by[P[i].kind] || 0) + P[i].s - P[i - 1].s;
    return { prof, from, to, P, total, at, kindAt, list, man, by, crossings, alongRoad: Math.max(0, (by.road || 0) - crossM), steps, destName,
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
    gRoute.appendChild(poly(R.P.map(q => q.p), { stroke: '#1A1A1A', 'stroke-width': 16 }));   // dark casing
    gRoute.appendChild(poly(R.P.map(q => q.p), { stroke: '#fff', 'stroke-width': 13 }));       // white halo
    const runs = []; let run = [R.P[0].p], k = R.P[1] ? R.P[1].kind : 'smooth';
    for (let i = 1; i < R.P.length; i++) { if (R.P[i].kind !== k) { runs.push({ k, run }); run = [R.P[i - 1].p]; k = R.P[i].kind; } run.push(R.P[i].p); }
    runs.push({ k, run });
    for (const r of runs) {
      gRoute.appendChild(poly(r.run, { stroke: KIND[r.k].c, 'stroke-width': 9 }));
      // patterns so colour is never the only cue
      if (r.k === 'steep') gRoute.appendChild(poly(r.run, { stroke: '#1A1A1A', 'stroke-width': 4, 'stroke-dasharray': '0.1 8', 'stroke-linecap': 'round' }));
      if (r.k === 'road') gRoute.appendChild(poly(r.run, { stroke: '#fff', 'stroke-width': 3, 'stroke-dasharray': '7 6', 'stroke-linecap': 'butt' }));
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
    if (!R) { pin.remove(); startDot.remove(); me.setLngLat(S.here || startLL()).addTo(map); setRot(0, false); return; }
    pin.setLngLat(R.ll(R.total)).addTo(map);
    if (S.screen === 'arrived') { me.remove(); startDot.remove(); return; }
    if (S.screen !== 'nav' && S.here) { me.setLngLat(S.here).addTo(map); setRot(0, false); startDot.remove(); return; }
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
  function camHome(animate) { const G = ALL.wheelchair, at = k => API.svgToLngLat(G.nodes[G.places[k].node]);
    fitTo([...(S.from === 'lhc' ? ['lhc', 'gate', 'zanskar'].map(at) : [startLL(), at('lhc')]), ...(S.here ? [S.here] : [])], animate); }
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
    if (S.screen === 'nav') { S.navNorth = !S.navNorth; S.follow = true; camNav(true); }
    else { S.orient = S.orient === 'north' ? 'drawn' : 'north'; map.easeTo({ bearing: S.orient === 'north' ? 0 : drawnBearing(), duration: dur(500) }); }
    updateCompass();
  }

  // ---------------------------------------------------------------- map key (?) – changes with the layer on screen
  const KI = {
    entrance: '<svg width="30" height="30" viewBox="0 0 21.78 21.78" aria-hidden="true"><circle fill="#fff" cx="10.89" cy="10.89" r="10.89"/><circle fill="#6b9e5a" cx="10.89" cy="10.89" r="9.89"/><polygon fill="#fff" points="15.08 6.09 5.92 6.1 5.92 15.25 7.55 16.89 7.54 8.92 14.57 15.95 15.73 14.79 8.65 7.73 16.72 7.73 15.08 6.09"/></svg>',
    reserved: '<svg width="30" height="30" viewBox="4.94 264.79 20 20" aria-hidden="true"><rect fill="#165395" x="4.94" y="264.79" width="20" height="20" rx="2.8" ry="2.8"/> <path fill="#fff" d="M10.95,267.35c1.85,0,2.91,1.15,2.91,2.75s-1.08,2.73-2.95,2.73h-1.47v2.66h-1.67v-8.14h3.17ZM12.14,270.1c0-.82-.48-1.37-1.5-1.37h-1.2v2.76h1.2c1.02,0,1.5-.57,1.5-1.39Z"/> <g><path fill="#fff" d="M21.7,281.63l-.9-3.5h-1.7c-.37-.98-1.22-1.71-2.24-1.93l.39-1.51c.13-.51.59-.87,1.12-.87h.24v3h.7v-3.7h-.94c-.85,0-1.58.57-1.79,1.39l-.41,1.61c-1.69,0-3.06,1.39-3.06,3.1s1.39,3.1,3.1,3.1,3.1-1.39,3.1-3.1c0-.13,0-.27-.03-.4h.83l.9,3.5h1.38v-.7h-.68ZM16.19,281.63c-1.32,0-2.4-1.08-2.4-2.4s1.08-2.4,2.4-2.4,2.4,1.08,2.4,2.4-1.08,2.4-2.4,2.4Z"/> <path fill="#fff" d="M18.68,272.77l.09.05h.35l.09-.05s.96-.61.96-1.42c0-.68-.55-1.23-1.23-1.23s-1.23.55-1.23,1.23c0,.81.93,1.4.97,1.42ZM18.94,270.82c.29,0,.52.24.52.52s-.31.58-.52.75c-.22-.17-.53-.47-.53-.75s.24-.52.52-.52Z"/> </g></svg>',
    bicycle: '<svg width="30" height="30" viewBox="4.94 288.05 20 20" aria-hidden="true"><rect fill="#165395" x="4.94" y="288.05" width="20" height="20" rx="2.8" ry="2.8"/> <path fill="#fff" d="M10.95,290.61c1.85,0,2.91,1.15,2.91,2.75s-1.08,2.73-2.95,2.73h-1.47v2.66h-1.67v-8.14h3.17ZM12.14,293.36c0-.82-.48-1.37-1.5-1.37h-1.2v2.76h1.2c1.02,0,1.5-.57,1.5-1.39Z"/> <path fill="#fff" d="M20.08,300.14c-.57,0-1.09.16-1.53.43l-.69-.79.33-.62h.57v-.69h-1.95v.69h.6l-.17.33h-4.29l.67-1.29h1.38v-.69h-2.52v.69h.36l-1.09,2.1c-.32-.12-.66-.18-1.02-.18-1.63,0-2.95,1.32-2.95,2.95s1.32,2.95,2.95,2.95,2.95-1.32,2.95-2.95c0-1.03-.53-1.94-1.34-2.47h.02s.09-.15.09-.15l3.03,3.24h1.71c.28,1.34,1.46,2.38,2.89,2.38,1.64,0,2.95-1.33,2.95-2.95s-1.33-2.98-2.95-2.98ZM12.99,303.07c0,1.25-1.01,2.26-2.26,2.26s-2.26-1.01-2.26-2.26,1.01-2.26,2.26-2.26c.25,0,.49.04.72.12l-1.02,1.97.62.31,1.01-1.97c.56.41.93,1.08.93,1.83ZM13.17,300.2h3.7l-1.33,2.55-2.38-2.55ZM17.12,303h-.93l1.33-2.55.48.55c-.52.52-.84,1.21-.88,2ZM18.46,301.52l1.27,1.46h-1.91c.03-.57.26-1.09.64-1.46ZM20.08,305.37c-1.05,0-1.93-.72-2.19-1.69h2.05c.24,0,.45-.14.55-.34.1-.21.07-.47-.1-.64l-1.38-1.59c.31-.17.69-.28,1.07-.28,1.24,0,2.26,1.02,2.26,2.26s-1.02,2.27-2.26,2.27Z"/></svg>',
    steps: '<svg width="30" height="30" viewBox="162.37 172.17 19.1 19.1" aria-hidden="true"><rect fill="#e6e7e8" x="162.37" y="172.17" width="19.1" height="19.1"/> <polygon fill="#231f20" points="175.46 174.75 174.21 174.75 174.21 179.39 170.82 179.39 169.56 179.39 169.56 184.04 166.18 184.04 164.92 184.04 164.92 188.68 166.18 188.68 166.18 185.29 170.82 185.29 170.82 184.04 170.82 180.65 175.46 180.65 175.46 179.39 175.46 176.01 178.91 176.01 178.91 174.75 175.46 174.75"/></svg>',
    rampFlat: '<svg width="30" height="30" viewBox="162.37 199.37 20 20" aria-hidden="true"><rect fill="#165395" x="162.37" y="199.37" width="20" height="20" transform="translate(344.73 418.74) rotate(-180)"/> <g><polygon fill="#6b9e5a" points="164.48 212.71 180.35 216.82 164.48 216.82 164.48 212.71"/> <polygon fill="#fff" points="171.66 212.08 168.79 205.65 175.2 202.78 176.86 203.41 171.28 205.91 178.41 208.62 177.96 209.8 170.78 207.05 173.32 212.71 171.66 212.08"/> </g></svg>',
    rampSteep: '<svg width="30" height="30" viewBox="162.37 227.02 20 20" aria-hidden="true"><rect fill="#165395" x="162.37" y="227.02" width="20" height="20" transform="translate(344.73 474.05) rotate(-180)"/> <g><polygon fill="#eda13a" points="164.48 238.89 180.35 244.47 164.48 244.47 164.48 238.89"/> <polygon fill="#fff" points="171.66 239.73 168.79 233.31 175.2 230.43 176.86 231.06 171.28 233.56 178.41 236.28 177.96 237.45 170.78 234.71 173.32 240.37 171.66 239.73"/> </g></svg>',
    rampNo: '<svg width="30" height="30" viewBox="162.37 254.68 20 20" aria-hidden="true"><rect fill="#165395" x="162.37" y="254.68" width="20" height="20" transform="translate(344.73 529.36) rotate(-180)"/> <g><polygon fill="#ed1c24" points="164.48 264.93 180.35 272.37 164.48 272.37 164.48 264.93"/> <polygon fill="#fff" points="171.33 266.96 168.93 260.34 175.54 257.94 177.15 258.69 171.39 260.77 178.31 264 177.78 265.14 170.82 261.88 172.94 267.71 171.33 266.96"/> </g></svg>',
    blocked: '<svg width="30" height="30" viewBox="161.9 281.9 20.9 20.9" aria-hidden="true"><rect fill="#f9ed32" x="165.3" y="285.27" width="14.14" height="14.14" transform="translate(257.2 -36.26) rotate(45)"/> <g><path fill="#010101" d="M176.12,288.73v.58h-7.5v-.58h-.58v5.2h.58v-1.44h7.5v1.44h.58v-5.2h-.58ZM172.27,289.89h1.1l-.9,2.02h-1.1l.9-2.02ZM170.74,291.91h-1.1l.9-2.02h1.1l-.9,2.02ZM174,289.89h1.1l-.9,2.02h-1.1l.9-2.02ZM168.61,289.89h1.29l-.9,2.02h-.39v-2.02ZM176.12,291.91h-1.29l.9-2.02h.39v2.02Z"/> <rect fill="#010101" x="166.72" y="293.93" width="11.29" height="1.07"/> </g></svg>'
  };
  const sw = {
    line: (c, extra) => `<svg width="44" height="16" aria-hidden="true"><line x1="5" y1="8" x2="39" y2="8" stroke="#1A1A1A" stroke-width="13" stroke-linecap="round"/><line x1="5" y1="8" x2="39" y2="8" stroke="#fff" stroke-width="10.5" stroke-linecap="round"/><line x1="5" y1="8" x2="39" y2="8" stroke="${c}" stroke-width="6.5" stroke-linecap="round"/>${extra || ''}</svg>`,
    // footpath strip as drawn on the map: fill between two edge lines
    strip: (fill, edge, extra) => `<svg width="44" height="20" aria-hidden="true">${extra && extra.defs || ''}<g transform="translate(0 2)"><rect x="0" y="-2" width="44" height="20" rx="3" fill="#F3F0E8" stroke="#D9D4C7" stroke-width="1"/><rect x="2" y="4" width="40" height="8" fill="${fill}"/>${extra && extra.top || ''}<line x1="2" y1="3.6" x2="42" y2="3.6" stroke="${edge}" stroke-width="1.6"/><line x1="2" y1="12.4" x2="42" y2="12.4" stroke="${edge}" stroke-width="1.6"/></g></svg>`
  };
  const dots = [6, 11, 16, 21, 26, 31, 36].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 9.6 : 6.4}" r="1.15" fill="#A8741C"/>`).join('');
  const ROUTE_KEY = () => ({ title: 'Your route', rows: [
    [sw.line('#0072B2'), 'Smooth footpath'],
    [sw.line('#E69F00', '<line x1="5" y1="8" x2="39" y2="8" stroke="#1A1A1A" stroke-width="3" stroke-dasharray="0.1 7" stroke-linecap="round"/>'), 'Steep access footpath', 'Go slowly'],
    [sw.line('#B3261E', '<line x1="5" y1="8" x2="39" y2="8" stroke="#fff" stroke-width="2" stroke-dasharray="6 6"/>'), 'On the road', 'No accessible footpath'],
    ...(S.screen === 'nav' ? [[sw.line('#9CA3AF'), 'Already travelled']] : []),
    ['<span class="kdot me-k"></span>', 'You are here'],
    ['<svg width="24" height="30" viewBox="-21 -50 42 52" aria-hidden="true"><path d="M0 0C-6 -12 -18 -20 -18 -32a18 18 0 1 1 36 0C18 -20 6 -12 0 0Z" fill="#ED1C24" stroke="#fff" stroke-width="4"/><circle cy="-32" r="7" fill="#fff"/></svg>', 'Your destination']] });
  const MAP_KEY = { title: 'On the map', groups: [
    ['Entrances', [[KI.entrance, 'Accessible entrance'], [KI.steps, 'Steps at entrance']]],
    ['Footpaths', [[sw.strip('#FFFFFF', '#3F8F4A'), 'Accessible footpath'],
      [sw.strip('#F1C878', '#C4802B', { top: dots }), 'Steep access footpath'],
      [sw.strip('url(#kHatch)', '#C0504A', { defs: '<defs><pattern id="kHatch" patternUnits="userSpaceOnUse" width="4.5" height="4.5" patternTransform="rotate(45)"><rect width="4.5" height="4.5" fill="#F6DAD7"/><rect width="1.3" height="4.5" fill="#D46A62"/></pattern></defs>' }), 'Inaccessible footpath']]],
    ['Ramps', [[KI.rampFlat, 'Flat or gentle ramp'], [KI.rampSteep, 'Steep ramp'], [KI.rampNo, 'Inaccessible ramp'], [KI.blocked, 'Blocked access']]],
    ['Parking', [[KI.reserved, 'Reserved parking'], [KI.bicycle, 'Bicycle parking']]]] };
  const keyRow = ([g, t, sub]) => `<li><span class="kg">${g}</span><span class="kt">${t}${sub ? `<small>${sub}</small>` : ''}</span></li>`;
  function openKey() {
    const R = ROUTE_KEY();
    $('#keyPanel').innerHTML = `<div class="ph2"><h2 id="keyTitle" tabindex="-1">Map key</h2><button class="x" data-act="closeKey" aria-label="Close map key">${I('close')}</button></div>` +
      `<h3>${R.title}</h3><ul class="keylist">${R.rows.map(keyRow).join('')}</ul>` +
      `<h3>${MAP_KEY.title}</h3>` + MAP_KEY.groups.map(([h, rows]) => `<h4>${h}</h4><ul class="keylist">${rows.map(keyRow).join('')}</ul>`).join('');
    $('#keyModal').hidden = false; $('#keyTitle').focus();
  }

  // ---------------------------------------------------------------- accessibility settings (saved on this phone)
  const A11Y_DEF = { fs: 100, ls: 0, lh: 1.5, hc: false, gray: false, neg: false, light: true };
  const A11Y_RNG = { fs: [100, 200, 10], ls: [0, 3, 0.5], lh: [1.2, 2.4, 0.1] };
  const A11Y = Object.assign({}, A11Y_DEF, (() => {
    let saved = {}; try { saved = JSON.parse(store.get('a11y', '{}')) || {}; } catch (e) {}
    const first = Object.keys(saved).length ? {} : { hc: !!(window.matchMedia && matchMedia('(prefers-contrast: more)').matches) };
    return Object.assign(first, saved);
  })());
  const fmtA = { fs: v => `${v}%`, ls: v => `${v.toFixed(1)} px`, lh: v => `${v.toFixed(1)}×` };
  const sayA = { fs: v => `${v} percent`, ls: v => `${v} pixels`, lh: v => `${v.toFixed(1)} times` };
  function clampA(k, v) { const [lo, hi, st] = A11Y_RNG[k]; v = Math.round(v / st) * st; return +Math.min(hi, Math.max(lo, v)).toFixed(2); }
  function applyA11y(save) {
    const h = document.documentElement, a = A11Y;
    h.classList.toggle('light', a.light); h.classList.toggle('hc', a.hc);
    h.style.setProperty('--fz', a.fs / 100);
    h.style.setProperty('--ls', a.ls ? a.ls + 'px' : 'normal');
    h.classList.toggle('lhset', a.lh !== A11Y_DEF.lh); h.style.setProperty('--lh', a.lh);
    const f = []; if (a.gray) f.push('grayscale(1)'); if (a.neg) f.push('invert(1) hue-rotate(180deg)');
    h.style.filter = f.join(' ');
    if (window.ARTWORK_API && ARTWORK_API.setLabelScale) ARTWORK_API.setLabelScale(1 + (a.fs - 100) / 100 * 0.6);
    $('#accessBtn').classList.toggle('on', Object.keys(A11Y_DEF).some(k => a[k] !== A11Y_DEF[k]));
    if (save) store.set('a11y', JSON.stringify(a));
    syncA11y(); fitControls();
  }
  const a11ySlider = (k, label, less, more) => {
    const [lo, hi, st] = A11Y_RNG[k];
    return `<div class="a11yrow"><div class="a11ylab"><label for="a11y-${k}">${label}</label><output id="a11y-${k}-v" for="a11y-${k}"></output></div>
      <div class="a11yctl"><button class="a11ystep" data-act="a11yStep" data-k="${k}" data-d="-1" aria-label="${less}"><span aria-hidden="true">−</span></button>
      <input type="range" id="a11y-${k}" data-k="${k}" min="${lo}" max="${hi}" step="${st}">
      <button class="a11ystep" data-act="a11yStep" data-k="${k}" data-d="1" aria-label="${more}"><span aria-hidden="true">+</span></button></div></div>`;
  };
  const a11ySwitch = (k, icon, label, desc) => `<button class="a11ysw" role="switch" aria-checked="false" data-act="a11yToggle" data-k="${k}">
      <span class="swic" aria-hidden="true">${I(icon)}</span><span class="swt"><b>${label}</b><small>${desc}</small></span><span class="swk" aria-hidden="true"></span></button>`;
  function buildA11y() {
    $('#a11yPanel').innerHTML = `<div class="a11yhead"><span class="a11yic" aria-hidden="true">${I('access')}</span>
      <div class="a11yht"><h2 id="a11yTitle" tabindex="-1">Accessibility settings</h2><p>Make text and colours easier to see. Changes apply straight away and are saved on this phone.</p></div>
      <button class="x" data-act="closeA11y" aria-label="Close accessibility settings">${I('close')}</button></div>
      <div class="a11ybody">
        <h3 class="a11ysec"><span aria-hidden="true">${I('text')}</span>Text</h3>
        ${a11ySlider('fs', 'Text size', 'Smaller text', 'Larger text')}
        ${a11ySlider('ls', 'Letter spacing', 'Less letter spacing', 'More letter spacing')}
        ${a11ySlider('lh', 'Line height', 'Less line height', 'More line height')}
        <h3 class="a11ysec"><span aria-hidden="true">${I('eye')}</span>Visual options</h3>
        ${a11ySwitch('hc', 'contrast', 'High contrast', 'Stronger outlines, darker text and bold map labels')}
        ${a11ySwitch('gray', 'moon', 'Grayscale', 'Shows everything in shades of grey')}
        ${a11ySwitch('neg', 'invert', 'Negative contrast', 'Inverts the colours: light on dark')}
        ${a11ySwitch('light', 'sun', 'Light background', 'White panels. Turn off for dark panels')}
        <div class="a11yfoot"><button class="a11yreset" data-act="a11yReset">${I('reset')}Reset to default</button><button class="go a11ydone" data-act="closeA11y">Done</button></div>
        <p class="sr" id="a11yMsg" aria-live="polite"></p>
      </div>`;
  }
  function syncA11y() {
    if (!$('#a11y-fs')) return;
    for (const k of Object.keys(A11Y_RNG)) {
      const i = $('#a11y-' + k), [lo, hi] = A11Y_RNG[k], v = A11Y[k];
      if (+i.value !== v) i.value = v;
      i.setAttribute('aria-valuetext', sayA[k](v)); i.style.setProperty('--p', ((v - lo) / (hi - lo) * 100) + '%');
      $('#a11y-' + k + '-v').textContent = fmtA[k](v);
      document.querySelectorAll(`.a11ystep[data-k="${k}"]`).forEach(b => { b.disabled = b.dataset.d < 0 ? v <= lo : v >= hi; });
    }
    document.querySelectorAll('.a11ysw').forEach(b => b.setAttribute('aria-checked', String(!!A11Y[b.dataset.k])));
  }
  let a11yOpener = null;
  function openA11y() {
    if (!$('#a11y-fs')) buildA11y();
    a11yOpener = document.activeElement; syncA11y();
    $('#a11yModal').hidden = false; $('#a11yTitle').focus();
  }
  function closeA11y() {
    if ($('#a11yModal').hidden) return;
    $('#a11yModal').hidden = true;
    const back = a11yOpener && document.body.contains(a11yOpener) && a11yOpener.offsetParent ? a11yOpener : $('#accessBtn');
    if (back && back.focus) back.focus();
  }
  document.addEventListener('input', e => {
    const i = e.target.closest('#a11yPanel input[type=range]'); if (!i) return;
    A11Y[i.dataset.k] = clampA(i.dataset.k, +i.value); applyA11y(true);
  });
  document.addEventListener('keydown', e => {                 // keep keyboard focus inside the open settings panel
    if (e.key !== 'Tab' || $('#a11yModal').hidden) return;
    const f = [...$('#a11yPanel').querySelectorAll('button:not([disabled]), input, [tabindex="-1"]')].filter(x => x.offsetParent);
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ---------------------------------------------------------------- layers (one button, right edge)
  function setView(v) {
    S.view = v; const btn = document.querySelector(`[data-view="${v}"]`); if (btn) btn.click();
    document.querySelectorAll('[data-act=view]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === v)));
    $('#layersBtn').classList.toggle('on', v !== 'standard'); $('#layersMenu').hidden = true; fitControls();
    $('#layersBtn').setAttribute('aria-expanded', 'false');
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
      if (R.alongRoad >= 5) c.push(['road', `Road ${Math.round(R.alongRoad / 10) * 10} m`, 'alert']);
      if (R.crossings) c.push(['road', R.crossings === 1 ? '1 road crossing' : `${R.crossings} road crossings`, 'warn']);
      if (!R.by.road) c.push(['chair', 'Footpath all the way', 'ok']);
    } else { c.push(['walk', 'Footpath all the way', 'ok']); c.push(['stairs', R.from === 'lhc' ? 'LHC exit: 7 steps' : 'Entrance: 7 steps', 'warn']); }
    return `<ul class="strip" aria-label="On this route">${c.map(([i, t, k]) => `<li class="${k}">${I(i, 'sm')}${t}</li>`).join('')}</ul>`;
  }
  let lastScreen = null;
  function render() {
    $('#layersBtn').classList.toggle('navhide', S.screen === 'nav');   // the accessibility layer stays on while navigating
    document.body.dataset.screen = S.screen; document.body.classList.toggle('searching', S.screen === 'home' && S.homeOpen);
    const sh = $('#sheet'); sh.className = 'sheet ' + S.screen;
    $('#navcard').hidden = S.screen !== 'nav';
    $('#recenter').hidden = !(S.screen === 'nav' || S.screen === 'home' || S.screen === 'preview');
    if (S.screen === 'home' && !S.homeOpen) {
      sh.className = 'sheet home mini';
      sh.innerHTML = `<h1 class="sr">Where to?</h1><button class="pillsearch" data-act="openSearch" aria-label="Where to? Search a building or place">${I('search')}<span>Where to?</span></button>`;
    } else if (S.screen === 'home') {
      sh.className = 'sheet home open';
      const counts = {}; DEST.forEach(d => counts[d.cat] = (counts[d.cat] || 0) + 1);
      sh.innerHTML = `<div class="grab" aria-hidden="true"></div>
        <div class="srchrow"><button class="x" data-act="closeSearch" aria-label="Close search">${I('back')}</button>
          <div class="srch">${I('search')}<input id="q" type="search" placeholder="Search a building or place" aria-label="Search a building or place" autocomplete="off" value="${esc(S.q)}"></div></div>
        <p class="here">From <button class="link" data-act="from" aria-label="From ${START[S.from].name}. Change starting point"><b>${START[S.from].name}</b> <span class="chg">· Change</span></button></p>
        <div class="cats" role="group" aria-label="Type of place">${CATS.map(c => `<button class="cat" data-act="cat" data-v="${c}" aria-pressed="${S.cat === c}"><span>${c}</span></button>`).join('')}</div>
        <h2 class="lh">${S.cat === 'All' ? 'All places' : esc(S.cat)}</h2>
        <ul class="list" id="results" aria-label="Places">${results()}</ul>`;
    } else if (S.screen === 'preview') {
      const R = S.R;
      sh.innerHTML = `<div class="grab" aria-hidden="true"></div>
        <div class="titlerow"><div class="tt"><h1 tabindex="-1">${esc(R.destName)}</h1><button class="fromlink" data-act="from" aria-label="From ${START[S.from].name}. Change starting point">From ${START[S.from].name}</button></div><button class="x" data-act="close" aria-label="Close and choose another place">${I('close')}</button></div>
        <div class="seg2" role="radiogroup" aria-label="How are you travelling?">
          <button role="radio" aria-checked="${S.prof === 'wheelchair'}" data-act="prof" data-v="wheelchair">${I('chair')}Wheelchair</button>
          <button role="radio" aria-checked="${S.prof === 'pedestrian'}" data-act="prof" data-v="pedestrian">${I('walk')}Walking</button></div>
        <p class="big">${fmtT(R.total, S.prof)}<small>${fmtM(R.total)}${S.prof === 'wheelchair' ? ' · step-free' : ''}</small></p>
        ${strip(R)}
        <button class="go" data-act="go" aria-label="Start directions to ${esc(R.destName)}">Start</button>
        <button class="more" data-act="steps" aria-expanded="${S.allSteps}">${S.allSteps ? 'Hide steps' : `See all ${R.list.length} steps`}</button>
        ${S.allSteps ? `<ol class="dirs" aria-label="Directions">${R.list.map(s => `<li><span class="di di-${s.icon}" aria-hidden="true">${I(icon(s.icon))}</span><span><b>${esc(s.text)}</b>${s.sub ? `<br><small>${esc(s.sub)}</small>` : ''}</span></li>`).join('')}</ol>` : ''}`;
    } else if (S.screen === 'nav') {
      sh.innerHTML = `<div class="navbar"><div class="navstats"><b id="remT"></b><span id="remD"></span></div>
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
        <p class="arr"><b>${esc(R.destName)}</b>${R.to !== 'lhc' ? '' : `<br>${R.steps ? 'Use the main entrance ahead of you – it has 7 steps.' : 'Use the wheelchair accessible ramp ahead of you to enter the building.'}`}</p>
        <button class="go wide" data-act="done">Done</button><button class="more" data-act="another">Plan another route</button>`;
    }
    fitControls();
    placeMarkers(); updateCompass();
    if (S.screen !== lastScreen) { lastScreen = S.screen; const h = sh.querySelector('h1') || $('#navcard h2'); if (h && S.screen !== 'home') h.focus({ preventScroll: true }); }
  }
  // ---------------------------------------------------------------- map buttons never overlap the panels
  // The buttons sit above the bottom panel's live height; if there is not enough room between the
  // top controls and the panel, the least important ones hide (? first, then layers, accessibility, compass, recentre).
  const HIDE_ORDER = ['keyBtn', 'layersBtn', 'accessBtn', 'compass', 'recenter'];
  let fitKey = '';
  function refit() { const k = $('#sheet').offsetHeight + ':' + $('#navcard').offsetHeight + ':' + innerHeight; if (k !== fitKey) fitControls(); }
  function fitControls() {
    const root = document.documentElement, sh = $('#sheet'), card = $('#navcard');
    fitKey = sh.offsetHeight + ':' + card.offsetHeight + ':' + innerHeight;
    root.style.setProperty('--sheet-h', sh.offsetHeight + 'px');
    if (!card.hidden) root.style.setProperty('--navcard-h', card.offsetHeight + 'px');
    if (!$('#layersMenu').hidden) return;                       // leave things alone while the layer menu is open
    HIDE_ORDER.forEach(id => document.getElementById(id).classList.remove('nofit'));
    const sheetTop = sh.getBoundingClientRect().top;
    const clash = () => {
      const c = $('.corner').getBoundingClientRect(), e = $('.edge').getBoundingClientRect();
      const cardB = card.hidden ? 0 : card.getBoundingClientRect().bottom;
      return (c.height && (c.bottom > sheetTop - 8 || c.top < cardB)) || (e.height && (e.top < Math.max(c.height ? c.bottom : 0, cardB) + 8 || e.bottom > sheetTop - 4));
    };
    for (const id of HIDE_ORDER) { if (!clash()) break; document.getElementById(id).classList.add('nofit'); }
  }
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => fitControls()); ro.observe($('#sheet')); ro.observe($('#navcard')); }
  window.addEventListener('resize', fitControls);
  if (window.visualViewport) visualViewport.addEventListener('resize', fitControls);

  function results() {
    const q = S.q.trim().toLowerCase();
    const list = DEST.filter(d => d.id !== S.from && (S.cat === 'All' || d.cat === S.cat) && (!q || (d.name + ' ' + d.al + ' ' + d.cat).toLowerCase().includes(q)))
      .map(d => ({ ...d, ready: canGo(S.from, d.id) })).sort((a, b) => b.ready - a.ready);
    if (!list.length) return `<li class="empty">No place matches “${esc(S.q)}”.</li>`;
    return list.map(d => {
      if (!d.ready) return `<li><div class="item off" aria-label="${esc(d.name)}, directions coming soon"><span class="badge">${I(CI[d.cat] || 'building')}</span><span><span class="nm">${esc(d.name)}</span><span class="sb">${d.cat} · Directions coming soon</span></span></div></li>`;
      const r = buildRoute(S.prof, S.from, d.id);
      return `<li><button class="item" data-act="pick" data-id="${d.id}" aria-label="${esc(d.name)}, ${fmtT(r.total, S.prof)}, ${fmtM(r.total)}"><span class="badge ready">${I(CI[d.cat] || 'building')}</span><span><span class="nm">${esc(d.name)}</span><span class="sb ok">${d.cat} · Directions ready</span></span></button></li>`;
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
    const t = $('#remT'); if (t) { t.textContent = fmtT(rem, S.prof); $('#remD').textContent = `${fmtM(rem)} left · ${R.destName}`; }
    refit();
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
    S.viewBeforeNav = S.view; if (S.view !== 'accessibility') setView('accessibility');
    S.screen = 'nav'; S.pos = 0; S.play = false; S.follow = true; S.said = {}; S.off = 0; S.navNorth = false;
    render(); camNav(true); keepAwake(true); speak(say(S.R.man[0]));
    locOff(); if (!S.test) gpsOn(); else $('#gpsline').textContent = 'Test mode: walk is simulated.';
  }
  // ---- where the phone is, shown before navigation starts (during navigation the route-snapped position is used)
  const distM = (a, b) => { const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos((a[1] + b[1]) / 2 * r), y = (b[1] - a[1]) * r; return Math.hypot(x, y) * 6371000; };
  function locOn() {
    if (S.locWatch != null || !navigator.geolocation || !window.isSecureContext) return;
    S.locWatch = navigator.geolocation.watchPosition(p => {
      if (p.coords.accuracy > 60) return;
      const ll = [p.coords.longitude, p.coords.latitude];
      S.here = distM(ll, startLL()) < 2500 ? ll : null;          // far from campus: keep showing the QR sign's spot
      if (S.screen !== 'nav' && S.screen !== 'arrived') placeMarkers();
    }, () => { S.here = null; if (S.screen !== 'nav') placeMarkers(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
  function locOff() { if (S.locWatch != null) navigator.geolocation.clearWatch(S.locWatch); S.locWatch = null; }
  function leaveNav() { gpsOff(); S.play = false; if (!S.test) locOn(); keepAwake(false); resetPadding(); if (backLine) backLine.style.display = 'none'; }
  function stopNav(to) { leaveNav(); if (S.viewBeforeNav && S.viewBeforeNav !== S.view) setView(S.viewBeforeNav); S.viewBeforeNav = null; S.screen = to; render(); if (to === 'preview') camRoute(true); }
  function arrive() { leaveNav(); S.pos = S.R.total; S.screen = 'arrived'; render(); camRoute(true); }

  // ---- live GPS, snapped onto the route
  function gpsLine(t) { const l = $('#gpsline'); if (l) l.textContent = t; refit(); }
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
      if (++S.off >= 3) { $('#offroute').hidden = false; refit(); if (S.off === 3) speak('You are off the route. Head back to the coloured path.'); }
      gpsLine(`About ${Math.round(best.off)} m from the route`);
      rawM.setLngLat(ll).addTo(map); backLine.setAttribute('points', [q, best.pt].map(p => p.join(',')).join(' ')); backLine.style.display = '';
      return;
    }
    S.off = 0; $('#offroute').hidden = true; refit(); rawM.remove(); backLine.style.display = 'none';
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
  function setFrom(k) { S.from = k; $('#fromModal').hidden = true; if (S.to && canGo(k, S.to)) pick(S.to); else if (S.to) home(); else { render(); camHome(true); } }
  function home() { S.to = null; S.R = null; S.homeOpen = false; S.q = ''; S.cat = 'All'; drawRoute(); S.screen = 'home'; render(); camHome(true); }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) { if (e.target.id === 'fromModal') $('#fromModal').hidden = true; if (e.target.id === 'keyModal') $('#keyModal').hidden = true; if (e.target.id === 'a11yModal') closeA11y();
      if (!e.target.closest('#layersMenu')) { $('#layersMenu').hidden = true; $('#layersBtn').setAttribute('aria-expanded', 'false'); fitControls(); } return; }
    const a = t.dataset.act;
    if (a === 'pick') pick(t.dataset.id);
    else if (a === 'openSearch') { S.homeOpen = true; render(); const q = $('#q'); if (q) q.focus(); }
    else if (a === 'closeSearch') { S.homeOpen = false; S.q = ''; S.cat = 'All'; render(); camHome(true); }
    else if (a === 'cat') { S.cat = t.dataset.v; document.querySelectorAll('[data-act=cat]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.cat))); $('#results').innerHTML = results(); $('.lh').textContent = S.cat === 'All' ? 'All places' : S.cat; }
    else if (a === 'close') home();
    else if (a === 'from') openFrom();
    else if (a === 'closeFrom') $('#fromModal').hidden = true;
    else if (a === 'setFrom') setFrom(t.dataset.id);
    else if (a === 'prof') { if (S.prof !== t.dataset.v) { S.prof = t.dataset.v; store.set('prof', S.prof); pick(S.to); } }
    else if (a === 'steps') { S.allSteps = !S.allSteps; render(); }
    else if (a === 'go') startNav();
    else if (a === 'end') stopNav('preview');
    else if (a === 'play') { S.play = !S.play; if (S.play && S.pos >= S.R.total - 2) S.pos = 0; S.follow = true; t.textContent = S.play ? 'Pause' : 'Play'; }
    else if (a === 'speed') { S.mult = +t.dataset.v; document.querySelectorAll('[data-act=speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === S.mult))); }
    else if (a === 'voice') { S.voice = !S.voice; store.set('voice', S.voice ? '1' : '0'); $('#navcard').dataset.k = ''; updateNav(); if (S.voice) speak('Voice guidance on'); }
    else if (a === 'recenter') { if (S.screen === 'preview') camRoute(true); else if (S.screen === 'home') { const c = S.here || (S.raw && S.raw.ll); if (c) map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 17), duration: dur(600) }); else camHome(true); } else { S.follow = true; camNav(true); } }
    else if (a === 'wayback') wayBack();
    else if (a === 'again') { S.pos = 0; S.screen = 'preview'; render(); camRoute(true); }
    else if (a === 'done') { home(); if (S.orient === 'drawn') map.easeTo({ bearing: drawnBearing(), duration: dur(500) }); }
    else if (a === 'compass') compassTap();
    else if (a === 'key') openKey();
    else if (a === 'access') openA11y();
    else if (a === 'closeA11y') closeA11y();
    else if (a === 'a11yToggle') { const k = t.dataset.k; A11Y[k] = !A11Y[k]; applyA11y(true); }
    else if (a === 'a11yStep') { const k = t.dataset.k; A11Y[k] = clampA(k, A11Y[k] + (+t.dataset.d) * A11Y_RNG[k][2]); applyA11y(true); }
    else if (a === 'a11yReset') { Object.assign(A11Y, A11Y_DEF); applyA11y(true); $('#a11yMsg').textContent = 'Settings reset to default'; }
    else if (a === 'another') { home(); S.homeOpen = true; render(); const q = $('#q'); if (q) q.focus(); }
    else if (a === 'closeKey') $('#keyModal').hidden = true;
    else if (a === 'layers') { const m = $('#layersMenu'); m.hidden = !m.hidden; t.setAttribute('aria-expanded', String(!m.hidden)); e.stopPropagation(); fitControls(); }
    else if (a === 'view') setView(t.dataset.v);
  });
  document.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; $('#results').innerHTML = results(); } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'q') { const b = document.querySelector('#results button.item'); if (b) b.click(); }
    if (e.key === 'Escape' && !$('#a11yModal').hidden) { closeA11y(); return; }
    if (e.key === 'Escape') { if (S.screen === 'home' && S.homeOpen && $('#keyModal').hidden && $('#fromModal').hidden) { S.homeOpen = false; render(); } $('#keyModal').hidden = true; $('#fromModal').hidden = true; $('#layersMenu').hidden = true; }
  });
  map.on('dragstart', () => { if (S.screen === 'nav') S.follow = false; });
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
  applyA11y(false);
  (function waitArt() { if (window.ARTWORK_API) { applyA11y(false); if (!S.test) locOn(); } else setTimeout(waitArt, 300); })();
  setTimeout(() => camHome(false), 50);
  requestAnimationFrame(frame);
  window.__app = { S, buildRoute, pick, startNav, updateNav, camNav, openKey, setView, openA11y, A11Y, applyA11y };
})();
