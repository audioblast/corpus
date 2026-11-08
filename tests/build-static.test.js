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

// Publications: publication 40 cites recording 7, is about taxon 2, and is cited by
// description 41 of taxon 2.
const REFERENCES = [
  { source: SOURCE, id: 40, type: 'article', title: 'Calling songs of field crickets', author: 'Ragge, D. R.',
    year: '1990', journal: 'Bulletin', volume: '59', number: '1', pages: '1-35', doi: '10.0000/fixture.40',
    url: 'https://example.test/40', attachments: 'https://files.example/40.pdf', abstract: 'A test abstract.',
    type_name: 'Journal Article' },
];
const DESCRIPTIONS = [
  { source: SOURCE, id: 41, topic: 'behaviour', value: 'Males call from grass.' },
];
const PUBLICATION_LINKS = [
  { source: SOURCE, subject_type: 'recordings', subject_source: SOURCE, subject_id: '7',
    predicate: 'http://purl.org/dc/terms/isReferencedBy', object_type: 'references', object_source: SOURCE, object_id: '40' },
  { source: SOURCE, subject_type: 'references', subject_source: SOURCE, subject_id: '40',
    predicate: 'http://purl.obolibrary.org/obo/IAO_0000136', object_type: 'taxa', object_source: SOURCE, object_id: '2' },
  { source: SOURCE, subject_type: 'descriptions', subject_source: SOURCE, subject_id: '41',
    predicate: 'http://purl.obolibrary.org/obo/IAO_0000136', object_type: 'taxa', object_source: SOURCE, object_id: '2' },
  { source: SOURCE, subject_type: 'descriptions', subject_source: SOURCE, subject_id: '41',
    predicate: 'http://purl.org/dc/terms/source', object_type: 'references', object_source: SOURCE, object_id: '40' },
];

test('a publication has a page, which the recording, the taxon and the description link to', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS, references: REFERENCES,
    descriptions: DESCRIPTIONS, links: PUBLICATION_LINKS });
  t.after(() => api.close());
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api);
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  const page = rel => fs.readFile(path.join(out, rel, 'index.html'), 'utf8');

  const publication = await page('p/40');
  assert.match(publication, /<title>Calling songs of field crickets — Test<\/title>/);
  assert.match(publication, /<p>Ragge, D\. R\. \(1990\)\. Calling songs of field crickets\. Bulletin, 59\(1\): 1-35\.<\/p>/);
  assert.match(publication, /href="https:\/\/doi\.org\/10\.0000\/fixture\.40"/);
  assert.match(publication, /<a href="\/r\/7\/">Song<\/a>/, 'the recording that cites it');
  assert.match(publication, /<a href="\/t\/2\/"><i>Gryllus campestris<\/i><\/a>/, 'the taxon it is about');
  assert.match(publication, /<td>Behaviour<\/td>/, 'the description that cites it');

  const recording = await page('r/7');
  assert.match(recording, /<h3 class="detail-section-heading">Publications<\/h3>/);
  assert.match(recording, /<a href="\/p\/40\/">Ragge, D\. R\. \(1990\)\./);

  const taxon = await page('t/2');
  assert.match(taxon, /<h3 class="detail-section-heading">Literature<\/h3>/);
  assert.match(taxon, /<a href="\/p\/40\/">Ragge, D\. R\. \(1990\)\./);
  assert.match(taxon, /<h3 class="detail-section-heading">Behaviour<\/h3>/);
  assert.match(taxon, /<p>Males call from grass\.<\/p>/);
  assert.match(taxon, /Source: <a href="\/p\/40\/">Ragge, D\. R\. \(1990\)\./);

  const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/example\.test\/p\/40\/<\/loc>/);
});

