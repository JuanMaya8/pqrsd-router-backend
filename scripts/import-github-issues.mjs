#!/usr/bin/env node
/**
 * Volume test with a REAL public dataset: downloads issues from a GitHub repository and imports them as demo PQRSD.
 *
 *   node scripts/import-github-issues.mjs --repo=owner/name [--max=1000] [--api=http://localhost:3001/api/v1] [--key=STAFF_KEY]
 *
 * Each issue becomes one text («título. cuerpo») with its real creation date. They are flagged isDemo, so
 * `DELETE /staff/demo` removes them. GitHub allows 60 unauthenticated requests/hour (set GITHUB_TOKEN for more).
 *
 * ⚠ The classifier is trained for SPANISH citizen text. English issues will mostly land in «needs review»: use a Spanish-language
 *   repository (or translate) to measure something meaningful, and treat this script as a THROUGHPUT test (cases/second, UI with thousands of rows).
 * ⚠ Written but not executed where the project was created (no internet access there).
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const repo = args.repo;
const max = Number(args.max ?? 500);
const api = (args.api ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');
const key = args.key ?? process.env.STAFF_API_KEY ?? '';
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('Uso: node scripts/import-github-issues.mjs --repo=owner/name [--max=500] [--api=URL] [--key=CLAVE]');
  process.exit(1);
}

const gh = { Accept: 'application/vnd.github+json', 'User-Agent': 'pqrsd-router-import', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
const items = [];
for (let page = 1; items.length < max; page += 1) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=${page}`, { headers: gh });
  if (!res.ok) {
    console.error(`GitHub respondió ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const batch = await res.json();
  if (!batch.length) break;
  for (const it of batch) {
    if (it.pull_request) continue; // PRs also appear in this endpoint
    const text = `${it.title}. ${(it.body ?? '').replace(/\s+/g, ' ')}`.slice(0, 2000).trim();
    if (text.length >= 10) items.push({ text, receivedAt: it.created_at });
    if (items.length >= max) break;
  }
}
console.log(`Descargados ${items.length} issues de ${repo}`);

let imported = 0;
let review = 0;
const t0 = Date.now();
for (let i = 0; i < items.length; i += 500) {
  const res = await fetch(`${api}/staff/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Staff-Key': key } : {}) }, body: JSON.stringify({ items: items.slice(i, i + 500), isDemo: true }) });
  if (!res.ok) {
    console.error(`El backend respondió ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const r = await res.json();
  imported += r.imported;
  review += r.needsReview;
  console.log(`  ${imported}/${items.length} importados`);
}
const secs = (Date.now() - t0) / 1000;
console.log(`Listo: ${imported} casos en ${secs.toFixed(1)} s (${(imported / secs).toFixed(0)} casos/s). Requieren revisión: ${review}.`);
