#!/usr/bin/env node
/**
 * Mirror src/*.mjs into public/lib/ so the static site can import them.
 *
 * Why: GitHub Pages serves only the `public/` directory. The engine modules
 * live in `src/` (where tests import them directly, and where they belong for
 * anyone reading the repo). Rather than maintain two copies, this script
 * copies them at build time and rewrites the cross-module import paths.
 *
 * Run automatically by `npm run fetch` / `npm run build`, and by CI.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');
const DEST = resolve(ROOT, 'public/lib');

const BANNER =
  '/* AUTO-GENERATED from src/ by scripts/sync-lib.mjs — do not edit here. */\n';

async function main() {
  await mkdir(DEST, { recursive: true });
  const entries = await readdir(SRC);
  const modules = entries.filter((f) => f.endsWith('.mjs'));

  for (const file of modules) {
    const raw = await readFile(join(SRC, file), 'utf8');
    // Every src module imports its siblings as './x.mjs', which already works
    // once they sit side by side in public/lib/. Rewrite only the '../src/'
    // style paths that would escape the public root.
    const rewritten = raw.replace(
      /(['"])\.\.\/src\/([^'"]+)\1/g,
      (_m, q, p) => `${q}./${p}${q}`
    );
    await writeFile(join(DEST, file), BANNER + rewritten, 'utf8');
  }

  console.log(`synced ${modules.length} module(s) -> public/lib/`);
}

main().catch((err) => {
  console.error('sync-lib failed:', err);
  process.exit(1);
});
