// Browser checks on the "collection" check site: a site like bio's, on the small
// collection in data/collection.js. Each check also fails on a console error, and
// on a request the harness's fakes don't answer (harness.js).
import { test, expect, drawnCanvases, expectMapDrawn, nav } from './harness.js';

const RECORDING_7 = 'Field cricket calling song';
const CRICKET = 'Gryllus (Gryllus) campestris';   // "Gryllus Gryllus campestris", as the app shows it
const CRICKET_LINEAGE = ['Animalia', 'Insecta', 'Orthoptera', 'Gryllidae', 'Gryllus', CRICKET];

// Playwright's WebKit for Windows has no Web Audio, so the player falls back to a
// plain <audio> there and draws no waveform. Its WebKit for Linux, which CI runs, has.
const skipWithoutWebAudio = browserName =>
  test.skip(browserName === 'webkit' && process.platform === 'win32', 'Playwright\'s WebKit for Windows has no Web Audio');

test('the home page shows the counts and the recent recordings, which open', async ({ page, site }) => {
  await page.goto(site.url());
  await expect(page).toHaveTitle('Test collection — Browser checks');
  for (const [stat, count] of [['recordings', '5'], ['taxa', '9'], ['traits', '3'], ['annotations', '3']]) {
    await expect(page.locator(`#stat-${stat} strong`)).toHaveText(count);
  }
  await expect(page.locator('#featured-list .card-title')).toHaveText([
    RECORDING_7, 'Great green bush-cricket song', 'Cricket in a garden',
  ]);
  expect(site.warnings.join('\n')).not.toContain('has no records');

  // A card opens its recording, whose address becomes the recording's own page
  await page.locator('#featured-list .recording-card').first().click();
  await expect(page.locator('#detail-content h1')).toHaveText(RECORDING_7);
  await expect(page).toHaveURL(site.url('r/7/'));
});

test('search lists what matches, leaves out excluded types, and suggests taxa', async ({ page, site }) => {
  await page.goto(site.url());
  const search = page.locator('#main-search');
  await search.fill('Gryllus');
  await search.press('Enter');
  await expect(page).toHaveURL(site.url('?q=Gryllus'));
  await expect(page.locator('#results-count')).toHaveText('3 recordings matching "Gryllus"');
  await expect(page.locator('#results-list .card-title')).toHaveText([
    RECORDING_7, 'Cricket in a garden', 'Field cricket, second male',
  ]);

  // The Soundscape is "Unknown species", and the site leaves Soundscapes out
  await search.fill('Unknown');
  await search.press('Enter');
  await expect(page.locator('#results-count')).toHaveText('0 recordings matching "Unknown"');
  await expect(page.locator('#results-list')).toContainText('No recordings found.');

  // A suggestion opens its taxon. The search that typing starts comes first, as it
  // does for a visitor, whose suggestions take longer than the fake's to arrive.
  await search.fill('Tetti');
  await expect(page.locator('#results-count')).toHaveText('1 recordings matching "Tetti"');
  await page.locator('.autocomplete-item', { hasText: 'Tettigonia viridissima' }).click();
  await expect(page.locator('#taxon-content h1')).toHaveText('Tettigonia viridissima');
  await expect(page).toHaveURL(site.url('t/9/'));
});

test('browse taxa shows the tree with its counts, and a species opens its taxon', async ({ page, site }) => {
  await page.goto(site.url());
  await nav(page, 'Browse taxa').click();
  await expect(page).toHaveURL(site.url('?page=browse'));
  const tree = page.locator('#browse-list');
  const branch = name => tree.locator('summary', { has: page.locator(`.tree-name--link[data-taxon="${name}"]`) });

  // The kingdom starts open. Open the branches down to the field cricket.
  for (const name of ['Insecta', 'Orthoptera', 'Gryllidae', 'Gryllus']) await branch(name).locator('.tree-rank').click();
  await expect(branch('Orthoptera').locator('.tree-count')).toHaveText('4');
  await expect(branch('Orthoptera').locator('.tree-trait-count')).toHaveText('3');
  const species = tree.locator('.taxa-leaf[data-taxon="Gryllus Gryllus campestris"]');
  await expect(species.locator('.tree-name')).toHaveText(CRICKET);
  await expect(species.locator('.tree-count')).toHaveText('2');
  await expect(species.locator('.tree-page-link')).toHaveAttribute('href', 't/6/');

  await species.click();
  await expect(page.locator('#taxon-content h1')).toHaveText(CRICKET);
  await expect(page).toHaveURL(site.url('t/6/'));
});

