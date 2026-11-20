(function () {
  const C = window.CAMPUS, P = window.PALETTE;
  const $ = s => document.querySelector(s);
  const msg = t => { $('#msg').textContent = t || ''; };

  const map = new maplibregl.Map({
    container: 'map',
    style: window.BASEMAPS.campus,
    center: C.center, zoom: C.zoom,
    minZoom: C.minZoom, maxZoom: C.maxZoom,
    maxBounds: C.maxBounds,
    attributionControl: { compact: true },
    dragRotate: true, pitchWithRotate: false, maxPitch: 0
  });

  /* ---------- recolour the OSM vector style to the campus palette ---------- */
  let currentStyle = 'campus';
  function set(id, prop, val) { try { map.setPaintProperty(id, prop, val); } catch (e) { /* layer lacks prop */ } }
  function applyCampusPalette() {
    if (currentStyle !== 'campus') return;
    for (const l of map.getStyle().layers) {
      const src = l['source-layer'] || '', id = l.id, t = l.type;
      const f = JSON.stringify(l.filter || '');
      if (t === 'background') set(id, 'background-color', P.ground);
      else if (src === 'water' && t === 'fill') set(id, 'fill-color', P.water);
      else if (src === 'waterway' && t === 'line') set(id, 'line-color', P.water);
      else if ((src === 'park' || src === 'landcover' || src === 'landuse') && t === 'fill') {
        set(id, 'fill-color', P.lawn); set(id, 'fill-opacity', 0.7);
      }
      else if (src === 'building' && t === 'fill') {
        set(id, 'fill-color', P.building); set(id, 'fill-outline-color', P.buildingEdge); set(id, 'fill-opacity', 1);
      }
      else if (src === 'building' && t === 'fill-extrusion') set(id, 'fill-extrusion-color', P.building);
      else if (src === 'transportation' && t === 'line') {
        const isPath = /path|pedestrian|footway|track/.test(f) || /path|pedestrian/.test(id);
        const isCasing = /casing|outline/.test(id);
        set(id, 'line-color', isPath ? P.footpath : (isCasing ? P.roadCasing : P.road));
      }
      else if (t === 'symbol') {
        set(id, 'text-color', P.label); set(id, 'text-halo-color', P.labelHalo);
      }
    }
  }
  // If the base map can't load (offline, or a preview that blocks map servers), show the artwork on a plain background.
  const BLANK = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': P.ground } }] };
  let styleOk = false, fellBack = false;
  function fallBack() {
    if (styleOk || fellBack) return; fellBack = true; currentStyle = 'blank'; map.setStyle(BLANK);
    msg('Base map tiles could not load here, so only your artwork is shown.');
  }
  setTimeout(fallBack, 8000);
  map.on('style.load', () => { if (currentStyle !== 'blank') styleOk = true; applyCampusPalette(); drawPoints(); });
  map.on('error', e => {
    if (!styleOk) { fallBack(); return; }
    const m = (e && e.error && e.error.message) || 'unknown error';
    msg('Map error: ' + m + ' (check your internet connection).');
  });

  /* ---------- base map switcher ---------- */
  document.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.style; if (key === currentStyle) return;
    currentStyle = key;
    document.querySelectorAll('[data-style]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    map.setStyle(window.BASEMAPS[key]);
  }));

  /* ---------- pointer coordinates ---------- */
  const fmt = ll => `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
  map.on('mousemove', e => { $('#coords').textContent = fmt(e.lngLat); });

  /* ---------- control-point recorder (feeds Step 2: aligning your artwork) ---------- */
  const points = []; const markers = [];
  function drawPoints() {
    markers.forEach(m => m.remove()); markers.length = 0;
    points.forEach((p, i) => {
      const el = document.createElement('div'); el.className = 'cp-marker'; el.textContent = i + 1;
      markers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map));
    });
    $('#points').innerHTML = points.map((p, i) =>
      `<li>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}<input data-i="${i}" placeholder="name, e.g. LHC NW corner" value="${p.name.replace(/"/g, '&quot;')}"></li>`).join('');
    $('#pointActions').hidden = points.length === 0;
  }
  map.on('click', e => {
    $('#coords').textContent = fmt(e.lngLat);
    if (!$('#pickMode').checked) return;
    points.push({ lat: e.lngLat.lat, lng: e.lngLat.lng, name: '' });
    drawPoints(); msg(`Point ${points.length} recorded. Name it after the landmark you clicked.`);
  });
  $('#points').addEventListener('input', e => { if (e.target.dataset.i) points[+e.target.dataset.i].name = e.target.value; });
  $('#clearPoints').addEventListener('click', () => { points.length = 0; drawPoints(); msg(''); });
  $('#copyPoints').addEventListener('click', async () => {
    const txt = 'name,lat,lng\n' + points.map(p => `${p.name || 'unnamed'},${p.lat.toFixed(7)},${p.lng.toFixed(7)}`).join('\n');
    try { await navigator.clipboard.writeText(txt); msg('Copied. Paste the points into our chat.'); }
    catch (e) { msg('Copy was blocked by the browser. Select the list and copy it manually.'); }
  });

  window.__map = map; // handy for debugging in the browser console
})();
