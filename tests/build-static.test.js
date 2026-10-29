// Tests for the static-page generator, against a fake audioBlast API: a page for
// each recording and taxon, a source with no records, and failures that must be
// clear. Nothing here reads the live API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Runs the generator into a new folder with the given arguments.
async function build(args, api) {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-build-'));
  const argv = [GENERATOR, '--config', CONFIG, '--page', PAGE, '--out', out, ...args];
  if (api) argv.push('--api', api.url);
  const { code, stderr } = await new Promise(resolve => {
    execFile(process.execPath, argv, (error, stdout, err) => {
      resolve({ code: error ? error.code : 0, stderr: err });
    });
  });
  return { out, code, stderr };
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
