# Génesis · Viva Lago Country — interactive architectural experience

A static website for **Génesis Negocios Inmobiliarios** (Ciudad del Este, Paraguay) in which a visitor explores Viva Lago Country, selects a lot and watches a contemporary residence being built on it, stage by stage, in a real-time 3D scene at golden hour.

> **Status: surveyed layout.** Lots, streets, numbering and surfaces come from the georeferenced subdivision plan (*Proyecto de Loteamiento Georreferenciado*, Finca 18.485, 1/1.000, UTM 21S / WGS 84): 32 lots in blocks A–E, the Club Náutico & Deportivo, the administration parcel, the nautical access to the río Acaray, the main avenue and streets 1 and 2. Logos and brand colours come from Génesis' sales brochure. **Prices and financing are deliberately not published**; availability is shown only where a Génesis document states it (C-02 sold). Vegetation, relief, surroundings and the residence are a recreation. See [What Génesis still needs to supply](#what-génesis-still-needs-to-supply).

## Run it

Any static file server works; there is no build step.

```sh
cd genesis
npm run serve          # http://localhost:5173 (Node ≥ 18, no install needed)
```

Development tasks need the devDependencies (`npm install`):

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests: construction clock and plan (trade order, course-by-course masonry, clean finish), state machine, lot geometry, camera shots, inquiry honesty, data |
| `npm run check` | Parses every first-party module |
| `npm run e2e` | Headless Chromium end-to-end run (desktop, mobile, no-WebGL fallback). Uses the pre-installed Playwright |
| `npm run vendor` | Re-copies three.js, ez-tree, tree textures and the HDRI from `node_modules` into `vendor/` and `assets/` |
| `npm run textures` | Regenerates the procedural PBR textures (Python 3 + NumPy + Pillow) |
| `node tools/capture-renders.mjs` | Re-renders the overview poster and the closing image with the engine itself (options: `--variant=desktop` or `mobile`, `--only=overview` or `closing`; `--only=hero` replaces the path-traced hero sequence with engine frames) |
| `node tools/cinematic/make-film.mjs --lot=B-05 [--hero]` | Path-traced construction film of a lot (see **Cinematic films**); resumable; `--hero` makes the home page sequence and stage viewer use it |
| `node tools/perf.mjs` | Load measurement in headless Chromium, desktop and a throttled phone profile: LCP (and its element), CLS, long-task blocking, bytes until load vs. streamed after |
| `python3 tools/survey/extract-plan.py plan.pdf > tools/survey/plan-extract.json` | Reads the surveyor's vector PDF: fits the drawing to the four UTM monuments and polygonizes the line work (Python 3 + pdfplumber, shapely, NumPy) |
| `python3 tools/survey/build-masterplan.py tools/survey/plan-extract.json > js/data/masterplan.js` | Identifies blocks and lots, checks every drawn area against the plan's surface table (fails above 3 %; currently 0.23 %), picks each lot's street front and writes the data module |

`tools/harness.html` loads the experience alone (with `?tier=low|high`, `?reduced`) and exposes `window.xp` for inspection; `tools/shoot.mjs` captures it in headless Chromium for given lots, construction progress and camera poses; `tools/tree-lab.html` renders the vegetation species side by side with their triangle cost.

## The page

