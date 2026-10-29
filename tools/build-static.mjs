#!/usr/bin/env node
/**
 * build-static.mjs — pre-build crawlable HTML pages for recordings and taxa.
 *
 * Reads a collection from the audioBlast API and writes, into --out,
 *   r/<id>/index.html     one page per recording: the app's own page, with the
 *                         recording's metadata written into its detail view
 *   t/<id>/index.html     one page per taxon: the app's own page, with the taxon's
 *                         recordings and taxonomy written into its view
 *   sitemap.xml
 *   robots.txt            (only honoured by crawlers at a host's root)
 * Those pages carry their content as plain HTML plus JSON-LD, so they work
 * without JavaScript. With JavaScript the app takes the same page over and shows
 * the player or the taxon view (js/app.js).
 *
 * Usage, from a site's root (where its config and page are):
 *   node <corpus>/tools/build-static.mjs --site https://example.org [--out _site]
 *                               [--config site.js] [--page index.html]
 *                               [--base /] [--limit-recordings N] [--limit-taxa N]
 *
 *   --config  the site's config module, of the shape of js/config.js (default site.js)
 *   --page    the site's index.html, which the pages are built from (default index.html)
 *   --site    the site's address (required)
 *   --api     the audioBlast API to read (default https://api.audioblast.org)
 *
 * With a limit, the pages written are the first N recordings and the taxa
 * they belong to (plus those taxa's ancestors), so links between pages resolve.
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LIST_CAP = 100;                         // recordings listed on a taxon page

// ── Arguments ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const required = name => {
  const v = opt(name, '');
  if (!v) throw new Error(`--${name} is required`);
  return v;
};
const CONFIG_PATH = path.resolve(opt('config', 'site.js'));
const PAGE_PATH   = path.resolve(opt('page', 'index.html'));
const LIMIT_R = Number(opt('limit-recordings', 0));
const LIMIT_T = Number(opt('limit-taxa', 0));
const BASE    = opt('base', '/');
const SITE    = required('site').replace(/\/$/, '');
const OUT     = path.resolve(opt('out', '.'));
const API     = opt('api', 'https://api.audioblast.org').replace(/\/$/, '');

// The site's config: the default export of its config module.
const config = (await import(pathToFileURL(CONFIG_PATH).href)).default;

// The collection comes from the site's config, as it does for the app: its source,
// name, recording types, audio URLs and original-page links.
const SOURCE = config.source;
const SITE_NAME = config.siteName;

// The browse site, if the site links its taxa to one: its origin, from the address
// its config gives for a taxon. Null if it links to none.
const browseLink = config.browseTaxonUrl('Gryllus');
const BROWSE = browseLink ? new URL(browseLink).origin : null;

// ── Helpers ───────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const safeUrl = u => {
  const s = String(u ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
};

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Aus Bus cus" -> "Aus (Bus) cus" (as js/render.js does).
function subgenusBrackets(name) {
  const p = name.split(' ');
  if (p.length < 2 || !/^[A-Z]/.test(p[1])) return name;
  return `${p[0]} (${p[1]})${p.length > 2 ? ' ' + p.slice(2).join(' ') : ''}`;
}

const ITALIC = new Set(['genus', 'subgenus', 'species', 'subspecies', 'variety', 'form', 'infraspecies']);
const nameHtml = (name, rank) => {
  const n = esc(subgenusBrackets(name));
  return ITALIC.has(String(rank || '').toLowerCase()) ? `<i>${n}</i>` : n;
};

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

async function fetchAll(module) {
  const rows = [];
  for (let page = 1; ; page++) {
    const j = await getJson(`${API}/data/${module}/?source=${SOURCE}&page=${page}&page_size=5000`);
    rows.push(...(j.data ?? []));
    if (page >= (j.last_page ?? 1)) break;
  }
  return rows;
}

// The taxon pages on the browse site, by path, from its sitemap. Empty if the site
// links to no browse site, or if the sitemap cannot be read, so that no taxon is
// linked to a page that may not be there.
async function browsePaths() {
  if (!BROWSE) return new Set();
  try {
    const res = await fetch(`${BROWSE}/sitemap.xml`);
    if (!res.ok) throw new Error(`${res.status} ${BROWSE}/sitemap.xml`);
    const xml = await res.text();
    const loc = new RegExp(`<loc>${escapeRegExp(BROWSE)}(/taxon/[^<]*)</loc>`, 'g');
    return new Set([...xml.matchAll(loc)].map(m => m[1]));
  } catch (err) {
    console.warn(`  No taxon links to the browse site: ${err.message}`);
    return new Set();
  }
}

const fmtDuration = s => {
  const n = Math.round(Number(s));
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
// ISO 8601 duration for JSON-LD
const isoDuration = s => {
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n > 0 ? `PT${n}S` : undefined;
};

const licenceLabel = url => {
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([^/]+)\/?([\d.]*)/i.exec(url || '');
  if (!m) return url || '';
  return m[1] === 'publicdomain' ? 'CC0' : `CC ${m[2].toUpperCase()} ${m[3]}`.trim();
};

// The app's page, which each recording's and each taxon's page is built from.
const APP_PAGE = (await readFile(PAGE_PATH, 'utf8')).replace(/\r\n/g, '\n');
// The view each kind of page holds, and the element that opens it: both are
// checked against the page, which the pages are built from.
const slotOf = view => `<div id="${view}-content">\n      <div class="loading"><div class="spinner"></div>Loading…</div>\n    </div>`;
const pageOf = view => `<div id="page-${view}" class="page">`;
for (const view of ['detail', 'taxon']) {
  for (const anchor of [slotOf(view), pageOf(view), '<meta charset="UTF-8">', '</head>']) {
    if (!APP_PAGE.includes(anchor)) throw new Error(`${PAGE_PATH} has changed: ${anchor} is not in it`);
  }
}

// A recording's or a taxon's page is the app's page with its view written in,
// so that it reads without JavaScript. The app's scripts and styles are on the
// same page, and the app takes the view over when it loads (js/app.js). <base>
// resolves the app's relative addresses from the site root, as they are from
// the app's own page. `taxon` is the taxon's name, which the app shows.
function appPage({ view, title, description, canonical, jsonld, content, taxon = null }) {
  const head = `  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${esc(canonical)}">
  <script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>
`;
  const data = taxon == null ? '' : ` data-taxon="${esc(taxon)}"`;
  return APP_PAGE
    .replace(/<title>[^<]*<\/title>(<!--[^>]*-->)?/, () => `<title>${esc(title)} — ${esc(SITE_NAME)}</title>`)
    .replace(/<meta name="description"[^>]*>(<!--[^>]*-->)?/, () => `<meta name="description" content="${esc(description)}">`)
    .replace('<meta charset="UTF-8">', () => `<meta charset="UTF-8">\n  <base href="${BASE}">`)
    .replace(/<button data-page="home"\s+class="active" aria-current="page">/, () => '<button data-page="home">')
    .replace(pageOf(view), () => `<div id="page-${view}" class="page active"${data}>`)
    .replace(slotOf(view), () => `<div id="${view}-content">\n      ${content}\n    </div>`)
    .replace('</head>', () => `${head}</head>`);
}

// ── Build ─────────────────────────────────────────────────────────
console.log('Fetching taxa and recordings…');
const [taxaAll, recsAll] = await Promise.all([fetchAll('taxa'), fetchAll('recordings')]);
console.log(`  ${taxaAll.length} taxa, ${recsAll.length} recordings`);
if (!recsAll.length) console.warn(`  No recordings for source "${SOURCE}": writing the sitemap and robots.txt only. Check the source in the site's config.`);
const browsePages = await browsePaths();

const taxonById   = new Map(taxaAll.map(t => [String(t.id), t]));
const taxonByName = new Map();
for (const t of taxaAll) if (t.taxon && !taxonByName.has(t.taxon)) taxonByName.set(t.taxon, t);

let recs = recsAll.filter(r => config.recordingTypeAllowed(r.recording_type));
if (LIMIT_R) recs = recs.slice(0, LIMIT_R);

// Ancestors of a taxon, root first (not including the taxon itself).
function ancestors(t) {
  const out = [];
  const seen = new Set([String(t.id)]);
  let cur = t;
  while (cur.parent_id && taxonById.has(String(cur.parent_id))) {
    cur = taxonById.get(String(cur.parent_id));
    if (seen.has(String(cur.id))) break;
    seen.add(String(cur.id));
    out.unshift(cur);
  }
  return out;
}

// recording -> taxon row (single-name `taxon` only; multi-taxon strings don't resolve — see TODO.md)
const taxonOf = r => taxonByName.get(clean(r.taxon)) ?? null;

// Recordings per taxon, counting up through ancestors.
const recsByTaxon = new Map();     // taxon id -> recordings (self + descendants)
const ownCount    = new Map();     // taxon id -> directly-assigned recordings
for (const r of recs) {
  const t = taxonOf(r);
  if (!t) continue;
  ownCount.set(String(t.id), (ownCount.get(String(t.id)) ?? 0) + 1);
  for (const a of [...ancestors(t), t]) {
    const k = String(a.id);
    if (!recsByTaxon.has(k)) recsByTaxon.set(k, []);
    recsByTaxon.get(k).push(r);
  }
}

// Taxa to write: those with recordings, plus (when limited) nothing else.
let taxa = taxaAll.filter(t => recsByTaxon.has(String(t.id)));
if (LIMIT_T) taxa = taxa.slice(0, LIMIT_T);
const taxaWritten = new Set(taxa.map(t => String(t.id)));

const childrenOf = new Map();
for (const t of taxa) {
  const p = String(t.parent_id ?? '');
  if (!childrenOf.has(p)) childrenOf.set(p, []);
  childrenOf.get(p).push(t);
}

const taxonLink = t => taxaWritten.has(String(t.id))
  ? `<a href="${BASE}t/${esc(t.id)}/">${nameHtml(t.taxon, t.rank)}</a>`
  : nameHtml(t.taxon, t.rank);

// The taxon's page on the browse site, where there is one.
const browseHref = t => {
  const href = config.browseTaxonUrl(t.taxon);
  return href && browsePages.has(new URL(href).pathname) ? href : '';
};

await rm(path.join(OUT, 'r'), { recursive: true, force: true });
await rm(path.join(OUT, 't'), { recursive: true, force: true });

async function write(rel, html) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
}

// ── Recording pages ───────────────────────────────────────────────
for (const r of recs) {
  const id    = String(r.id);
  const title = clean(r.name) || clean(r.taxon) || 'Untitled recording';
  const t     = taxonOf(r);
  const audio = safeUrl(config.resolveFileUrl(r.filename));
  const lic   = safeUrl(r.license);
  const dur   = fmtDuration(r.duration);
  const taxonName = clean(r.taxon);
  const canonical = `${SITE}/r/${id}/`;
  const original  = safeUrl(r.info_url || config.recordingPageUrl(id));

  const rows = [
    ['Taxon',         taxonName && t
                        ? taxonLink(t)
                        : taxonName ? esc(subgenusBrackets(taxonName)) : ''],
    ['Recordist',     esc(r.author)],
    ['Rights holder', esc(r.rights_holder)],
    ['Licence',       lic ? `<a rel="license" href="${esc(lic)}">${esc(licenceLabel(lic))}</a>`
                          : 'Not stated'],
    ['Recording type', esc(r.recording_type)],
    ['Date',          esc([r.date, r.time].filter(Boolean).join(' '))],
    ['Locality',      esc([r.locality, r.country].filter(Boolean).join(', '))],
    ['Duration',      esc(dur)],
    ['Sample rate',   r.sample_rate ? `${esc(Number(r.sample_rate) / 1000)} kHz` : ''],
    ['Channels',      esc(r.channels)],
    ['File',          [r.mime, r.human_size].filter(Boolean).map(esc).join(' · ')],
    ['Added',         esc(r.post_date)],
  ].filter(([, v]) => v !== '' && v != null);

  // The detail view's markup, as js/render.js draws it, so that the page the
  // app takes over looks the same before and after its scripts run.
  const detail = [
    `<h1 class="detail-title">${esc(title)}</h1>`,
    taxonName && taxonName !== title
      ? `<div class="detail-title" style="font-size:1.1rem;margin-bottom:0.25rem">${nameHtml(taxonName, t?.rank)}</div>` : '',
    `<div class="detail-meta">#${esc(id)} · ${SOURCE}</div>`,
    audio ? `<audio controls preload="none" src="${esc(audio)}" style="width:100%;margin:1rem 0"></audio>` : '',
    '<div class="detail-actions">',
    `  <a class="detail-action-link" href="https://view.audioblast.org/?source=${SOURCE}&amp;id=${esc(id)}">🔍 Analyses on audioBlast</a>`,
    audio ? `  <a class="detail-action-link" href="${esc(audio)}" download>↓ Download</a>` : '',
    original ? `  <a class="detail-action-link" href="${esc(original)}">Original page</a>` : '',
    '</div>',
    '<div class="detail-grid"><div class="detail-main">',
    '<h3 class="detail-section-heading">Metadata</h3>',
    '<table class="meta-table">',
    ...rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`),
    '</table>',
    '</div></div>',
  ].filter(Boolean).join('\n      ');

  const desc = [
    taxonName && taxonName !== title ? subgenusBrackets(taxonName) : '',
    dur && `${dur} recording`,
    r.author && `by ${clean(r.author)}`,
    lic && licenceLabel(lic),
  ].filter(Boolean).join(' · ') || `Sound recording from ${SITE_NAME}.`;

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'AudioObject',
    name: title,
    url: canonical,
    ...(audio && { contentUrl: audio }),
    ...(r.mime && { encodingFormat: r.mime }),
    ...(isoDuration(r.duration) && { duration: isoDuration(r.duration) }),
    ...(lic && { license: lic }),
    ...(r.author && { creator: { '@type': 'Person', name: clean(r.author) } }),
    ...(r.rights_holder && { copyrightHolder: { '@type': 'Organization', name: clean(r.rights_holder) } }),
    ...(r.post_date && { datePublished: r.post_date }),
    ...(taxonName && { about: { '@type': 'Taxon', name: taxonName,
        ...(t?.rank && { taxonRank: t.rank }) } }),
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE },
  };

  await write(`r/${id}/index.html`, appPage({ view: 'detail', title, description: desc, canonical, jsonld, content: detail }));
}

// ── Taxon pages ───────────────────────────────────────────────────
for (const t of taxa) {
  const id    = String(t.id);
  const all   = recsByTaxon.get(id) ?? [];
  const kids  = (childrenOf.get(id) ?? []).sort((a, b) => a.taxon.localeCompare(b.taxon));
  const canonical = `${SITE}/t/${id}/`;
  const lineage   = ancestors(t);
  const shown     = all.slice(0, LIST_CAP);
  const browse    = browseHref(t);

  // The taxon view as js/app.js draws it: the taxon's name and rank, its
  // recordings (the first LIST_CAP, each linked to its page) and its place in
  // the taxonomy. Without JavaScript, this is the page.
  const recRow = r => `<tr><td><a href="${BASE}r/${esc(r.id)}/">${esc(clean(r.name) || clean(r.taxon) || 'Untitled recording')}</a></td>`
    + `<td>${[fmtDuration(r.duration), clean(r.author)].filter(Boolean).map(esc).join(' · ')}</td></tr>`;
  const content = [
    `<h1 class="detail-title">${nameHtml(t.taxon, t.rank)}</h1>`,
    `<div class="detail-meta">${[t.rank && esc(t.rank), `${all.length} recording${all.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>`,
    browse ? `<div class="detail-actions"><a class="detail-action-link" href="${esc(browse)}" target="_blank" rel="noopener">🌳 Taxon on ${esc(new URL(browse).host)}</a></div>` : '',
    '<div class="detail-grid"><div class="detail-main">',
    kids.length ? [
      '<h3 class="detail-section-heading">Contains</h3>',
      '<table class="meta-table">',
      ...kids.map(k => `<tr><td>${taxonLink(k)}</td><td>${(recsByTaxon.get(String(k.id)) ?? []).length}</td></tr>`),
      '</table>',
    ].join('\n      ') : '',
    '<h3 class="detail-section-heading">Recordings</h3>',
    '<table class="meta-table">',
    ...shown.map(recRow),
    '</table>',
    all.length > shown.length ? `<p class="detail-meta">The first ${shown.length} of ${all.length} recordings are listed here.</p>` : '',
    '</div><div class="detail-side">',
    '<div class="sidebar-card">',
    '<div class="sidebar-title">Taxonomy</div>',
    `<div class="taxon-breadcrumb">${[...lineage.map(taxonLink), nameHtml(t.taxon, t.rank)].join(' › ')}</div>`,
    '</div>',
    '</div></div>',
  ].filter(Boolean).join('\n      ');

  const desc = `${t.rank ? t.rank + ' ' : ''}${subgenusBrackets(t.taxon)}: `
             + `${all.length} sound recording${all.length === 1 ? '' : 's'} in ${SITE_NAME}.`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Taxon',
    name: t.taxon,
    url: canonical,
    ...(t.rank && { taxonRank: t.rank }),
    ...(lineage.length && { parentTaxon: { '@type': 'Taxon', name: lineage.at(-1).taxon,
        url: `${SITE}/t/${lineage.at(-1).id}/` } }),
  };

  await write(`t/${id}/index.html`, appPage({ view: 'taxon', title: subgenusBrackets(t.taxon), description: desc, canonical, jsonld, content, taxon: t.taxon }));
}

// ── Sitemap ───────────────────────────────────────────────────────
const urls = [`${SITE}/`,
  ...taxa.map(t => `${SITE}/t/${t.id}/`),
  ...recs.map(r => `${SITE}/r/${r.id}/`)];
await write('sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + urls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + '\n</urlset>\n');

await write('robots.txt', `User-agent: *
Allow: /
Sitemap: ${SITE}/sitemap.xml
`);

console.log(`Wrote ${recs.length} recording pages, ${taxa.length} taxon pages, sitemap (${urls.length} URLs) to ${OUT}`);
