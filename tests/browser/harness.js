// The harness for the browser checks. It assembles a check site, answers every
// request the browser makes from fakes, so that nothing reaches the network, and
// fails a check on a console error or on a request the fakes don't answer. See the
// README in this folder.
import { test as base, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeApi as serveApi } from '../fake-api.js';
import { fakeApi } from './fake-api.js';
import { recordingWav, TILE_PNG } from './media.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

// Where a check site's page loads the core from: this version's folder on the CDN, as
// a real site's page does. The harness answers it from js/ and css/ here.
const { version: VERSION } = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const CORE = `https://cdn.audioblast.org/corpus/${VERSION}`;

// The libraries js/render.js loads from the CDN, each served from the npm package of
// the same version (devDependencies in package.json), whose dist/ holds the same files.
const LIBRARIES = {
  'wavesurfer':                   'wavesurfer.js',
  'wavesurfer-tiled-spectrogram': 'wavesurfer-tiled-spectrogram',
  'wavesurfer-annotations':       'wavesurfer-annotations',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.xml':  'application/xml',
  '.txt':  'text/plain; charset=utf-8',
  '.png':  'image/png',
};
const CORS = { 'Access-Control-Allow-Origin': '*' };

const WAV = recordingWav();

// ── Assembling a check site ───────────────────────────────────────

// Run one of the tools in tools/, as a site's workflow does.
function runTool(tool, args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(ROOT, 'tools', tool), ...args], (error, stdout, stderr) =>
      (error ? reject(new Error(`tools/${tool} failed:\n${stderr}`)) : resolve()));
  });
}

/**
 * Assemble a check site in a new temp folder, as a site is made: its config/ from
 * sites/<name>/, the page and bootstrap that tools/build-page.mjs writes from it, and
 * the recording and taxon pages that tools/build-static.mjs writes from the fake API,
 * as the sites' Pages workflows do. Its data is data/<name>.js.
 *
 * The page is built with --core, the build for a copy of the core under test, which
 * doesn't hold a site to the builder's corpusVersion. The check sites set none.
 */
async function assembleSite(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `corpus-check-${name}-`));
  await fs.cp(path.join(HERE, 'sites', name), dir, { recursive: true });
  await runTool('build-page.mjs', ['--site-dir', dir, '--core', CORE]);

  // The page's preconnect hints open connections to the live hosts, which the
  // harness cannot answer, so the check site's page goes without them.
  const page = path.join(dir, 'index.html');
  await fs.writeFile(page, (await fs.readFile(page, 'utf8')).replace(/^\s*<link rel="preconnect"[^>]*>\n/gm, ''));

  // The generator reads the site's taxa and recordings from the generator tests' fake
  // API, served on a local port while it runs.
  const data = (await import(`./data/${name}.js`)).default;
  const origin = `https://${name}.test`;
  const api = await serveApi({ taxa: data.taxa, recordings: data.recordings });
  try {
    await runTool('build-static.mjs', [
      '--config', path.join(dir, 'config', 'site.js'), '--page', page,
      '--out', dir, '--site', origin, '--base', '/', '--api', api.url,
    ]);
  } finally {
    await api.close();
  }
  return { dir, data, origin };
}

// ── Answering the browser's requests ──────────────────────────────

const fulfillFile = async (route, file, headers = {}) => {
  const body = await fs.readFile(file).catch(() => null);
  if (!body) return false;
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', ...headers },
    body: route.request().method() === 'HEAD' ? '' : body,
  });
  return true;
};

// The file the CDN would serve at this path: the core from this repo, or a library
// from node_modules. Or, if there is none, why.
async function cdnFile(pathname) {
  const core = /^\/corpus\/[^/]+\/((?:js|css)\/.+)$/.exec(pathname);
  if (core) return { file: path.join(ROOT, core[1]) };
  const [, library, version, rest] = /^\/([^/]+)\/([^/]+)\/(.+)$/.exec(pathname) ?? [];
  const pkg = LIBRARIES[library];
  if (!pkg) return { problem: `a request to the CDN that the harness does not answer: ${pathname}` };
  const dir = path.join(ROOT, 'node_modules', pkg);
  const installed = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')).version;
  if (installed !== version) {
    return { problem: `js/render.js loads ${library} ${version} from the CDN, but package.json installs `
      + `${pkg} ${installed}: change its devDependency to ${version}` };
  }
  return { file: path.join(dir, 'dist', rest) };
}

