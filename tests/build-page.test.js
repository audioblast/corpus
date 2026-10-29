// Tests for the page builder: a site's index.html and main.js made from its config/,
// the features a site leaves out, the check its Pages workflow runs, and a page the
// static-page generator builds on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeApi } from './fake-api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(HERE, '..', 'tools', 'build-page.mjs');
const GENERATOR = path.join(HERE, '..', 'tools', 'build-static.mjs');
const FIXTURE = path.join(HERE, 'fixtures', 'site');
const { version } = JSON.parse(await fs.readFile(path.join(HERE, '..', 'package.json'), 'utf8'));
const CORE = `https://cdn.audioblast.org/corpus/${version}`;

// Runs one of the tools, and resolves to its exit code and what it wrote to stderr.
function run(tool, args) {
  return new Promise(resolve => {
    execFile(process.execPath, [tool, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stderr });
    });
  });
}

// A copy of the fixture site in a new folder, for the builder to write into.
async function siteCopy(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-page-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.cp(FIXTURE, dir, { recursive: true });
  return dir;
}

// A copy of the fixture site whose config also sets `features`.
async function siteWith(t, features) {
  const dir = await siteCopy(t);
  const config = path.join(dir, 'config');
  await fs.rename(path.join(config, 'site.js'), path.join(config, 'fixture.js'));
  await fs.writeFile(path.join(config, 'site.js'),
    `import site from './fixture.js';\nexport default { ...site, features: ${JSON.stringify(features)} };\n`);
  return dir;
}

// The fixture site with its page built, in a new folder: from a config that also sets
// `features`, if there are any.
async function built(t, features) {
  const dir = features ? await siteWith(t, features) : await siteCopy(t);
  const { code, stderr } = await run(BUILDER, ['--site-dir', dir]);
  assert.equal(code, 0, stderr);
  return dir;
}

// The fixture site set to a corpus version, in a new folder.
async function pinnedTo(t, wanted) {
  const dir = await siteCopy(t);
  const file = path.join(dir, 'config', 'site.js');
  const site = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, site.replace("source: 'test-source',", `source: 'test-source',\n  corpusVersion: '${wanted}',`));
  return dir;
}

const exists = file => fs.access(file).then(() => true, () => false);

// What each feature puts in the page.
const PARTS = {
  browse:      ['<button data-page="browse">', '<div id="page-browse" class="page">', 'id="cta-browse"'],
  traits:      ['<button data-page="traits">', '<div id="page-traits" class="page">', 'id="stat-traits"'],
  annotations: ['<button data-page="annotations">', '<div id="page-annotations" class="page">', 'id="stat-annotations"'],
  map:         ['<button data-page="map">', '<div id="page-map" class="page">'],
};

// A page with sections left out has no gaps where they were: no line of spaces alone,
// and no more blank lines in a row than the skeleton has.
function assertNoGaps(page) {
  assert.doesNotMatch(page, /^[ \t]+$/m, 'a line of spaces alone');
  assert.doesNotMatch(page, /\n\n\n\n/, 'three blank lines in a row');
}

