#!/usr/bin/env node
// Copy the shipped web files into the Android app's web folder (PLAN §6f).
//
// One source of truth: the list is sw.js FILES, the same list the service
// worker caches for the web app. Folder entries ('./', './games/bricks/')
// are skipped: each folder's index.html is listed on its own. The target,
// android-app/www, is emptied first and is not in git.
//
// Run from anywhere: node tools/build-www.mjs [target]

import { readFileSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The FILES list of sw.js, as repo-relative paths ('' for './', folders end in '/'). */
export function swFiles(root = ROOT) {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const block = sw.slice(sw.indexOf('const FILES'), sw.indexOf('];', sw.indexOf('const FILES')));
  return [...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
}

/** The files the app ships: sw.js FILES without the folder entries. */
export function shippedFiles(root = ROOT) {
  return swFiles(root).filter((f) => f !== '' && !f.endsWith('/'));
}

export function buildWww(target = join(ROOT, 'android-app', 'www'), root = ROOT) {
  const files = shippedFiles(root);
  rmSync(target, { recursive: true, force: true });
  for (const f of files) {
    const src = join(root, f);
    if (!existsSync(src)) throw new Error(`sw.js FILES lists ${f}, which does not exist`);
    mkdirSync(dirname(join(target, f)), { recursive: true });
    copyFileSync(src, join(target, f));
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const files = buildWww(target);
  console.log(`copied ${files.length} files from sw.js FILES into ${target || 'android-app/www'}`);
}