// A taxon that a description or publication is about has a page, even with no recordings, and so
// does each taxon above it, for its breadcrumb.
test('a taxon with a description but no recordings has a page, and so does the taxon above it', async t => {
  const taxa = [
    ...TAXA,
    { id: 3, taxon: 'Gryllus pennsylvanicus', rank: 'species', parent_id: 1 },
    { id: 4, taxon: 'Acheta', rank: 'genus', parent_id: null },
    { id: 5, taxon: 'Acheta domesticus', rank: 'species', parent_id: 4 },
  ];
  const descriptions = [
    ...DESCRIPTIONS,
    { source: SOURCE, id: 42, topic: 'behaviour', value: 'Males call at dusk.' },
    { source: SOURCE, id: 43, topic: 'behaviour', value: 'Males call at night.' },
  ];
  const about = (id, taxonId) => ({ source: SOURCE, subject_type: 'descriptions', subject_source: SOURCE, subject_id: id,
    predicate: 'http://purl.obolibrary.org/obo/IAO_0000136', object_type: 'taxa', object_source: SOURCE, object_id: taxonId });
  const links = [...PUBLICATION_LINKS, about('42', '3'), about('43', '5')];
  const api = await fakeApi({ taxa, recordings: RECORDINGS, references: REFERENCES, descriptions, links });
  t.after(() => api.close());
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api);
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  assert.ok(await exists(path.join(out, 't', '3', 'index.html')), 'a species with a description and no recordings');
  assert.ok(await exists(path.join(out, 't', '5', 'index.html')), 'a species with a description and no recordings');
  assert.ok(await exists(path.join(out, 't', '4', 'index.html')), 'the genus above it, with no recording of its own');
  const page = await fs.readFile(path.join(out, 't', '5', 'index.html'), 'utf8');
  assert.match(page, /<p>Males call at night\.<\/p>/);
});

test('a site with features.publications off writes no publication pages or lists', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS, references: REFERENCES,
    descriptions: DESCRIPTIONS, links: PUBLICATION_LINKS });
  t.after(() => api.close());
  const { site, config } = await siteWithFeatures({ publications: false });
  t.after(() => fs.rm(site, { recursive: true, force: true }));
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api, { site, config });
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  assert.equal(await exists(path.join(out, 'p')), false);
  const recording = await fs.readFile(path.join(out, 'r', '7', 'index.html'), 'utf8');
  assert.doesNotMatch(recording, /Publications/);
  const taxon = await fs.readFile(path.join(out, 't', '2', 'index.html'), 'utf8');
  assert.doesNotMatch(taxon, /Literature|Behaviour/);
});

// Specimens: 11 is of recording 7 and identified as Gryllus campestris (2), and 12 is of
// no recording and identified as no taxon.
const SPECIMENS = [
  { source: SOURCE, id: 11, scientificName: 'Gryllus campestris', institutionCode: 'NHMUK', collectionCode: 'BMNH(E)',
    catalogNumber: '15?', basisOfRecord: 'LivingSpecimen', sex: 'Male', recordedBy: 'D. Ragge', eventDate: '1962-08-18',
    countryCode: 'GB', decimalLatitude: '50.6016536', decimalLongitude: '-1.9529057', occurrenceRemarks: 'On reeds.' },
  { source: SOURCE, id: 12, scientificName: 'Gryllus', countryCode: 'FR' },
];
const LINKS = [
  { source: SOURCE, subject_type: 'recordings', subject_source: SOURCE, subject_id: '7',
    predicate: 'http://rs.tdwg.org/ac/terms/associatedSpecimenReference',
    object_type: 'specimens', object_source: SOURCE, object_id: '11' },
  { source: SOURCE, subject_type: 'specimens', subject_source: SOURCE, subject_id: '11',
    predicate: 'http://rs.tdwg.org/dwc/iri/toTaxon', object_type: 'taxa', object_source: SOURCE, object_id: '2' },
];