test('writes index.html and main.js from the config, pinned to this version', async t => {
  const dir = await built(t);
  const page = await fs.readFile(path.join(dir, 'index.html'), 'utf8');

  assert.match(page, /<title>Test — Fixture<\/title>/);
  assert.match(page, /<meta name="description" content="Fixture site for the page builder tests\.">/);
  assert.match(page, /aria-label="Test home">Te<span>st<\/span><\/span>/);
  assert.match(page, /<h1>Listen to<br><em>tests &amp; fixtures<\/em><\/h1>/);
  assert.match(page, /<p>Sounds &lt;and&gt; silence\.<\/p>/);
  assert.match(page, /placeholder="e\.g\. Acheta"/);
  assert.match(page, /placeholder="e\.g\. carrier frequency"/, 'examples the site leaves out come from the defaults');
  assert.match(page, /recordings\/\?source=test-source"/);
  assert.match(page, /<!-- content loaded from config\/about\.html -->/);
  assert.match(page, /img-src {4}'self' data: https:\/\/files\.audioblast\.org https:\/\/tiles\.example https:\/\/cdn\.audioblast\.org;/,
    "the basemap's host comes from mapTiles");
  assert.ok(page.includes(`<link rel="stylesheet" href="${CORE}/css/style.css">\n  <link rel="stylesheet" href="config/theme.css">`));
  assert.ok(page.includes(`<script src="${CORE}/js/prepaint.js"></script>`));
  assert.doesNotMatch(page, /\{\{/, 'every placeholder is filled');

  const main = await fs.readFile(path.join(dir, 'main.js'), 'utf8');
  assert.ok(main.includes(`import { start } from '${CORE}/js/app.js';`));
  assert.ok(main.includes("import site from './config/site.js';"));
});

test('a site with no theme.css gets no theme link', async t => {
  const dir = await siteCopy(t);
  await fs.rm(path.join(dir, 'config', 'theme.css'));
  const { code, stderr } = await run(BUILDER, ['--site-dir', dir]);
  assert.equal(code, 0, stderr);
  assert.doesNotMatch(await fs.readFile(path.join(dir, 'index.html'), 'utf8'), /theme\.css/);
});

test('--core loads the core from somewhere else', async t => {
  const dir = await siteCopy(t);
  const { code, stderr } = await run(BUILDER, ['--site-dir', dir, '--core', './corpus/']);
  assert.equal(code, 0, stderr);
  assert.match(await fs.readFile(path.join(dir, 'index.html'), 'utf8'), /href="\.\/corpus\/css\/style\.css"/);
  assert.match(await fs.readFile(path.join(dir, 'main.js'), 'utf8'), /from '\.\/corpus\/js\/app\.js'/);
});

test('every feature is on by default, and naming them all on changes nothing', async t => {
  const page = await fs.readFile(path.join(await built(t), 'index.html'), 'utf8');
  for (const [feature, parts] of Object.entries(PARTS)) {
    for (const part of parts) assert.ok(page.includes(part), `${feature} has ${part}`);
  }

  const named = await built(t, { browse: true, traits: true, annotations: true, map: true });
  assert.equal(await fs.readFile(path.join(named, 'index.html'), 'utf8'), page);
});

test('a site can leave out Browse taxa and the map, and --check passes on its page', async t => {
  const dir = await built(t, { browse: false, map: false });
  const page = await fs.readFile(path.join(dir, 'index.html'), 'utf8');

  for (const part of [...PARTS.browse, ...PARTS.map]) assert.ok(!page.includes(part), `left out: ${part}`);
  for (const part of [...PARTS.traits, ...PARTS.annotations]) assert.ok(page.includes(part), `kept: ${part}`);
  assert.ok(page.includes([
    '  <nav aria-label="Primary">',
    '    <button data-page="home"        class="active" aria-current="page">Search</button>',
    '    <button data-page="traits">Browse traits</button>',
    '    <button data-page="annotations">Browse annotations</button>',
    '    <button data-page="about">About</button>',
    '  </nav>',
  ].join('\n')));
  assert.match(page, /img-src {4}'self' data: https:\/\/files\.audioblast\.org;/,
    "with no map, neither the basemap's host nor Leaflet's icons");
  assertNoGaps(page);
  assert.equal((await run(BUILDER, ['--site-dir', dir, '--check'])).code, 0);
});

test('a site can leave out Browse traits and Browse annotations, and their counts', async t => {
  const page = await fs.readFile(path.join(await built(t, { traits: false, annotations: false }), 'index.html'), 'utf8');

  for (const part of [...PARTS.traits, ...PARTS.annotations]) assert.ok(!page.includes(part), `left out: ${part}`);
  for (const part of [...PARTS.browse, ...PARTS.map]) assert.ok(page.includes(part), `kept: ${part}`);
  assert.ok(page.includes([
    '  <div class="header-stats">',
    '    <div class="header-stat" id="stat-recordings">',
    '      <strong>—</strong>recordings',
    '    </div>',
    '    <div class="header-stat" id="stat-taxa">',
    '      <strong>—</strong>taxa',
    '    </div>',
    '  </div>',
  ].join('\n')));
  assert.match(page, /img-src {4}'self' data: https:\/\/files\.audioblast\.org https:\/\/tiles\.example https:\/\/cdn\.audioblast\.org;/);
  assertNoGaps(page);
});

test('a feature the core does not have, or one set to neither true nor false, fails clearly', async t => {
  for (const [features, message] of [
    [{ maps: false }, /sets features\.maps, but the features are browse, traits, annotations, map/],
    [{ map: 'no' }, /sets features\.map to "no", not true or false/],
  ]) {
    const { code, stderr } = await run(BUILDER, ['--site-dir', await siteWith(t, features)]);
    assert.notEqual(code, 0);
    assert.match(stderr, message);
  }
});

test('--check passes on what it wrote, also with Windows line endings, and fails on a hand edit', async t => {
  const dir = await built(t);
  assert.equal((await run(BUILDER, ['--site-dir', dir, '--check'])).code, 0);

  const file = path.join(dir, 'index.html');
  const page = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, page.replace(/\n/g, '\r\n'));
  assert.equal((await run(BUILDER, ['--site-dir', dir, '--check'])).code, 0,
    'a checkout with CRLF line endings still matches');

  await fs.writeFile(file, page.replace('Fixture', 'Edited'));
  const { code, stderr } = await run(BUILDER, ['--site-dir', dir, '--check']);
  assert.notEqual(code, 0);
  assert.match(stderr, /index\.html is not what corpus/);
});

test('a folder with no config/site.js fails clearly', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-page-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const { code, stderr } = await run(BUILDER, ['--site-dir', dir]);
  assert.notEqual(code, 0);
  assert.match(stderr, /No config\/site\.js/);
});

test('the static-page generator builds on the page, from a config that sets only what differs', async t => {
  const dir = await built(t);
  const api = await fakeApi({
    taxa: [{ id: 1, taxon: 'Acheta domesticus', rank: 'species', parent_id: null }],
    recordings: [{ id: 7, name: 'Song', taxon: 'Acheta domesticus', recording_type: 'Call' }],
  });
  t.after(() => api.close());

  const out = path.join(dir, '_site');
  const { code, stderr } = await run(GENERATOR, ['--site', 'https://example.test', '--out', out, '--api', api.url,
    '--config', path.join(dir, 'config', 'site.js'), '--page', path.join(dir, 'index.html')]);
  assert.equal(code, 0, stderr);
  const recording = await fs.readFile(path.join(out, 'r', '7', 'index.html'), 'utf8');
  assert.match(recording, /<title>Song — Test<\/title>/);
  assert.match(recording, /<div id="page-detail" class="page active">/);
});

test('a site set to this corpus version gets its page', async t => {
  const dir = await pinnedTo(t, version);
  const { code, stderr } = await run(BUILDER, ['--site-dir', dir]);
  assert.equal(code, 0, stderr);
  assert.ok((await fs.readFile(path.join(dir, 'main.js'), 'utf8')).includes(`import { start } from '${CORE}/js/app.js';`));
});

test("a site set to another corpus version needs that version's builder", async t => {
  const dir = await pinnedTo(t, '9.9.9');
  const { code, stderr } = await run(BUILDER, ['--site-dir', dir]);
  assert.notEqual(code, 0);
  assert.match(stderr, /asks for corpus 9\.9\.9, but this is corpus/);
  assert.equal(await exists(path.join(dir, 'index.html')), false, 'nothing is written');

  const checked = await run(BUILDER, ['--site-dir', dir, '--check']);
  assert.notEqual(checked.code, 0, '--check stops on it too');

  const tested = await run(BUILDER, ['--site-dir', dir, '--core', './corpus']);
  assert.equal(tested.code, 0, '--core, for testing, skips the check');
});

test('without Browse taxa, the static-page generator still writes the taxon pages that recordings link to', async t => {
  const dir = await built(t, { browse: false });
  const api = await fakeApi({
    taxa: [{ id: 1, taxon: 'Acheta domesticus', rank: 'species', parent_id: null }],
    recordings: [{ id: 7, name: 'Song', taxon: 'Acheta domesticus', recording_type: 'Call' }],
  });
  t.after(() => api.close());

  const out = path.join(dir, '_site');
  const { code, stderr } = await run(GENERATOR, ['--site', 'https://example.test', '--out', out, '--api', api.url,
    '--config', path.join(dir, 'config', 'site.js'), '--page', path.join(dir, 'index.html')]);
  assert.equal(code, 0, stderr);
  const taxon = await fs.readFile(path.join(out, 't', '1', 'index.html'), 'utf8');
  assert.match(taxon, /<div id="page-taxon" class="page active" data-taxon="Acheta domesticus">/);
  assert.doesNotMatch(taxon, /data-page="browse"/);
  const recording = await fs.readFile(path.join(out, 'r', '7', 'index.html'), 'utf8');
  assert.match(recording, /<a href="\/t\/1\/"><i>Acheta domesticus<\/i><\/a>/);
});
