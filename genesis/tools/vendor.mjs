// Copies the runtime libraries and licensed assets the static site needs from
// node_modules into vendor/ and assets/. The output is committed so the site can
// be served by any static host without a build step or a CDN.
//
//   npm install && npm run vendor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const out = (...p) => path.join(root, ...p);

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function write(dest, text) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
}

// --- three.js core + the addons actually used (plus their relative imports) ---
const threeDir = path.join(nm, 'three');
const threeOut = out('vendor', 'three');
fs.rmSync(threeOut, { recursive: true, force: true });
copy(path.join(threeDir, 'build', 'three.module.min.js'), path.join(threeOut, 'three.module.min.js'));
copy(path.join(threeDir, 'build', 'three.core.min.js'), path.join(threeOut, 'three.core.min.js'));
copy(path.join(threeDir, 'LICENSE'), path.join(threeOut, 'LICENSE'));

const addonEntries = [
  'controls/OrbitControls.js',
  'objects/Sky.js',
  'loaders/EXRLoader.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/GTAOPass.js',
  'postprocessing/ShaderPass.js',
  'utils/BufferGeometryUtils.js',
  'lines/LineSegments2.js',
  'lines/LineMaterial.js',
  'lines/LineSegmentsGeometry.js',
];
const addonsSrc = path.join(threeDir, 'examples', 'jsm');
const seen = new Set();
function copyAddon(rel) {
  const norm = path.normalize(rel);
  if (seen.has(norm)) return;
  seen.add(norm);
  const src = path.join(addonsSrc, norm);
  const text = fs.readFileSync(src, 'utf8');
  copy(src, path.join(threeOut, 'addons', norm));
  for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    copyAddon(path.join(path.dirname(norm), m[1]));
  }
}
addonEntries.forEach(copyAddon);

// --- ez-tree: geometry generator only (MIT). Textures/materials are supplied by
// the experience, so the bundled texture loader is replaced with a stub and the
// extension-less imports are made browser-resolvable. ---
const ezSrc = path.join(nm, '@dgreenheck', 'ez-tree', 'src', 'lib');
const ezOut = out('vendor', 'ez-tree');
fs.rmSync(ezOut, { recursive: true, force: true });
const addExt = (t) => t.replace(/from\s+'(\.{1,2}\/[^']+?)'/g, (m, p) => (p.endsWith('.js') ? m : `from '${p}.js'`));
for (const f of ['tree.js', 'branch.js', 'rng.js', 'enums.js', 'options.js', 'trellis.js']) {
  write(path.join(ezOut, f), addExt(fs.readFileSync(path.join(ezSrc, f), 'utf8')));
}
write(
  path.join(ezOut, 'textures.js'),
  '// Stub: Génesis supplies its own bark and leaf materials (see js/experience/world/vegetation.js).\n' +
    'export function getBarkTexture() { return null; }\n' +
    'export function getLeafTexture() { return null; }\n',
);
const presetDir = path.join(ezSrc, 'presets');
const presets = {};
for (const f of fs.readdirSync(presetDir).filter((f) => f.endsWith('.json'))) {
  presets[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(presetDir, f), 'utf8'));
}
write(
  path.join(ezOut, 'presets', 'index.js'),
  "import TreeOptions from '../options.js';\n\n" +
    `export const TreePreset = ${JSON.stringify(presets, null, 2)};\n\n` +
    'export function loadPreset(name) {\n' +
    '  const preset = TreePreset[name];\n' +
    '  return preset ? structuredClone(preset) : new TreeOptions();\n' +
    '}\n',
);
write(
  path.join(ezOut, 'index.js'),
  "export { Tree } from './tree.js';\nexport { TreePreset } from './presets/index.js';\nexport { BarkType, Billboard, LeafType, TreeType } from './enums.js';\n",
);
copy(path.join(nm, '@dgreenheck', 'ez-tree', 'LICENSE'), path.join(ezOut, 'LICENSE'));

// --- Tree textures: Poly Haven bark (CC0, credited in ez-tree) and ez-tree leaf
// cards (MIT package). Converted to WebP by tools/generate-textures.py. ---
const treeAssets = out('assets', 'trees', 'source');
fs.rmSync(treeAssets, { recursive: true, force: true });
const ezAssets = path.join(nm, '@dgreenheck', 'ez-tree', 'src', 'lib', 'assets');
for (const f of ['oak_color_1k.jpg', 'oak_normal_1k.jpg', 'willow_color_1k.jpg', 'willow_normal_1k.jpg']) {
  copy(path.join(ezAssets, 'bark', f), path.join(treeAssets, f));
}
for (const f of ['oak_color.png', 'ash_color.png', 'aspen_color.png']) {
  copy(path.join(ezAssets, 'leaves', f), path.join(treeAssets, f));
}

// --- HDRI: Poly Haven (CC0) via @pmndrs/assets, stored as a plain .exr file ---
const hdriModule = fs.readFileSync(path.join(nm, '@pmndrs', 'assets', 'hdri', 'sunrise.exr.js'), 'utf8');
const b64 = hdriModule.match(/base64,([A-Za-z0-9+/=]+)/)[1];
fs.mkdirSync(out('assets', 'env'), { recursive: true });
fs.writeFileSync(out('assets', 'env', 'sunrise.exr'), Buffer.from(b64, 'base64'));

console.log(`vendor: three (${seen.size} addon files), ez-tree, tree textures, HDRI written.`);
