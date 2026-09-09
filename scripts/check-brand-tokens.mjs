#!/usr/bin/env node
/**
 * Brand-token guard.
 *
 * Swapping the brand colour is meant to be one edit in app/globals.css. That
 * only holds while components ask for the token (`bg-primary`, `text-primary`,
 * `ring-primary`) instead of naming a colour. This file stops that guarantee
 * eroding.
 *
 * There are already thousands of hardcoded palette classes here, so a hard zero
 * would be unmeetable and would just get skipped. Instead each rule carries a
 * baseline and fails only when the number goes UP — the same ratchet this repo
 * already uses for coverage and phpstan. Fix code, lower the number, commit.
 *
 *   npm run check:brand
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = ['app', 'components', 'lib'];
const SKIP = new Set(['node_modules', '.next', 'coverage', '__tests__']);

/** Files allowed to name colours literally — the brand is defined somewhere. */
const ALLOWLIST = [
  /^lib\/brand\.ts$/,
  /^components\/dashboard\/profile\/AppearanceTab\.tsx$/,
];

const RULES = [
  {
    id: 'retired-brand-palette',
    // amber/yellow was the pre-rebrand accent. New uses are almost always
    // someone reaching for "the brand colour" by name.
    re: /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:amber|yellow)-\d{2,3}\b/g,
    // Pre-existing debt as of the indigo switch. Ratchet only — never raise.
    baseline: 19,
    hint: 'Use the primary token (bg-primary / text-primary) or a warning token.',
  },
  {
    id: 'literal-hex',
    re: /#[0-9a-fA-F]{6}\b/g,
    // Mostly chart series, which need literal colours. Ratchet only.
    baseline: 12,
    hint: 'Put the value in app/globals.css as a custom property and read it through a token.',
  },
  {
    id: 'hardcoded-label-on-primary',
    // What broke when gold became indigo: black labels that scored 9.4:1 on
    // gold and 2.11:1 on indigo. This one is held at zero — we fixed all 75.
    re: /(["'`])(?=[^"'`\n]*\bbg-primary(?![/\w-]))[^"'`\n]*\btext-(?:black|white)\b[^"'`\n]*\1/g,
    baseline: 0,
    hint: 'Use text-primary-foreground so the label follows the theme.',
  },
  {
    id: 'label-on-primary-tint',
    // The inverse mistake, and one this guard originally missed: bg-primary/10
    // is a 10% TINT with the page showing through, so its label is
    // text-foreground, not text-primary-foreground. White on a 10% tint is
    // invisible. Matches a class list with a tint and no full fill.
    re: /(["'`])(?![^"'`\n]*\bbg-primary(?![/\w-]))(?=[^"'`\n]*\bbg-primary\/\d)[^"'`\n]*\btext-primary-foreground\b[^"'`\n]*\1/g,
    baseline: 0,
    hint: 'On a bg-primary/NN tint use text-foreground or text-primary.',
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}

const files = SCAN.flatMap((d) => {
  try {
    return walk(join(ROOT, d));
  } catch {
    return [];
  }
});

let failed = false;
for (const rule of RULES) {
  let count = 0;
  const worst = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (ALLOWLIST.some((re) => re.test(rel))) continue;
    const hits = (readFileSync(file, 'utf8').match(rule.re) ?? []).length;
    if (hits) {
      count += hits;
      worst.push([rel, hits]);
    }
  }
  const ok = count <= rule.baseline;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${rule.id.padEnd(28)} ${String(count).padStart(5)} / ${rule.baseline} allowed`,
  );
  if (!ok) {
    console.log(`      ${rule.hint}`);
    for (const [f, n] of worst.sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`      ${String(n).padStart(4)}  ${f}`);
    }
  }
}

if (failed) {
  console.log('\nA brand rule went backwards. Fix the new occurrences, or if the');
  console.log('increase is deliberate, raise the baseline in this file and say why.');
  process.exit(1);
}
console.log('\nBrand tokens holding.');
