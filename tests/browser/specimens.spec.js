// Browser checks on specimens in the "collection" check site (data/collection.js): a
// specimen's own page, the list of specimens on a recording's page, and a taxon's
// Specimens tab, with the links between them. Each check also fails on a console error,
// and on a request the harness's fakes don't answer (harness.js).
import { test, expect, expectMapDrawn, nav } from './harness.js';

const RECORDING_7 = 'Field cricket calling song';
const CRICKET = 'Gryllus (Gryllus) campestris';   // taxon 6, as the app shows it

test('a specimen has its own page, with its details and the taxon it is identified as', async ({ page, site }) => {
  await page.goto(site.url('s/S1/'));
  await expect(page.locator('#specimen-content h1')).toHaveText('Gryllus campestris');
  await expect(page).toHaveTitle(/^Gryllus campestris #S1 — /);

  const details = page.locator('#specimen-content .meta-table').first();
  await expect(details.locator('tr', { hasText: 'Country' })).toContainText('GB');
  await expect(details.locator('tr', { hasText: 'Identified as' })).toContainText(CRICKET);

  // Once the app has drawn the page, the taxon's name opens the taxon's own page
  await details.locator('.taxon-name', { hasText: CRICKET }).click();
  await expect(page.locator('#taxon-content h1')).toHaveText(CRICKET);
  await expect(page).toHaveURL(site.url('t/6/'));
});

test('a specimen shows the recording it is of, which opens', async ({ page, site }) => {
  await page.goto(site.url('s/S1/'));
  await expect(page.locator('#specimen-content')).toContainText('Recordings');
  await page.locator('#specimen-content .meta-table').nth(1).locator('a', { hasText: RECORDING_7 }).click();
  await expect(page.locator('#detail-content h1')).toHaveText(RECORDING_7);
  await expect(page).toHaveURL(site.url('r/7/'));
});

test('a recording lists the specimens it is of, and the list opens each', async ({ page, site }) => {
  await page.goto(site.url('r/7/'));
  await expect(page.locator('#detail-content h1')).toHaveText(RECORDING_7);

  const specimens = page.locator('#detail-specimens-block');
  await expect(specimens.locator('a')).toHaveCount(1);
  await expect(specimens.locator('a')).toContainText('Gryllus campestris');
  await specimens.locator('a').click();
  await expect(page).toHaveURL(site.url('s/S1/'));
  await expect(page.locator('#specimen-content h1')).toHaveText('Gryllus campestris');
});

test('a taxon has a Specimens tab, with the specimens of the taxa under it', async ({ page, site }) => {
  await page.goto(site.url('t/5/'));
  await expect(page.locator('#taxon-content h1')).toHaveText('Gryllus');
  await page.locator('#taxon-tabbtn-specimens').click();

  // S4 is identified as the genus; S1 and S2 as the species under it
  await expect(page.locator('#specimens-content .results-count')).toHaveText('3 specimens');
  await expect(page.locator('#specimens-content tr')).toHaveCount(3);
  await expect(page.locator('#specimens-content a[href$="s/S1/"]')).toHaveCount(1);
});

test('a species lists its own specimens; a specimen identified as no taxon has no taxonomy', async ({ page, site }) => {
  await page.goto(site.url('t/6/'));
  await page.locator('#taxon-tabbtn-specimens').click();
  await expect(page.locator('#specimens-content .results-count')).toHaveText('2 specimens');

  // S5 is of a recording the site excludes, and identified as no taxon
  await page.goto(site.url('s/S5/'));
  await expect(page.locator('#specimen-content h1')).toHaveText('Unknown');
  await expect(page.locator('#specimen-content')).not.toContainText('Taxonomy');
  await expect(page.locator('#specimen-content')).not.toContainText('Recordings');
});

test('a map popup names each specimen with its number, and links it to its page', async ({ page, site }) => {
  await page.goto(site.url('?page=map'));
  await expectMapDrawn(page, { zoom: 6, markers: 3 });

  // The French place's specimen is S3, of recording 8
  await page.getByTitle('1 recording, France').click();
  const popup = page.locator('.leaflet-popup');
  const specimen = popup.getByRole('link', { name: 'Tettigonia viridissima #S3' });
  await expect(specimen).toHaveAttribute('href', 's/S3/');
  await specimen.click();
  await expect(page.locator('#specimen-content h1')).toHaveText('Tettigonia viridissima');
  await expect(page).toHaveURL(site.url('s/S3/'));
});

test('Browse specimens lists the specimens, filters them, and opens one', async ({ page, site }) => {
  await page.goto(site.url());
  await nav(page, 'Browse specimens').click();
  const rows = page.locator('#specimens-list tbody tr');
  await expect(page.locator('#specimens-count')).toHaveText('5 specimens');
  await expect(rows).toHaveCount(5);

  // The country is an exact code; the name and the collector match part of a name
  await page.locator('#specimens-country').fill('FR');
  await page.locator('#specimens-search-btn').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Tettigonia viridissima');

  await page.locator('#specimens-country').fill('');
  await page.locator('#specimens-name').fill('gryllus');
  await page.locator('#specimens-search-btn').click();
  await expect(rows).toHaveCount(3);

  await page.locator('#specimens-name').fill('');
  await page.locator('#specimens-collector').fill('collector');
  await page.locator('#specimens-search-btn').click();
  await expect(rows).toHaveCount(5);

  // A basis of record that no specimen has leaves the list empty
  await page.locator('#specimens-collector').fill('');
  await page.locator('#specimens-basis').fill('LivingSpecimen');
  await page.locator('#specimens-search-btn').click();
  await expect(page.locator('#specimens-list')).toContainText('No specimens found.');

  await page.locator('#specimens-basis').fill('PreservedSpecimen');
  await page.locator('#specimens-search-btn').click();
  await expect(rows).toHaveCount(5);

  // A row opens its specimen's page
  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(site.url('s/S1/'));
  await expect(page.locator('#specimen-content h1')).toHaveText('Gryllus campestris');
});
