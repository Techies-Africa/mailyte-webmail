// pdf.js renders PDFs in a Web Worker that the browser loads from a URL of
// its own. Copied from the installed package on every dev start and build
// (predev/prebuild), so the worker can never drift from the pdfjs-dist
// version the bundle was built against. The copy is ignored by git.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const source = join(dirname(require.resolve('pdfjs-dist/package.json')), 'build', 'pdf.worker.min.mjs');
const target = join(process.cwd(), 'public', 'pdfjs', 'pdf.worker.min.mjs');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`pdf.js worker -> ${target}`);
