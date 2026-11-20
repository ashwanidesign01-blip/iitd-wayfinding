/* Campus settings. Coordinates are [longitude, latitude] (MapLibre order). */
window.CAMPUS = {
  name: 'IIT Delhi (Hauz Khas)',
  // Approximate centre of the academic core (Main Building area). Adjust after Step 2.
  center: [77.1926, 28.5450],
  zoom: 16.2,
  minZoom: 14.5,
  maxZoom: 20,
  // Generous box around the campus so users can't pan away. Tighten once the campus outline is fixed.
  maxBounds: [[77.170, 28.530], [77.215, 28.560]]
};

/* Base map styles.
   - campus: free vector tiles from OpenFreeMap (OpenStreetMap data, no API key), recoloured to your palette.
   - osm:    the standard OpenStreetMap raster tiles, for comparison. Fine for a POC; for real launch
             traffic use a tile provider (OpenStreetMap's tile servers have a fair-use policy). */
window.BASEMAPS = {
  campus: 'https://tiles.openfreemap.org/styles/positron',
  osm: {
    version: 8,
    // fonts for our own labels (the raster tiles have their labels baked in)
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256, maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
  }
};

window.PALETTE = {          // sampled from your full-campus artwork
  ground:       '#F3F0E8',
  lawn:         '#D4D584',
  building:     '#E4E3D7',
  buildingEdge: '#C9C8BA',
  road:         '#C0BAB2',
  roadCasing:   '#ADA79F',
  footpath:     '#F7F5EF',
  water:        '#B8C8C9',
  label:        '#565550',
  labelHalo:    '#FFFFFF'
};


/* ---------- Step 2: your campus artwork, georeferenced ----------
   All five layers share one frame: 1670.81 x 768.86 SVG units (Layer 1 is shifted up 26.32 units to match).
   Control pairs: the same place in SVG units [x, y] and on the ground [lng, lat] (your Step 1 points).
   Gate positions in the artwork were read from where each gate road meets the campus edge. */
window.ARTWORK = {
  frame: { width: 1670.81, height: 768.86 },
  control: [
    { name: 'Lecture Hall Complex', svg: [551, 401],  lngLat: [77.1932481, 28.5430735] },
    { name: 'IIT Hospital',         svg: [1031, 488], lngLat: [77.1880213, 28.5459625] },
    { name: 'Main Building',        svg: [673, 537],  lngLat: [77.1924406, 28.5449952] },
    { name: 'Zanskar Hostel',       svg: [1166, 494], lngLat: [77.1861720, 28.5469602] },
    { name: 'Gate 1',               svg: [399, 712],  lngLat: [77.1965318, 28.5458518] },
    { name: 'Gate 2',               svg: [55, 598],   lngLat: [77.2003959, 28.5427373] },
    { name: 'Gate 3',               svg: [33, 295],   lngLat: [77.1990016, 28.5395160] },
    { name: 'Gate 4',               svg: [1293, 30],  lngLat: [77.1823221, 28.5422582] },
    { name: 'Gate 5',               svg: [1635, 228], lngLat: [77.1792175, 28.5460433] },
    { name: 'Gate 6',               svg: [1370, 698], lngLat: [77.1849766, 28.5498852] }
  ],
  // Fine-tune on top of the fit (use the panel, then paste "Copy alignment" here).
  adjust: { eastM: 0, northM: 0, rotateDeg: 0, scalePct: 100 },
  opacity: 1,
  // Drawn live as vectors (crisp at every zoom). Detail by zoom: Layer 1 zoomed out, Layer 2 in between,
  // Layer 3 close up. Views: Accessibility shows Layer 4, Parking shows Layer 5 (from zoom 16 up).
  layers: [
    { id: 'L1', minzoom: 0,  maxzoom: 16, views: ['standard', 'accessibility', 'parking'] },
    { id: 'L2', minzoom: 16, maxzoom: 17, views: ['standard'] },
    { id: 'L3', minzoom: 17, maxzoom: 25, views: ['standard'] },
    { id: 'L4', minzoom: 16, maxzoom: 25, views: ['accessibility'] },
    { id: 'L5', minzoom: 16, maxzoom: 25, views: ['parking'] }
  ]
};

/* Landmarks you recorded in Step 1 (shown as check dots). */
window.LANDMARKS = window.ARTWORK.control.map(c => [c.name, c.lngLat[1], c.lngLat[0]]);
