# corpus

The shared front end for sites built on an audioBLAST collection: the app (`js/`), its base stylesheet (`css/style.css`) and the static-page generator (`tools/build-static.mjs`). A site is a thin shell around it: its own config, page and copy.

This is the first extraction from bio.acousti.ca. bio still runs its own copy of this code and has not been switched over yet.

## What a site supplies

- `site.js`: its config, with the shape of `js/config.js`. It sets `source` and overrides whatever differs: names, links, recording types, map tiles.
- `index.html`: the page the app runs in. For now, copy it from bio and change the branding and copy. The generator checks it for the loading slots and page containers the app draws into (see `APP_PAGE` in `tools/build-static.mjs`).
- `about.html`, which the app loads from the page's own folder, and a stylesheet that overrides the variables at the top of `css/style.css`. Add a favicon, and a `CNAME` if the site has its own domain.

## Running the app

The page loads the core and hands it the site's config:

```html
<script type="module">
  import { start } from './corpus/js/app.js';
  import site from './site.js';
  start(site);
</script>
```

Here `corpus/` is a copy of this repo's `js/` and `css/`. Once a version is published, the page can import `https://cdn.audioblast.org/corpus/<version>/js/app.js` instead. Keep the classic scripts from bio's `index.html` as well, before the module: `js/nomodule-warning.js`, `js/compat-check.js` and `js/prepaint.js`, in that order.

`start()` merges the site's config over `js/config.js` and then sets up the page, so the core's modules never read a site's values before that.

## Static pages

From the site's root, after its pages are assembled (see bio's `.github/workflows/pages.yml`):

```bash
node corpus/tools/build-static.mjs --site https://example.org --out _site
```

`--site` is required. `--config` (default `site.js`) and `--page` (default `index.html`) name the site's files, and `--base` is the path the site is served from. Node 22, as the Pages workflow uses.

## Versions

`package.json` holds the version. A published version folder should never change afterwards, because Cloudflare caches a request for a file that doesn't exist yet as a 404. Publishing to `cdn.audioblast.org/corpus/<version>/` is manual for now.

## Tests

`npm test` runs the tests in `tests/`, with no network access:

- the static-page generator, against a fake audioBlast API: a page for each recording and taxon, requests scoped to the source, a source with no records (only the sitemap and robots.txt, with a warning), and failures that must be clear;
- the default config: the empty source, and the recording-type rules.

`.github/workflows/test.yml` syntax-checks the modules, the generator and the tests, then runs `npm test` on each push and pull request. Browser tests are not in CI yet.

## Styles

The base stylesheet, `css/style.css`, is neutral. Every colour in it is a variable, with a neutral default in `:root`. A site sets its own colours in its own stylesheet, `css/theme.css`, which loads after the base and overrides the variables:

- `--bg`, `--bg2`, `--bg3`, `--surface`, `--surface2`: the page and card backgrounds.
- `--accent`, `--accent2`, `--accent-dim`, `--accent-dim2`, `--on-accent`: buttons, links and the logo.
- `--text`, `--text2`, `--text3`: text, from strongest to muted. Keep `--text3` at 4.5:1 or better on the backgrounds.
- `--border`, `--border2`, `--red`, `--amber`: lines, errors and notes.
- `--header-bg`, `--note-bg`, `--note-border`, `--error-bg`, `--error-border`, `--tag-taxon-border`, `--tag-type-border`, `--tag-type-bg`, `--axis-border`, `--label-text`, `--label-bg`, `--label-border`, `--dot-ring`, `--play-icon-on-accent`: the remaining colours the base used to fix.

The shadows are black, which is neutral, so they are not variables.

## Browser support

As bio: Chrome 80, Safari 13.1, Firefox 74, Edge 80. `js/compat-check.js` and `js/nomodule-warning.js` show a message to anything older.

## Still to do

- Move the page skeleton into this repo, so a site supplies content only.
- Replace the copies of `esc`, `safeUrl` and `subgenusBrackets` in the generator with imports from `js/`. That needs a split the generator can load in Node.
- Automate the browser checks in CI. So far they have been run by hand, on test shells for bio's collection and for an empty source (soil, which has no records yet).
- Settle the licence. bio's site code is MIT.