// A copy of the fixture site whose config sets `features`, as a site's config does.
async function siteWithFeatures(features) {
  const site = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-site-'));
  await fs.mkdir(path.join(site, 'config'));
  const file = path.join(site, 'config', 'site.js');
  await fs.writeFile(file, `import fixture from ${JSON.stringify(pathToFileURL(CONFIG).href)};\n`
    + `export default { ...fixture, features: ${JSON.stringify(features)} };\n`);
  return { site, config: file };
}

test('a specimen has a page, which the recording and the taxon it is of link to', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS, specimens: SPECIMENS, links: LINKS });
  t.after(() => api.close());
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api);
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  const page = rel => fs.readFile(path.join(out, rel, 'index.html'), 'utf8');

  const specimen = await page('s/11');
  assert.match(specimen, /<title>Gryllus campestris #11 — Test<\/title>/);
  assert.match(specimen, /<h1 class="detail-title"><i>Gryllus campestris<\/i><\/h1>/, 'the name, italic at its rank');
  assert.match(specimen, /<td>Identified as<\/td><td><a href="\/t\/2\/"><i>Gryllus campestris<\/i><\/a><\/td>/);
  assert.match(specimen, /<td>Collection<\/td><td>BMNH\(E\)<\/td>/);
  assert.match(specimen, /<td>Remarks<\/td><td>On reeds\.<\/td>/);
  assert.match(specimen, /<a href="\/r\/7\/">Song<\/a>/, 'the recording it is of');
  assert.match(specimen, /taxon-breadcrumb"><a href="\/t\/1\/"><i>Gryllus<\/i><\/a> › <i>Gryllus campestris<\/i>/);
  assert.match(specimen, /"@type":"Thing"/);

  const recording = await page('r/7');
  assert.match(recording, /<h3 class="detail-section-heading">Specimens<\/h3>/);
  assert.match(recording, /<a href="\/s\/11\/">/, 'the recording links to its specimen');

  const taxon = await page('t/2');
  assert.match(taxon, /<h3 class="detail-section-heading">Specimens<\/h3>/);
  assert.match(taxon, /<a href="\/s\/11\/">/, 'the taxon links to its specimen');
  assert.match(taxon, /1 specimen/);

  assert.match(await page('t/1'), /<a href="\/s\/11\/">/, 'a taxon lists the specimens of the taxa under it');

  const plain = await page('s/12');
  assert.match(plain, /<title>Gryllus #12 — Test<\/title>/);
  assert.doesNotMatch(plain, /taxon-breadcrumb/, 'no taxonomy for a specimen identified as no taxon');

  const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/example\.test\/s\/11\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/example\.test\/s\/12\/<\/loc>/);

  assert.deepEqual([...api.sources], [SOURCE], 'every request is scoped to the configured source');
});

test('an old address of a specimen goes to its page', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS, specimens: SPECIMENS, links: LINKS });
  t.after(() => api.close());
  const { site, config } = await siteWithRedirects({ 'node/11': 's/11/' });
  t.after(() => fs.rm(site, { recursive: true, force: true }));
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api, { site, config });
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  const moved = await fs.readFile(path.join(out, 'node', '11', 'index.html'), 'utf8');
  assert.match(moved, /<meta http-equiv="refresh" content="0; url=\/s\/11\/">/);
});

test('a site with features.specimens off writes no specimen pages or lists', async t => {
  const api = await fakeApi({ taxa: TAXA, recordings: RECORDINGS, specimens: SPECIMENS, links: LINKS });
  t.after(() => api.close());
  const { site, config } = await siteWithFeatures({ specimens: false });
  t.after(() => fs.rm(site, { recursive: true, force: true }));
  const { out, code, stderr } = await build(['--site', 'https://example.test'], api, { site, config });
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  assert.equal(code, 0, stderr);

  assert.equal(await exists(path.join(out, 's')), false);
  const recording = await fs.readFile(path.join(out, 'r', '7', 'index.html'), 'utf8');
  assert.doesNotMatch(recording, /Specimens/);
  const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.doesNotMatch(sitemap, /\/s\//);
});
