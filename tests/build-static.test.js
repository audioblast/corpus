// Tests for the static-page generator, against a fake audioBlast API: a page for
// each recording and taxon, a page at each of a site's old addresses, a source with
// no records, and failures that must be clear. Nothing here reads the live API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeApi } from './fake-api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GENERATOR = path.join(HERE, '..', 'tools', 'build-static.mjs');
const CONFIG = path.join(HERE, 'fixtures', 'site.js');
const PAGE = path.join(HERE, 'fixtures', 'index.html');
const SOURCE = 'test-source';

const TAXA = [
  { id: 1, taxon: 'Gryllus', rank: 'genus', parent_id: null },
  { id: 2, taxon: 'Gryllus campestris', rank: 'species', parent_id: 1 },
];
const RECORDINGS = [
  {
    id: 7, name: 'Song', taxon: 'Gryllus campestris', recording_type: 'Call',
    filename: 'https://files.example/7.wav', license: 'https://creativecommons.org/licenses/by/4.0/',
    author: 'A. Recordist', duration: 83, mime: 'audio/x-wav',
  },
];

// Runs the generator into a new folder with the given arguments. `site` is the
// site's root, which the generator runs from, and `config` its config.
async function build(args, api, { site = undefined, config = CONFIG } = {}) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-build-'));
  const argv = [GENERATOR, '--config', config, '--page', PAGE, '--out', out, ...args];
  if (api) argv.push('--api', api.url);
  const { code, stderr } = await new Promise(resolve => {
    execFile(process.execPath, argv, { cwd: site }, (error, stdout, err) => {
      resolve({ code: error ? error.code : 0, stderr: err });
    });
  });
  return { out, code, stderr };
}

// A site's root with the fixture config and the given old addresses in
// config/redirects.json, as a site keeps them.
async function siteWithRedirects(moves) {
  const site = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-site-'));
  await fs.mkdir(path.join(site, 'config'));
  await fs.writeFile(path.join(site, 'config', 'site.js'),
    `import fixture from ${JSON.stringify(pathToFileURL(CONFIG).href)};\n`
    + `export default { ...fixture, redirects: 'config/redirects.json' };\n`);
  await fs.writeFile(path.join(site, 'config', 'redirects.json'), JSON.stringify(moves));
  return { site, config: path.join(site, 'config', 'site.js') };
}

const exists = file => fs.access(file).then(() => true, () => false);

test('writes a page for each recording and taxon, and a sitemap', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS });
  t.after(() => api.close());
  const { out, code, stderr } = await build(['--site', 'https://example.test', '--base', '/'], api);
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  const recording = await fs.readFile(path.join(out, 'r', '7', 'index.html'), 'utf8');
  assert.match(recording, /<title>Song — Test<\/title>/);
  assert.match(recording, /<base href="\/">/);
  assert.match(recording, /class="page active"/);
  assert.ok(await exists(path.join(out, 't', '1', 'index.html')));
  assert.ok(await exists(path.join(out, 't', '2', 'index.html')));

  const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/example\.test\/r\/7\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/example\.test\/t\/2\/<\/loc>/);

  assert.deepEqual([...api.sources], [SOURCE], 'every request is scoped to the configured source');
});

