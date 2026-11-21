# IIT Delhi Accessible Wayfinding – proof of concept

Live app: https://ashwanidesign01-blip.github.io/iitd-wayfinding/

QR start points:
- Main Gate 1: https://ashwanidesign01-blip.github.io/iitd-wayfinding/#qr-gate
- Zanskar Hostel: https://ashwanidesign01-blip.github.io/iitd-wayfinding/#qr-zanskar


Built one layer at a time, following the agreed architecture:

| # | Layer | Status |
|---|-------|--------|
| 1 | Base map: OSM tiles via MapLibre GL JS | **done** |
| 2 | Campus graphics: your 5 artwork layers, georeferenced | **done (about 16 m average error, fine-tune in the panel)** |
| 3 | Accessible network: GeoJSON paths + ramps, lifts, entrances | **2 wheelchair routes, hand-drawn by the designer (Layer 7)** |
| 4 | Segment attributes: slope, surface, width, steps, covered, lit | |
| 5 | Routing: client-side, accessibility-weighted | **route preview + turn-by-turn directions for the 2 test routes** |
| 6 | Search: destinations with aliases | **done (LHC routed; other buildings listed as not mapped yet)** |
| 7 | Location: browser GPS, snapped to paths | **built (live GPS needs the https hosting in Step 8); simulation for testing** |
| 8 | Hosting: GitHub Pages + QR codes | |

## View it on your computer
The page loads the map library and tiles from the internet, so you need to be online.

Simplest: unzip the whole folder, then double-click `index.html` (keep the `data`, `js` and `css` folders next to it).
For faster loading, or if anything stays blank, run a tiny local server in this folder instead:

    python3 -m http.server 8000

then open http://localhost:8000

## Files
- `index.html` – page shell
- `css/app.css` – styles (your dark-sheet UI)
- `js/config.js` – campus centre, bounds, base maps, palette  ← edit here
- `js/map.js` – map setup, palette recolouring, control-point recorder
- `js/artwork.js` – places the artwork layers from your control points; views, orientation, opacity, fine-tune
- `data/artwork-svg.js` – your five SVG layers, prepared for the map (drawn live as vectors)
- `data/source-svg/` – your original SVGs
- `data/source-svg/Layer_7_wheelchair_routes.svg`, `Layer_8_pedestrian_routes.svg` – your hand-drawn routes
- `data/routes.js` – your routes as a small network (wheelchair from the revised Layer 7, same frame as Layer 3; pedestrian from Layer 8)
- Short red sections (25 m or less) with footpath on both sides are read as **road crossings**: the steps and navigation say "Cross the road" towards the destination, and the summary counts crossings apart from stretches along the road.
- `data/routes.geojson` – the same routes in real coordinates
- `js/app.js` – the app: home + search, route preview (Step-free on/off), navigation (live GPS or simulated), arrival

QR codes: open the app address ending in `#qr-gate` (Main Gate 1) or `#qr-zanskar` (Zanskar Hostel).

### Updating the artwork
Export the changed layer as SVG into `data/source-svg/`, then ask Claude to regenerate `data/artwork-svg.js`.
Keep the same artboard (1670.81 x 768.86) so the alignment stays valid.
- `data/` – GeoJSON for later steps

Map data © OpenStreetMap contributors. Vector tiles: OpenFreeMap.

## UX (Nov 2026 pass)
- Compass (top right): needle shows north; tap to switch north-up / as drawn (or heading-up / north-up while navigating).
- **?** map key (top right): legend for your route plus the layer on screen.
- One layers button (Standard / Accessibility / Parking) and recentre on the right edge; zoom buttons, scale bar and tools removed.
- Preview: Wheelchair / Walking switch (Wheelchair by default, remembered), accessibility strip, steps collapsed.
- Navigation: lighter card with voice button, early warnings for steep and road sections, calm off-route prompt with "Show the way back", live GPS starts automatically.
- Accessibility: Go button darkened to #C2570C (4.5:1), dark icons on orange/blue tiles, dotted pattern on steep and dashed on road sections, labelled controls, focus moves to each new screen, reduced motion respected.
- Design-team tools: add `#tools` to the address. Test mode there simulates the walk instead of GPS.

## Accessibility settings

The accessibility button (top right, under the compass) opens a settings panel. Everything applies immediately and is saved on the phone.

- **Text size** 100–200% (panels and map labels), **Letter spacing** 0–3 px, **Line height** 1.2–2.4×, each with − / + buttons as well as a slider.
- **High contrast**: stronger outlines, darker text, bold map labels. Turns on by itself the first time if the phone's Increase Contrast setting is on.
- **Grayscale**, **Negative contrast** (inverted colours) and **Light background** (on by default; off gives dark panels).
- **Reset to default** restores everything. The accessibility map layer is in the Layers menu.
