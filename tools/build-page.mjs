#!/usr/bin/env node
/**
 * build-page.mjs — make a site's index.html and main.js from the page skeleton.
 *
 * A site keeps its settings and copy in config/: site.js, of the shape of
 * js/config.js; about.html, the About page's content; and theme.css, its colours, if
 * it has its own. This fills in skeleton/ from config/site.js, leaving out the
 * features it turns off, and writes the site's index.html and main.js, pinned to this
 * corpus version. Commit both, and the site runs as it is, with no build step.
 *
 * A site sets the corpus version it runs on in one place, corpusVersion in
 * config/site.js, which its Pages workflow reads too. This stops if that is not its
 * own version, so to move a site to another version, change corpusVersion, run that
 * version's build-page.mjs and review the diff.
 *
 * Usage, from a site's root (where config/ is):
 *   node <corpus>/tools/build-page.mjs [--site-dir .] [--check] [--core URL]
 *
 *   --site-dir  the site's root (default .)
 *   --check     write nothing, and fail if index.html or main.js is not what this
 *               version writes. A site's Pages workflow runs this.
 *   --core      where the page loads the core from, to test a copy that isn't on the
 *               CDN yet. It skips the version check (default this version's folder on
 *               cdn.audioblast.org)
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { esc } from '../js/format.js';

const CORPUS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Arguments ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const { version: VERSION } = JSON.parse(await readFile(path.join(CORPUS, 'package.json'), 'utf8'));
const SITE_DIR = path.resolve(opt('site-dir', '.'));
const CHECK    = args.includes('--check');
const CORE     = opt('core', `https://cdn.audioblast.org/corpus/${VERSION}`).replace(/\/$/, '');
// The core's address goes into the page's attributes and main.js's import as it is.
if (/['"\\<>\s]/.test(CORE)) throw new Error(`--core ${CORE} is not an address the page can use`);

const exists = file => access(file).then(() => true, () => false);
const CONFIG_PATH = path.join(SITE_DIR, 'config', 'site.js');
if (!await exists(CONFIG_PATH)) throw new Error(`No config/site.js in ${SITE_DIR}`);

// The site's config, merged over the core's defaults as start() merges it in the app.
// The hero, the examples and the features are merged field by field, so a site can set
// just one.
const config = (await import(pathToFileURL(path.join(CORPUS, 'js', 'config.js')).href)).default;
const hero = { ...config.hero };
const examples = { ...config.examples };
const features = { ...config.features };
Object.assign(config, (await import(pathToFileURL(CONFIG_PATH).href)).default);
Object.assign(hero, config.hero);
Object.assign(examples, config.examples);
if (!config.source) throw new Error(`${CONFIG_PATH} sets no source`);

// The site's corpus version is set once, in config/site.js. This makes pages for its
// own version only, so a site on another version needs that version's builder.
if (config.corpusVersion && config.corpusVersion !== VERSION && !opt('core')) {
  throw new Error(`config/site.js asks for corpus ${config.corpusVersion}, but this is corpus ${VERSION}. `
    + `Run build-page.mjs from corpus v${config.corpusVersion}.`);
}

// A feature the core doesn't have, or one set to neither true nor false, would leave
// a feature on unnoticed, so it stops the build.
for (const [name, on] of Object.entries(config.features ?? {})) {
  if (!Object.hasOwn(features, name)) {
    throw new Error(`${CONFIG_PATH} sets features.${name}, but the features are ${Object.keys(features).join(', ')}`);
  }
  if (typeof on !== 'boolean') throw new Error(`${CONFIG_PATH} sets features.${name} to ${JSON.stringify(on)}, not true or false`);
  features[name] = on;
}

// ── Helpers ───────────────────────────────────────────────────────
// The origin of an address, or '' if it has none that can go in the policy as it is.
function originOf(url) {
  try {
    const { origin } = new URL(url);
    return /^https?:\/\/[\w.:-]+$/.test(origin) ? origin : '';
  } catch {
    return '';
  }
}

// Each section of a skeleton file, {{#feature}}…{{/feature}}, is kept if the site has
// that feature and left out if it hasn't. A section fills one line, or has its marks
// on lines of their own, and the marks' lines go with them either way, so the page
// has no gaps where they were. Then each {{name}} is filled from `values`. A mark this
// doesn't fill is an error, so the skeleton and this tool can't drift apart unnoticed.
async function fill(file, values) {
  const text = (await readFile(path.join(CORPUS, 'skeleton', file), 'utf8')).replace(/\r\n/g, '\n');
  const section = (feature, body) => {
    if (!Object.hasOwn(features, feature)) throw new Error(`skeleton/${file} has a section for ${feature}, which is not a feature`);
    return features[feature] ? body : '';
  };
  return text
    .replace(/^[ \t]*\{\{#(\w+)\}\}\n([\s\S]*?)^[ \t]*\{\{\/\1\}\}\n/gm, (_, feature, body) => section(feature, body))
    .replace(/^([ \t]*)\{\{#(\w+)\}\}(.*)\{\{\/\2\}\}\n/gm, (_, indent, feature, body) => section(feature, `${indent}${body}\n`))
    .replace(/\{\{(.*?)\}\}/g, (mark, name) => {
      if (!(name in values)) throw new Error(`skeleton/${file} has ${mark}, which build-page.mjs does not fill`);
      return values[name];
    });
}

// ── Fill in the skeleton ──────────────────────────────────────────
const [logoFirst, logoSecond = ''] = Array.isArray(config.logo) ? config.logo : [config.logo ?? config.siteName];

// The page shows images from itself and the audio host's spectrogram tiles, and, if
// the site has the recordings map, from the basemap's tile server and the core
// (Leaflet's icons). The basemap's host comes from config.mapTiles, so the policy and
// the map can't disagree.
const imgSrc = [...new Set(["'self'", 'data:', 'https://files.audioblast.org',
  ...(features.map ? [originOf(config.mapTiles?.url), 'https://cdn.audioblast.org'] : [])])].filter(Boolean).join(' ');
const theme = await exists(path.join(SITE_DIR, 'config', 'theme.css'));

const files = {
  'index.html': await fill('index.html', {
    title:           esc(config.siteTagline ? `${config.siteName} — ${config.siteTagline}` : config.siteName),
    description:     esc(config.siteDescription),
    siteName:        esc(config.siteName),
    sourceQuery:     esc(encodeURIComponent(config.source)),
    logo:            esc(logoFirst) + (logoSecond ? `<span>${esc(logoSecond)}</span>` : ''),
    heroLead:        esc(hero.lead),
    heroEmphasis:    esc(hero.emphasis),
    heroText:        esc(hero.text),
    exampleTaxon:    esc(examples.taxon),
    exampleTrait:    esc(examples.trait),
    exampleValue:    esc(examples.value),
    exampleCallType: esc(examples.callType),
    exampleSex:      esc(examples.sex),
    aboutUrl:        esc(config.aboutUrl),
    imgSrc,
    core:            CORE,
    themeLink:       theme ? '\n  <link rel="stylesheet" href="config/theme.css">' : '',
  }),
  'main.js': await fill('main.js', { core: CORE }),
};

// ── Write, or check ───────────────────────────────────────────────
if (CHECK) {
  const stale = [];
  for (const [name, text] of Object.entries(files)) {
    const now = await readFile(path.join(SITE_DIR, name), 'utf8').catch(() => null);
    if (now?.replace(/\r\n/g, '\n') !== text) stale.push(name);
  }
  if (stale.length) {
    console.error(`${stale.join(' and ')} ${stale.length > 1 ? 'are' : 'is'} not what corpus ${VERSION} makes from config/. `
      + 'Run tools/build-page.mjs from that version, and commit the result.');
    process.exit(1);
  }
  console.log(`index.html and main.js are what corpus ${VERSION} makes from config/.`);
} else {
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(SITE_DIR, name), text);
  console.log(`Wrote index.html and main.js for corpus ${VERSION}, loading the core from ${CORE}.`);
}
