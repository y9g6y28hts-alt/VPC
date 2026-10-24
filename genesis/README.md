# Génesis · Viva Lago Country — interactive architectural experience

A static website for **Génesis Negocios Inmobiliarios** (Ciudad del Este, Paraguay) in which a visitor explores Viva Lago Country, selects a lot and watches a contemporary residence being built on it, stage by stage, in a real-time 3D scene at golden hour.

> **Status: conceptual demonstration.** No official masterplan, parcel survey, inventory, prices, financing terms, contact channels or logo files were available in this repository. The layout, lot numbering, lake and residence are illustrative, every commercial field is `null`, and the interface says so wherever it matters. See [What Génesis needs to supply](#what-génesis-needs-to-supply).

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
| `node tools/capture-renders.mjs` | Re-renders the hero sequence and posters with the engine itself (options: `--variant=desktop` or `mobile`, `--only=hero` or `overview`) |

`tools/harness.html` loads the experience alone (with `?tier=low|high`, `?reduced`) and exposes `window.xp` for inspection; `tools/shoot.mjs` captures it in headless Chromium for given lots, construction progress and camera poses; `tools/tree-lab.html` renders the vegetation species side by side with their triangle cost.

## The experience

**Overview → select → approach → construction → reveal → explore.** Selecting a lot (click/tap on the ground, or the accessible list) immediately starts the approach; there is no confirmation step. Construction begins on arrival, plays for ~26 s, and can be paused, scrubbed by stage, replayed, finished early or left at any time. The camera can be taken over at any moment; a drag never breaks the sequence.

Construction runs on **one continuous clock** (`js/core/timeline.js`) shared by ~50 components of the actual model (`js/experience/house/residence.js`), each with its own window in that clock:

1. Site clearing (grass gives way to red laterite in the terrain shader), batter boards and string lines, sand delivery
2. Ground beams and pads with starter bars, the *contrapiso* slab poured front-to-back, the pool shell
3. RC columns rising, formwork props and plywood decks, slabs poured and curing (wet concrete darkens then dries), scaffolding rising with the frame, rebar at the column heads
4. Brick infill (*ladrillo común*) laid course by course, a brick delivery that is used up
5. Render applied top-down, stone cladding laid bottom-up, timber cladding, gravel roof and terrace pavers, timber soffits, metal copings, timber screen
6. Windows and doors set in from inside, the garage door lowered, glass balustrades
7. Scaffolding struck, formwork stripped, paving, deck, pool coping, tiling and filling, lawn returning, planting growing in
8. Interior and soffit lights warm up for the final reveal

Partially built elements are cut with per-component clipping planes in house space; back faces exposed by the cut are shaded with the cut's normal so walls read as solid while they rise (`js/experience/house/construction.js`). Finished components switch back to shared materials.

## Structure

```
index.html, css/genesis.css     page and design system
js/main.js                      page bootstrap (header, reveals, hero, contact, deep links)
js/explorer.js                  overlay UI for the experience + 2D fallback
js/hero-sequence.js             scroll-driven construction sequence in the hero
js/core/                        pure logic, unit-tested: timeline, state machine, lot geometry, inquiry, formatting
js/data/viva-lago.js            development data (illustrative layout, null commercial fields)
js/config/brand.js, contact.js  logo and verified contact channels (empty until supplied)
js/experience/                  three.js scene: renderer, environment, terrain, lots, vegetation, camera, residence
tools/                          vendor, texture generation, render capture, static server, harness
tests/unit, tests/e2e           node:test suites and the Playwright run
vendor/                         three.js r184 (+ used addons) and ez-tree's generator (both MIT)
assets/                         fonts (OFL), textures (generated), trees, HDRI (CC0), renders
```

## Rendering

- Physically based materials with metre-scale UVs; textures generated by `tools/generate-textures.py` (render, board-formed concrete, ceramic brick, random-ashlar stone, hardwoods, lawn, red soil, asphalt, gravel, pavers, phenolic plywood).
- Golden-hour light: Preetham sky (with sky exposure control), a low WNW sun with frustum-fitted shadows, image-based lighting from a CC0 Poly Haven HDRI. Fog colour is computed from the same sky model in the view direction, so distant land dissolves into the actual sky.
- Scene rendered to a multisampled HDR target; on the high tier GTAO uses that target's depth (so clipped geometry never casts AO ghosts); ACES filmic tone mapping in a single output pass.
- Vegetation: ez-tree geometry re-lit with crown normals and leaf translucency, instanced with per-tree colour; pindó palms are procedural; the wider landscape uses baked impostors; the finished garden gets an instanced lawn.
- Tiers (`js/experience/quality.js`): phones and low-memory devices drop AO, the detailed lawn, half the trees and use smaller shadow maps. Rendering is on demand (the loop stops when nothing moves) and the pixel ratio adapts if frames stay slow. Everything is disposed when the overlay closes.
- No WebGL, a failed start or a lost context switch to a 2D plan (drawn from the same lot data) with the same lot panel and inquiry, plus pre-rendered stage stills.

## Commercial integrity

- Lot panel rows (surface, price, availability, financing) render **“Pendiente de verificación”** until real values exist in `LOTS[].commercial`. Scene areas are computed but never shown as surfaces.
- The residence is labelled as a conceptual visualisation, not included in the lot price and not approved for construction.
- The inquiry form keeps the selected lot. It reports **sent** only when a configured endpoint answers 2xx; WhatsApp/e-mail are reported as hand-offs; with no channel configured (the current state) it says nothing was sent and offers the text to copy.

## What Génesis needs to supply

1. **Official masterplan** (road centrelines, lot polygons and identifiers, lake and common areas) → replace the geometry in `js/data/viva-lago.js` and set `DEVELOPMENT.dataStatus = 'verified'`.
2. **Inventory** per lot (surface, price, availability, financing) → `LOTS[].commercial`.
3. **Contact channel**: WhatsApp number, sales e-mail and/or an HTTPS inquiry endpoint → `js/config/contact.js`.
4. **Logo files**: official colour artwork and a monochrome (ivory) variant → `assets/brand/`, referenced in `js/config/brand.js`. The colour lime (`--lime` in `css/genesis.css`) is an approximation to be replaced with the official value.
5. **Project facts** (location, total area, amenities) → `DEVELOPMENT.facts` and the facts list in `index.html`.
6. Optionally, a professionally designed residence as a GLB with components split by trade, to replace the concept model at the same fidelity target.

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