**Hero** (scroll-scrubbed construction: the B-05 path-traced film, dissolving between frames) → **El desarrollo** (verified figures: 2 ha, 32 lots, 365,80–511,56 m², 7.599,23 m² of common areas) → **Ubicación** (address from the plan, WGS 84 coordinates computed from the UTM monuments by `js/core/geo.js` and checked against PROJ in the unit tests, Génesis' Google Maps pin, a site sketch drawn from the data) → **Lotes** (the lot browser: plan, block filter, sortable list, lot sheet; the plan turns upright on phones so lots stay ≥ 20 px to tap; works without WebGL) → **Áreas comunes** (the plan's common-area table, each with a key plan) → **De la obra a la casa** (the eight construction stages under the visitor's control: stage buttons showing a representative frame each, plus a scrubber; same lot and camera as the hero) → **Recorrido 3D** → **Comercializa / de dónde sale cada dato** → closing image (the finished concept from the garden) → **Contacto** (preferred channel and topic travel with the inquiry; the required field follows the chosen channel). From a lot sheet, "Ver la construcción en 3D" opens the explorer on that lot and "Consultar por este lote" carries the lot into the contact form.

Loading: only the first hero frame (chosen per orientation with `<picture>`) loads with the page; the other frames stream once the browser is idle or on first scroll (not at all before scrolling with Data Saver), and are decoded off the main thread. Sections below the fold (location sketch, lot browser, stage viewer, common areas) are built when they approach the viewport. Measured with `tools/perf.mjs` (headless, median of 3) with the path-traced frames: desktop LCP ≈ 150 ms, CLS 0.001; throttled phone LCP ≈ 540 ms, blocking ≈ 170 ms, 186 KB of images before load. The hero's 12 frames dissolve into each other as the visitor scrolls (construction progress = scroll position), so the short path-traced sequence reads as continuous.

Design tokens live at the top of `css/genesis.css` (colour, type, spacing, motion: `--ease-out` = `cubic-bezier(0.16, 1, 0.3, 1)`, `--dur-*`); only colours, opacity and transforms are animated, and `prefers-reduced-motion` turns entrances off.

## The experience

**Overview → select → approach → construction → reveal → explore.** The concept residence is fitted to each lot: its plan is scaled across the frontage and into the depth (never in height) and moved inward on curved street fronts, so the house, terraces and pool always stay inside the surveyed polygon (tested for all 32 lots). Selecting a lot (click/tap on the ground, or the accessible list) immediately starts the approach; there is no confirmation step. Construction begins on arrival, plays for ~26 s, and can be paused, scrubbed by stage, replayed, finished early or left at any time. The camera can be taken over at any moment; a drag never breaks the sequence.

Construction runs on **one continuous clock** (`js/core/timeline.js`) shared by ~50 components of the actual model (`js/experience/house/residence.js`), each with its own window in that clock:

1. Site clearing (grass gives way to dark, damp topsoil in the terrain shader), batter boards and string lines, sand delivery
2. Excavation in damp dark earth, ground beams and pads with steel base plates and anchor bolts, the *contrapiso* slab poured front-to-back, the pool shell
3. Steel columns and I-beams erected on base plates, formwork props and plywood decks, slabs poured and curing (wet concrete darkens then dries), scaffolding rising with the frame
4. Brick infill (*ladrillo común*) laid course by course, a brick delivery that is used up
5. Render applied top-down, stone cladding laid bottom-up, timber cladding, gravel roof and terrace pavers, timber soffits, metal copings, timber screen
6. Windows and doors set in from inside, the garage door lowered, glass balustrades
7. Scaffolding struck, formwork stripped, paving, deck, pool coping, tiling and filling, lawn returning, planting growing in
8. Interior and soffit lights warm up for the final reveal

Partially built elements are cut with per-component clipping planes in house space; back faces exposed by the cut are shaded with the cut's normal so walls read as solid while they rise (`js/experience/house/construction.js`). Finished components switch back to shared materials.

## Structure

```
index.html, css/genesis.css     page and design system
js/main.js                      page bootstrap (header, reveals, hero, location, lot browser, common areas, contact, deep links)
js/ui/lot-browser.js            plan + filter + list + lot sheet
js/ui/site-maps.js              location sketch and key plans (SVG from the survey data)
js/explorer.js                  overlay UI for the experience + 2D fallback
js/hero-sequence.js             scroll-driven construction sequence in the hero
js/core/                        pure logic, unit-tested: timeline, state machine, lot geometry, UTM→WGS 84, inquiry, formatting
js/data/masterplan.js           GENERATED from the survey: lots, roads, nautical access, river edge, monuments
js/data/viva-lago.js            development data on top of it: facts, availability, concept fitting, lake
js/config/brand.js, contact.js  logos/colours (from the brochure) and contact channels (empty until supplied)
js/experience/                  three.js scene: renderer, environment, terrain, lots, vegetation, camera, residence
tools/                          vendor, texture generation, render capture, static server, harness
tools/survey/                   plan extraction (PDF → georeferenced polygons → js/data/masterplan.js)
tests/unit, tests/e2e           node:test suites and the Playwright run
vendor/                         three.js r184 (+ used addons) and ez-tree's generator (both MIT)
assets/                         fonts (OFL), textures (generated), trees, HDRI (CC0), renders, brand (logos)
```

## Rendering

- Physically based materials with metre-scale UVs; textures generated by `tools/generate-textures.py` (render, board-formed concrete, ceramic brick, random-ashlar stone, hardwoods, lawn, red soil, asphalt, gravel, pavers, phenolic plywood).
- Golden-hour light: Preetham sky (with sky exposure control), a low WNW sun with frustum-fitted shadows, image-based lighting from a CC0 Poly Haven HDRI. Fog colour is computed from the same sky model in the view direction, so distant land dissolves into the actual sky.
- Scene rendered to a multisampled HDR target; on the high tier GTAO uses that target's depth (so clipped geometry never casts AO ghosts); ACES filmic tone mapping in a single output pass.
- Vegetation: ez-tree geometry re-lit with crown normals and leaf translucency, instanced with per-tree colour; pindó palms are procedural; the wider landscape uses baked impostors; the finished garden gets an instanced lawn.
- Tiers (`js/experience/quality.js`): phones and low-memory devices drop AO, the detailed lawn, half the trees and use smaller shadow maps. Rendering is on demand (the loop stops when nothing moves) and the pixel ratio adapts if frames stay slow. Everything is disposed when the overlay closes.
- No WebGL, a failed start or a lost context switch to a 2D plan (drawn from the same lot data) with the same lot panel and inquiry, plus pre-rendered stage stills.

## Cinematic films (path-traced)

The construction can also be shown as a sequence of offline renders, so the images after selecting a lot read like architectural photography rather than real-time graphics:

1. `tools/cinematic/export-scene.mjs` opens the engine headless, freezes it at each construction moment and exports the scene as GLB (the residence per moment, the site once), with each partially built component's clipping planes, plus top-down bakes of the terrain (near the lot and the whole site) and the camera.
2. `tools/cinematic/render.py` (Blender 5 as a Python module, Cycles, CPU) imports them, cuts the clipped components with capped bisections, rebuilds glass, water and plaster, lights the scene with a physical sky and a warm low sun, grows hair grass only on lawn (mask from the bake minus paving, roads and buildings), renders to EXR and denoises (OIDN); `grade.py` applies the ACES-based grade.
3. `make-film.mjs` runs the whole chain for 12 construction moments × desktop (1600×900) and mobile (720×1280) framings, writes WebP frames to `assets/cinematic/<lot>/` and the manifest. About 5 min per desktop frame at 64 samples on a container CPU.

In the explorer (`js/ui/cinema.js`), the real-time camera lands exactly on the film's framing for the film's own lot and the film takes over: frames follow the construction clock and dissolve into each other with a slow push-in, while the scene underneath stops drawing. “Vista 3D interactiva” (or touching the film) hands back the live scene; the clock keeps running underneath. Lots without their own film show the film of the lot facing the most similar way, captioned **“Render de referencia … lote X”**; they never claim to be their own lot. Films exist today for B-05 (north row) and E-07 (south row).

## Commercial integrity

- The lot panel shows the plan's surfaces (own area, proportional common area, total and co-ownership share) and the approximate frontage × depth of the drawing. Price and financing always read **“Consultar con un asesor”**; `priceUSD` and `financing` stay `null` and a unit test fails if either is set.
- Availability is shown only with a documented source (`KNOWN_AVAILABILITY` in `js/data/viva-lago.js`): today only C-02, marked sold in the brochure. The brochure numbers blocks 1–5; the plan letters them A–E (1 = C, 2 = D, 3 = B, 4 = E, 5 = A).
- The residence is labelled as a conceptual visualisation adapted to the lot, not included in the lot price and not approved for construction.
- The inquiry form keeps the selected lot. It reports **sent** only when a configured endpoint answers 2xx; WhatsApp/e-mail are reported as hand-offs; with no channel configured (the current state) it says nothing was sent and offers the text to copy.
- The plan's personal data (owner, ID numbers, professional) is not published anywhere on the site, and the plan PDF itself is not part of the repository; `tools/survey/plan-extract.json` keeps only the drawing's geometry and labels.

## What Génesis still needs to supply

1. **Contact channel**: WhatsApp number, sales e-mail and/or an HTTPS inquiry endpoint → `js/config/contact.js`.
2. **Availability per lot** (if it should be public) → `KNOWN_AVAILABILITY`, with its source.
3. Optionally, a professionally designed residence as a GLB with components split by trade, to replace the concept model.

## Assets and licences

| Asset | Source | Licence |
| --- | --- | --- |
| three.js r184 | npm `three` | MIT |
| Tree generator | npm `@dgreenheck/ez-tree` (geometry only) | MIT |
| Bark textures | Poly Haven via ez-tree | CC0 |
| Leaf cards | ez-tree package | MIT |
| HDRI “sunrise” | Poly Haven via npm `@pmndrs/assets` | CC0 |
| Instrument Serif, Geist, Geist Mono | Google Fonts | SIL OFL 1.1 (`assets/fonts/OFL-*.txt`) |
| Architectural textures, renders | Generated by this project's tools | Project |
| Génesis and Viva Lago Country logos | Génesis' sales brochure (GENESIS LOTE, March 2026) | Génesis (trademarks) |
| Subdivision geometry | Proyecto de Loteamiento Georreferenciado (Finca 18.485) | Génesis / owner |
