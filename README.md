# corpus

The shared front end for sites built on an audioBLAST collection: the app (`js/`), its base stylesheet (`css/style.css`), the page skeleton (`skeleton/`), and the tools that make a site's pages (`tools/`). A site supplies content only: its settings, copy and colours, in a `config/` folder.

bio.acousti.ca and soil.acousti.ca run on it, and load it from `cdn.audioblast.org/corpus/<version>/`.

## What a site supplies

A `config/` folder, with:

- `site.js`: its settings and copy, with the shape of `js/config.js`. It sets `source` and whatever differs from the defaults: names, logo, hero, filter examples, links, recording types and map tiles.
- `about.html`: the About page's content, an HTML fragment that the app loads into the page.
- `theme.css`, if the site has its own colours (see Styles).

Add a favicon, and a `CNAME` if the site has its own domain.

## A site's page

`tools/build-page.mjs` writes the site's `index.html` and `main.js` from `skeleton/`, filled in from `config/site.js` and pinned to this corpus version. Commit both, and the site runs as it is, with no build step.

A site sets the corpus version it runs on in one place, `corpusVersion` in `config/site.js`. The tool stops if that isn't its own version, and the site's Pages workflow reads the version from there. From the site's root, with this repo checked out at the site's version:

```bash
node ../corpus/tools/build-page.mjs
```

- `--check` writes nothing, and fails if either file is not what this version writes. A site's Pages workflow runs it, so a hand edit, or a change to `config/site.js` without a rebuild, stops the deploy.
- `--core` loads the core from somewhere else, to test a version that isn't on the CDN yet, and skips the version check.

The page's Content-Security-Policy and preconnect hints come from the skeleton, and the basemap's host from `mapTiles`, so nothing in the page is copied by hand. To move a site to another version, change `corpusVersion`, run that version's `build-page.mjs` and review the diff.

`main.js` imports `start()` from the core and hands it the site's config. `start()` merges that config over `js/config.js` and then sets up the page, so the core's modules never read a site's values before that. The tools merge it the same way.

The tools also use the app's own escaping, URL checks and taxon names, from `js/format.js`. Node loads that module, so it imports nothing and touches no browser globals.

## Static pages

From the site's root, after its pages are assembled (see bio's `.github/workflows/pages.yml`):

```bash
node corpus/tools/build-static.mjs --site https://example.org --out _site
```

`--site` is required. `--config` (default `config/site.js`) and `--page` (default `index.html`) name the site's files, and `--base` is the path the site is served from. Node 22, as the Pages workflow uses.

## Versions

`package.json` holds the version, and `build-page.mjs` pins a site's page to it. A published version folder should never change afterwards, because Cloudflare caches a request for a file that doesn't exist yet as a 404. Publishing to `cdn.audioblast.org/corpus/<version>/` is manual for now.

0.2.0 moves the page skeleton into corpus. To move a site from 0.1.x:

1. Move `site.js`, `about.html` and `css/theme.css` into `config/`.
2. Add `corpusVersion`, `logo`, `hero` and, if the defaults don't suit the collection, `examples` to `config/site.js`.
3. Run `build-page.mjs`, which replaces the hand-written `index.html` and `main.js`.
4. In the Pages workflow, read the version from `corpusVersion` in `config/site.js` instead of setting `CORPUS_VERSION`, copy `config/` into the build, replace the version-pin check with `build-page.mjs --check`, and drop `--config site.js` from the static-page step. bio's `pages.yml` shows each of these.

## Tests

`npm test` runs the tests in `tests/`, with no network access:

- the helpers that the app and the tools share (`js/format.js`): escaping, the two URL checks and taxon names;
- the static-page generator, against a fake audioBlast API: a page for each recording and taxon, requests scoped to the source, a source with no records (only the sitemap and robots.txt, with a warning), and failures that must be clear;
- the page builder: a site's page and `main.js` from its `config/`, with escaping, the defaults a site leaves out and its own basemap host; a theme link only when there is a theme; `--core` and `--check`; and a page the static-page generator builds on;
- the default config: the empty source, and the recording-type rules.

`npm run test:browser` runs the browser checks in `tests/browser/`, with Playwright, in Chromium, Firefox and WebKit. They run the app on two check sites, made as a site is made: one on a small collection like bio's, and one on a source with no records, like soil's. A harness answers every request the pages make, so the checks never reach the live API, the tile server or the CDN. They cover the home page, search, the browse pages, a recording's page and its player, taxon pages, the About page and the recordings map, and fail on any console error. Before the first run, install the dependencies and the browsers with `npm ci` and `npx playwright install`. See `tests/browser/README.md` for how the fakes work, and what to change when the app does.

`.github/workflows/test.yml` syntax-checks the modules, the tools and the tests, then runs `npm test` on each push and pull request, and the browser checks in a job for each browser.

## Styles

The base stylesheet, `css/style.css`, is neutral. Every colour in it is a variable, with a neutral default in `:root`. A site sets its own colours in `config/theme.css`, which loads after the base and overrides the variables:

- `--bg`, `--bg2`, `--bg3`, `--surface`, `--surface2`: the page and card backgrounds.
- `--accent`, `--accent2`, `--accent-dim`, `--accent-dim2`, `--on-accent`: buttons, links and the logo.
- `--text`, `--text2`, `--text3`: text, from strongest to muted. Keep `--text3` at 4.5:1 or better on the backgrounds.
- `--border`, `--border2`, `--red`, `--amber`: lines, errors and notes.
- `--header-bg`, `--note-bg`, `--note-border`, `--error-bg`, `--error-border`, `--tag-taxon-border`, `--tag-type-border`, `--tag-type-bg`, `--axis-border`, `--label-text`, `--label-bg`, `--label-border`, `--dot-ring`, `--play-icon-on-accent`: the remaining colours the base used to fix.

The shadows are black, which is neutral, so they are not variables.

## Browser support

As bio: Chrome 80, Safari 13.1, Firefox 74, Edge 80. `js/compat-check.js` and `js/nomodule-warning.js` show a message to anything older.

## Licence

GNU General Public License, version 2 or (at your option) any later version: see `LICENSE`. The libraries in `js/vendor/` keep their own licences, with a `LICENSE` file in each folder: BSD-2-Clause for Leaflet and MIT for Leaflet.markercluster. Both are compatible with the GPL.
