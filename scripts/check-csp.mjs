// Fails the build if the web export contains an inline <script> whose hash is
// not allowed by the Content-Security-Policy in vercel.json.
//
// The CSP allows scripts from 'self' plus the exact sha256 of each inline
// script Expo Router writes (today one: `globalThis.__EXPO_ROUTER_HYDRATE__=true;`).
// If an Expo upgrade changes that snippet, the browser would block it and the
// site would fail to hydrate. This check turns that into a red CI run instead
// of a broken deploy: copy the hash it prints into vercel.json.
//
// Run after `npx expo export -p web`:  node scripts/check-csp.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const csp = vercel.headers
  .flatMap((h) => h.headers)
  .find((h) => h.key.toLowerCase() === 'content-security-policy')?.value;
if (!csp) {
  console.error('FAIL: no Content-Security-Policy header in vercel.json');
  process.exit(1);
}
const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return name.endsWith('.html') ? [full] : [];
  });
}

const missing = new Map();
let inlineCount = 0;
for (const file of htmlFiles('dist')) {
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    inlineCount += 1;
    const hash = `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`;
    if (!scriptSrc.includes(hash)) missing.set(hash, file);
  }
}

if (missing.size > 0) {
  for (const [hash, file] of missing) {
    console.error(`FAIL: inline script in ${file} is not allowed by script-src. Add ${hash} to vercel.json.`);
  }
  process.exit(1);
}
console.log(`PASS: ${inlineCount} inline scripts across the export, all allowed by the CSP.`);