test('browse traits lists the traits, and a filter narrows them', async ({ page, site }) => {
  await page.goto(site.url());
  await nav(page, 'Browse traits').click();
  const rows = page.locator('#traits-list tbody tr');
  await expect(page.locator('#traits-count')).toHaveText('3 trait measurements');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText(CRICKET);
  await expect(rows.first()).toContainText('4.5(4.2–4.8)');

  const taxon = page.locator('#traits-taxon');
  await taxon.fill('Tettigonia viridissima');
  await taxon.press('Enter');
  await expect(page).toHaveURL(site.url('?page=traits&taxon=Tettigonia+viridissima'));
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Stridulation');

  // A row's taxon opens its taxon
  await rows.locator('.traits-taxon-link').click();
  await expect(page.locator('#taxon-content h1')).toHaveText('Tettigonia viridissima');
});

test('browse annotations lists the annotations, and a time opens the recording there', async ({ page, site, browserName }) => {
  skipWithoutWebAudio(browserName);
  await page.goto(site.url('?page=annotations'));
  const rows = page.locator('#annotations-list tbody tr');
  await expect(page.locator('#annotations-count')).toHaveText('3 annotations');
  await expect(rows).toHaveCount(3);

  await rows.nth(1).getByRole('link', { name: '1.25–1.75s' }).click();
  await expect(page.locator('#detail-content h1')).toHaveText(RECORDING_7);
  await expect(page).toHaveURL(site.url('r/7/?t=1.25'));
  await expect(page.locator('#ws-time-7')).toHaveText('0:01 / 0:02');
});

test('a recording page shows the recording, its taxonomy and annotations, and plays it', async ({ page, site, browserName }) => {
  skipWithoutWebAudio(browserName);
  await page.goto(site.url('r/7/'));
  const detail = page.locator('#detail-content');
  await expect(detail.locator('h1')).toHaveText(RECORDING_7);
  await expect(page).toHaveTitle(`${RECORDING_7} — Test collection`);
  await expect(detail.locator('div.detail-title')).toHaveText(CRICKET);
  await expect(detail.locator('.detail-meta')).toHaveText('#7 · test-collection');
  await expect(detail.locator('.detail-main > .meta-table')).toContainText('Uploaded byA. Recordist');

  // The taxonomy, from the taxon's row, and the taxon's own page
  await expect(detail.locator('#taxon-links .taxon-name')).toHaveText(CRICKET_LINEAGE);
  await expect(detail.getByRole('link', { name: 'Page for this taxon' })).toHaveAttribute('href', 't/6/');

  // The annotations, the first bounded in frequency
  const annotations = detail.locator('#detail-annotations-block tbody tr');
  await expect(annotations).toHaveCount(2);
  await expect(annotations.first()).toContainText('3 kHz–6 kHz');

  // The player: the duration once the audio is decoded, the waveform, the
  // spectrogram (120 px high) and its frequency axis, and the annotations as regions
  await expect(page.locator('#ws-time-7')).toHaveText('0:00 / 0:02');
  await expect.poll(async () => {
    const drawn = await drawnCanvases(detail);
    return {
      waveform: drawn.some(c => c.part === 'canvases'),
      spectrogram: drawn.some(c => c.height === 120 && !c.id),
      axis: drawn.some(c => c.id === 'ws-freq-7'),
    };
  }).toEqual({ waveform: true, spectrogram: true, axis: true });
  await expect(page.locator('#ws-wave-7 [part~="region"]')).toHaveCount(2);

  // Play starts and stops. How far it gets isn't checked: CI's runners have no sound
  // card, and there Firefox's clock stays at 0:00 while it plays.
  const play = page.locator('#ws-play-7');
  await play.click();
  await expect(play).toHaveClass(/playing/);
  await play.click();
  await expect(play).not.toHaveClass(/playing/);
});