test('each old address sends the reader on to the page it is now', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS });
  t.after(() => api.close());
  const { site, config } = await siteWithRedirects({
    'node/7': 'r/7/',
    '/taxonomy/term/2/descriptions/': 't/2/',
    'content/song': '/r/7/',
    'node/99': 'r/99/',
    'node/8': 'https://elsewhere.test/specimen/8',
    'node/9': '/',
  });
  t.after(() => fs.rm(site, { recursive: true, force: true }));
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api, { site, config });
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  const moved = rel => fs.readFile(path.join(out, rel, 'index.html'), 'utf8');
  const recording = await moved('node/7');
  assert.match(recording, /<meta http-equiv="refresh" content="0; url=\/r\/7\/">/);
  assert.match(recording, /<link rel="canonical" href="https:\/\/example\.test\/r\/7\/">/);
  assert.match(recording, /<a href="\/r\/7\/">https:\/\/example\.test\/r\/7\/<\/a>/, 'a link for a reader whose browser does not refresh');
  assert.doesNotMatch(recording, /<script/, 'the page needs no JavaScript');

  assert.match(await moved('taxonomy/term/2/descriptions'), /url=\/t\/2\/"/, 'slashes around an old address are dropped');
  assert.match(await moved('content/song'), /url=\/r\/7\/"/, 'a new page from the root, with or without its first slash');
  assert.match(await moved('node/8'), /url=https:\/\/elsewhere\.test\/specimen\/8"/, 'a page that moved to another site');
  assert.match(await moved('node/9'), /url=\/"/, 'a page with no new one goes home');

  assert.equal(await exists(path.join(out, 'node', '99')), false);
  assert.match(stderr, /1 old address goes to a page this build didn't write, and was left out: node\/99/);

  const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.doesNotMatch(sitemap, /node|taxonomy|content/, 'old addresses are not in the sitemap');
});

test('old addresses follow the path the site is served from', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS });
  t.after(() => api.close());
  const { site, config } = await siteWithRedirects({ 'node/7': 'r/7/' });
  t.after(() => fs.rm(site, { recursive: true, force: true }));
  const { out, code, stderr } = await build(['--site', 'https://example.test', '--base', '/bio/'], api, { site, config });
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  const page = await fs.readFile(path.join(out, 'node', '7', 'index.html'), 'utf8');
  assert.match(page, /url=\/bio\/r\/7\/"/);
  assert.match(page, /href="https:\/\/example\.test\/bio\/r\/7\/"/);
});

test('an old address that is not a path on the site, or is where its own pages are, fails the build', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS });
  t.after(() => api.close());
  const cases = [
    [{ '../outside': 'r/7/' }, /"\.\.\/outside" .* is not a path on the site/],
    [{ 'node/7?x=1': 'r/7/' }, /is not a path on the site/],
    [{ 'r/7': 't/2/' }, /"r\/7" .* is where the site's own pages are/],
    [{ 'config/site.js': 'r/7/' }, /is where the site's own pages are/],
    [{ 'sitemap.xml': 'r/7/' }, /is where the site's own pages are/],
    [{ 'node/7': 'javascript:alert(1)' }, /goes to "javascript:alert\(1\)", which is not a page on the site or an http\(s\) address/],
    [{ 'node/7': '//elsewhere.test/7' }, /which is not a page on the site/],
    [{ 'node/7': 7 }, /which is not a page on the site/],
    [{ 'node/7': '' }, /which is not a page on the site/],
    [['node/7'], /must be an object of old addresses/],
  ];
  for (const [moves, message] of cases) {
    const { site, config } = await siteWithRedirects(moves);
    t.after(() => fs.rm(site, { recursive: true, force: true }));
    const { out, code, stderr } = await build(['--site', 'https://example.test'], api, { site, config });
    t.after(() => fs.rm(out, { recursive: true, force: true }));
    assert.notEqual(code, 0, JSON.stringify(moves));
    assert.match(stderr, message);
  }
});

test('a missing file of old addresses fails the build', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS });
  t.after(() => api.close());
  const { site, config } = await siteWithRedirects({});
  t.after(() => fs.rm(site, { recursive: true, force: true }));
  await fs.rm(path.join(site, 'config', 'redirects.json'));
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api, { site, config });
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.notEqual(code, 0);
  assert.match(stderr, /Cannot read the site's old addresses from config\/redirects\.json/);
});

test('a recording page links its original page only when that is on another site', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: [
    { ...RECORDINGS[0], id: 7, info_url: 'http://example.test/node/7' },
    { ...RECORDINGS[0], id: 8, info_url: 'https://old.example/node/8' },
  ] });
  t.after(() => api.close());
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api);
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  const page = id => fs.readFile(path.join(out, 'r', id, 'index.html'), 'utf8');
  assert.doesNotMatch(await page('7'), /Original page/, 'an old address on the site itself leads back to the same page');
  assert.match(await page('8'), /<a class="detail-action-link" href="https:\/\/old\.example\/node\/8">Original page<\/a>/);
});

test('a source with no records writes only the sitemap and robots.txt, and says so', async t => {
  const api = await fakeApi({ taxa: [], recordings: [] });
  t.after(() => api.close());
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api);
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  assert.match(stderr, /No recordings for source "test-source"/);
  assert.equal(await exists(path.join(out, 'r')), false);
  assert.equal(await exists(path.join(out, 't')), false);

  const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.equal(sitemap.match(/<url>/g).length, 1, 'only the home page');
  assert.match(sitemap, /<loc>https:\/\/example\.test\/<\/loc>/);

  const robots = await fs.readFile(path.join(out, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
});

test('an API that cannot be reached fails the build', async t => {
  // Take a free port, then close it, so that nothing listens there.
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));

  const { out, code, stderr } = await build(['--site', 'https://example.test'], { url });
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.notEqual(code, 0);
  assert.match(stderr, /fetch failed/);
});

test('the site address is required', async t => {
  const { out, code, stderr } = await build([]);
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.notEqual(code, 0);
  assert.match(stderr, /--site is required/);
});
