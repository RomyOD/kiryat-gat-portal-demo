// בניית האתר: node build.mjs  (התוצר נכתב לתיקייה public ומועלה כמו שהוא ל-Vercel)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const v = Date.now().toString(36);
const out = process.env.OUT_DIR || 'public';
const testUrl = process.env.TEST_SUPABASE_URL;
mkdirSync(`${out}/assets`, { recursive: true });
await build({
  entryPoints: ['src/main.jsx'], bundle: true, minify: true, format: 'iife', target: ['es2020'],
  outfile: `${out}/assets/app.js`, jsx: 'automatic', loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"', ...(testUrl ? { __TEST_SUPABASE_URL__: JSON.stringify(testUrl) } : {}) }, legalComments: 'none',
  nodePaths: (process.env.NODE_PATHS || '').split(':').filter(Boolean),
});
copyFileSync('src/styles.css', `${out}/assets/app.css`);
if (out !== 'public') copyFileSync('public/logo.svg', `${out}/logo.svg`);
writeFileSync(`${out}/index.html`, readFileSync('src/index.html', 'utf8').replaceAll('__V__', v));
console.log('built', v, out, testUrl || '');
