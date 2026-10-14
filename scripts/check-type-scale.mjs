/**
 * Checks postcss/scale-type.mjs does what it claims, and nothing more.
 *
 * Run: npm run check:type
 */
import postcss from 'postcss';
import plugin from '../postcss/scale-type.mjs';

const run = async (css) => (await postcss([plugin]).process(css, { from: undefined })).css;

let failures = 0;
const check = async (name, input, expected) => {
  const actual = (await run(input)).trim();
  const ok = actual === expected.trim();
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected: ${expected.trim()}\n        actual:   ${actual}`);
};

// Scaled: the two properties, in both units Tailwind emits.
await check('px font-size', '.a{font-size:13px}', '.a{font-size:calc(13px * var(--font-scale, 1))}');
await check('rem font-size', '.a{font-size:0.875rem}', '.a{font-size:calc(0.875rem * var(--font-scale, 1))}');
await check('rem line-height', '.a{line-height:1.25rem}', '.a{line-height:calc(1.25rem * var(--font-scale, 1))}');

// Left alone.
await check('iOS field floor keeps its 16px', '.a{font-size:16px !important}', '.a{font-size:16px !important}');
await check('unitless line-height', '.a{line-height:1.5}', '.a{line-height:1.5}');
await check('em font-size', '.a{font-size:1.2em}', '.a{font-size:1.2em}');
await check('other px properties', '.a{width:13px}', '.a{width:13px}');

// Never double-wrapped, however many times it runs.
const once = await run('.a{font-size:13px}');
await check('idempotent', once, once);

console.log(failures === 0 ? '\nall good' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