// The recording, with the part of it asked for if the request has a Range.
function audio(request) {
  const headers = { ...CORS, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/wav' };
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range ?? '');
  if (!range) return { status: 200, headers, body: WAV };
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : WAV.length - 1, WAV.length - 1);
  return {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${WAV.length}` },
    body: WAV.subarray(start, end + 1),
  };
}

// ── The fixtures the checks use ───────────────────────────────────

export const test = base.extend({
  // The check site a spec runs on: one of sites/, with its data in data/.
  siteName: ['collection', { option: true }],

  // The check sites this worker has assembled, each once, removed when it is done.
  assembled: [async ({}, use) => {
    const made = new Map();
    await use(name => {
      if (!made.has(name)) made.set(name, assembleSite(name));
      return made.get(name);
    });
    for (const site of made.values()) {
      const { dir } = await site.catch(() => ({}));
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  }, { scope: 'worker' }],

  // The check site, with every request the page makes answered by the fakes. What
  // goes wrong while the check runs is collected, and fails it at the end: a console
  // error or an uncaught exception, a request the fakes don't answer, and an API
  // request not scoped to the site's source.
  site: async ({ page, siteName, assembled }, use) => {
    const { dir, data, origin } = await assembled(siteName);
    const answer = fakeApi(data);
    const problems = [];
    const warnings = [];
    const holds = [];
    let tiles = 0;

    page.on('console', message => {
      const where = message.location().url ? ` (${message.location().url})` : '';
      if (message.type() === 'error') problems.push(`console error: ${message.text()}${where}`);
      if (message.type() === 'warning') warnings.push(message.text());
    });
    page.on('pageerror', error => problems.push(`uncaught exception: ${error.message}`));

    await page.context().route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      try {
        // The page's own blob: and data: addresses, which WebKit passes through
        // here too, never reach the network.
        if (url.protocol === 'blob:' || url.protocol === 'data:') return await route.continue();

        if (request.method() === 'OPTIONS') {
          return await route.fulfill({ status: 204, headers: {
            ...CORS, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': '*',
          } });
        }

        if (url.origin === origin) {
          const rel = decodeURIComponent(url.pathname).replace(/\/$/, '/index.html');
          if (await fulfillFile(route, path.join(dir, rel))) return;
          if (url.pathname !== '/favicon.ico') problems.push(`the site has no ${url.pathname}`);
          return await route.fulfill({ status: 404, body: '' });
        }

        if (url.host === 'api.audioblast.org') {
          const hold = holds.find(h => h.pathname === url.pathname);
          if (hold) {
            hold.arrived();
            await hold.released;
          }
          const { status, body, scoped } = answer(url);
          if (status !== 200) problems.push(`the fake API has no answer for ${url.pathname}${url.search}`);
          if (!scoped) problems.push(`an API request not scoped to source "${data.source}": ${url.pathname}${url.search}`);
          return await route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        }

        if (url.host === 'cdn.audioblast.org') {
          const { file, problem } = await cdnFile(url.pathname);
          if (file && await fulfillFile(route, file, CORS)) return;
          problems.push(problem ?? `the CDN has no ${url.pathname}`);
          return await route.fulfill({ status: 404, headers: CORS, body: '' });
        }

        if (url.host === 'tile.openstreetmap.org') {
          tiles++;
          return await route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png' }, body: TILE_PNG });
        }

        if (url.host === 'files.example') return await route.fulfill(audio(request));

        problems.push(`a request to a host the checks don't fake: ${url.href}`);
        return await route.abort('blockedbyclient');
      } catch (error) {
        // A request still being answered when the check ends has nowhere to go.
        if (!/closed|disposed|destroyed/i.test(error.message)) {
          problems.push(`the harness could not answer ${url.href}: ${error.message}`);
        }
      }
    });

    await use({
      data,
      // The address of a page of the site, from its root
      url: (rel = '') => new URL(rel, `${origin}/`).href,
      // The console's warnings so far
      warnings,
      // How many map tiles have been asked for so far
      tiles: () => tiles,
      // Hold the API's answers at this path until release() is called. `arrived`
      // resolves when the first request for it does.
      hold(pathname) {
        const hold = { pathname };
        hold.arrivedOnce = new Promise(resolve => (hold.arrived = resolve));
        hold.released = new Promise(resolve => (hold.release = resolve));
        holds.push(hold);
        return { arrived: hold.arrivedOnce, release: hold.release };
      },
    });

    for (const hold of holds) hold.release();
    expect(problems, 'problems while the check ran').toEqual([]);
  },
});

export { expect };

// ── Helpers for the checks ────────────────────────────────────────

/**
 * The canvases under the element, in its shadow roots too, that have something
 * drawn on them: each one's id, the `part` of the closest element that has one
 * ('canvases' for WaveSurfer's waveform), and its height on the page.
 */
export function drawnCanvases(locator) {
  return locator.evaluate(root => {
    const canvases = [];
    const walk = node => {
      canvases.push(...node.querySelectorAll('canvas'));
      for (const el of node.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(root);
    return canvases.filter(canvas => {
      try {
        if (!canvas.width || !canvas.height) return false;
        const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) return true;
      } catch (_) { /* a canvas drawn elsewhere, or not readable */ }
      return false;
    }).map(canvas => ({
      id: canvas.id,
      part: canvas.closest('[part]')?.getAttribute('part') ?? '',
      height: Math.round(canvas.getBoundingClientRect().height),
    }));
  });
}

/**
 * Check that the recordings map is drawn: tiles loaded at this zoom (6 once it is
 * framed on the fixture's places, 2 for the whole world), and these many markers,
 * all within the map.
 */
export async function expectMapDrawn(page, { zoom, markers }) {
  const map = page.locator('#map-canvas');
  await expect(map.locator(`img.leaflet-tile-loaded[src^="https://tile.openstreetmap.org/${zoom}/"]`).first()).toBeVisible();
  await expect(map.locator('.leaflet-marker-icon')).toHaveCount(markers);
  const inside = await map.evaluate(el => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll('.leaflet-marker-icon')].map(marker => {
      const at = marker.getBoundingClientRect();
      return at.left >= box.left && at.right <= box.right && at.top >= box.top && at.bottom <= box.bottom;
    });
  });
  expect(inside, 'markers within the map').toEqual(inside.map(() => true));
}

// A button of the site's main navigation
export const nav = (page, name) =>
  page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name, exact: true });
