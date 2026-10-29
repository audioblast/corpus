# Browser checks

These checks run the app in Chromium, Firefox and WebKit with [Playwright](https://playwright.dev). They cover what used to be checked by hand: the home page, search, the browse pages, a recording's page and its player, taxon pages, the About page, the recordings map, a source with no records, and sites that leave features out. `npm test` doesn't run them: it stays fast, with no dependencies.

## Running them

Once:

```bash
npm ci
npx playwright install
```

That downloads the three browsers, about 500 MB. Then:

```bash
npm run test:browser
npm run test:browser -- --project=chromium
npm run test:browser -- -g "map"
npm run test:browser -- --ui
```

The second line runs one browser and the third the checks whose names match. The last opens Playwright's window, where a check can be stepped through. Playwright's WebKit for Windows has no Web Audio, so there the two checks that need the player are skipped. CI runs WebKit on Linux, which has it.

In CI, `.github/workflows/test.yml` runs them in a job for each browser. A check that passes only on its retry is reported as flaky. A job that fails keeps Playwright's report and the failed check's trace as an artifact for a week. Open a trace with `npx playwright show-trace <file>`.

## The check sites

`sites/` holds four sites' `config/` folders, as a real site has:

- `collection`, like bio's, on the collection in `data/collection.js`. It has two families of Orthoptera, a name with a subgenus, recordings identified to species and to genus, traits, annotations and specimens. It also has a Soundscape, which the site leaves out, and a recording whose specimen has no coordinates.
- `empty`, like soil's, on a source with no records (`data/empty.js`).
- `no-browse` and `no-traits`, on the same collection as `collection`, each with features left out (`features` in `js/config.js`): Browse taxa and the map, or Browse traits and Browse annotations. `features.spec.js` checks that a feature that is off has no place in the page, that its address shows home, and that the app makes none of its requests.

Each worker assembles a site once, in a temp folder, as a site's Pages workflow does: `tools/build-page.mjs` writes its `index.html` and `main.js`, and `tools/build-static.mjs` writes its recording and taxon pages from the fake API. The page's preconnect hints are taken out, because they open connections that the harness can't answer.

## The fakes

`harness.js` answers every request the browser makes:

| Address | Answer |
|---|---|
| `https://<site>.test/` | the assembled site |
| `api.audioblast.org` | `fake-api.js`, from the site's data |
| `cdn.audioblast.org/corpus/<any version>/` | this repo's `js/` and `css/` |
| `cdn.audioblast.org/wavesurfer…/<version>/` | the npm packages of those versions, which hold the same files as the CDN |
| `tile.openstreetmap.org` | a 1×1 grey PNG for every tile |
| `files.example` | a 2-second WAV made in `media.js`, with Range requests |

A check fails, after it has run, on:

- any console error or uncaught exception, so a Content-Security-Policy violation fails it too;
- any request to another host;
- a request the fake API or the CDN has no answer for;
- an API request not scoped to the site's source.

## When the app changes

- The app uses a new API endpoint or parameter: the check fails with the request's address. Add the endpoint or parameter to `fake-api.js`, with the matching rules the live API has, which `js/audioblast.js` describes.
- `js/render.js` loads a new version of WaveSurfer or one of its plugins: the check fails and names it. Change the devDependency in `package.json` to that version.
- A page's text or markup changes: change the check. The checks find things by their text and role where they can, and by the app's ids elsewhere.
- A new page or feature: add a check to `collection.spec.js` or `empty.spec.js`, and rows to `data/` if it needs them. If a site can turn it off, check that in `features.spec.js` too.
- A new Playwright: change the devDependency, run `npm install` and `npx playwright install`, and run the checks.
