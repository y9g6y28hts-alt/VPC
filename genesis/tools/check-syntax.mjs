// Parses every first-party JavaScript module with `node --check` (syntax only;
// bare 'three' imports are resolved by the page's import map, not here).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(entry.name)) files.push(p);
  }
};
for (const dir of ['js', 'tools', 'tests']) walk(path.join(root, dir));

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`✗ ${path.relative(root, f)}\n${err.stderr?.toString() || err.message}`);
  }
}
console.log(`${files.length - failed}/${files.length} modules parse.`);
process.exit(failed ? 1 : 0);