test('a taxon page shows its recordings, traits, annotations and taxonomy', async ({ page, site }) => {
  await page.goto(site.url('t/6/'));
  const taxon = page.locator('#taxon-content');
  await expect(taxon.locator('h1')).toHaveText(CRICKET);
  await expect(page).toHaveTitle(`${CRICKET} — Test collection`);
  await expect(taxon.locator('#taxon-count')).toHaveText('2 recordings for Gryllus Gryllus campestris');
  await expect(taxon.locator('#taxon-recordings .card-title')).toHaveText([RECORDING_7, 'Field cricket, second male']);
  await expect(taxon.locator('#taxon-links .taxon-name')).toHaveText(CRICKET_LINEAGE);
  await expect(taxon.locator('h1')).toHaveClass(/detail-title--italic/);

  await taxon.getByRole('tab', { name: 'Traits' }).click();
  // Grouped by call type and sex: one group has both, the other neither, and no
  // label. /data/traitstaxa/ gives no temperature, so none is shown here.
  await expect(taxon.locator('#traits-content .traits-group-label')).toHaveText(['Calling song · Male']);
  await expect(taxon.locator('#traits-content .traits-table')).toHaveCount(2);
  await expect(taxon.locator('#traits-content .trait-val').first()).toHaveText('4.5 (4.2–4.8)');

  await taxon.getByRole('tab', { name: 'Annotations' }).click();
  await expect(taxon.locator('#annotations-content .traits-group-label')).toHaveText(['Chirp']);
  await expect(taxon.locator('#annotations-content tr')).toHaveCount(2);
});

test('a genus page lists the recordings of the genus and of its species', async ({ page, site }) => {
  await page.goto(site.url('t/5/'));
  const taxon = page.locator('#taxon-content');
  await expect(taxon.locator('h1')).toHaveText('Gryllus');
  await expect(taxon.locator('#taxon-count')).toHaveText('3 recordings for Gryllus');
  await expect(taxon.locator('#taxon-recordings .card-title')).toHaveText([
    RECORDING_7, 'Cricket in a garden', 'Field cricket, second male',
  ]);
});

test('the about page loads the site\'s own about.html', async ({ page, site }) => {
  await page.goto(site.url());
  await nav(page, 'About').click();
  await expect(page).toHaveURL(site.url('?page=about'));
  await expect(page.locator('#page-about h2')).toHaveText('About the test collection');
  await expect(page.locator('#about-api-recordings')).toHaveText(
    'GET https://api.audioblast.org/data/recordings/?source=test-collection');
});

test('the map shows where the specimens were collected, and opens their recordings', async ({ page, site }) => {
  await page.goto(site.url('?page=map'));
  // Three places: the Soundscape's, in Kenya, is left out, as the site leaves out
  // Soundscapes, and one recording's specimen has no coordinates.
  await expect(page.locator('#map-count')).toHaveText('3 recordings at 3 places');
  await expect(page.locator('#map-note')).toHaveText('Not on the map: 1 recording with no specimen coordinates yet.');
  await expectMapDrawn(page, { zoom: 6, markers: 3 });

  await page.getByTitle('1 recording, France').click();
  const popup = page.locator('.leaflet-popup');
  await expect(popup.locator('.map-popup-place')).toContainText('France');
  await popup.getByRole('link', { name: 'Great green bush-cricket song' }).click();
  await expect(page.locator('#detail-content h1')).toHaveText('Great green bush-cricket song');
  await expect(page).toHaveURL(site.url('r/8/'));
});

test('the map is drawn when it is left while it loads, and opened again', async ({ page, site }) => {
  // The map waits for the links between recordings and specimens; the check
  // leaves its page before they arrive.
  const links = site.hold('/data/links/');
  await page.goto(site.url('?page=map'));
  await links.arrived;
  await nav(page, 'Search').click();
  links.release();

  // The map is made while its page is hidden...
  await expect(page.locator('#map-count')).toHaveText('3 recordings at 3 places');
  // ...and when the page opens again, it is framed on the places, with its tiles.
  await nav(page, 'Recordings map').click();
  await expectMapDrawn(page, { zoom: 6, markers: 3 });
});
