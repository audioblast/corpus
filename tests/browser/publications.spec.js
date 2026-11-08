// Browser checks on publications in the "collection" check site (data/collection.js): a
// publication's own page, the publications on a recording's page, and a taxon's Literature
// and Descriptions tabs, with the links between them. Each check also fails on a console error
// and on a request the harness's fakes don't answer (harness.js).
import { test, expect } from './harness.js';

const RECORDING_7 = 'Field cricket calling song';
const CRICKET = 'Gryllus (Gryllus) campestris';   // taxon 6, as the app shows it
const TITLE = 'Calling songs of field crickets';
const CITATION = 'Ragge, D. R. (1990). Calling songs of field crickets. Bulletin of Insects, 59(1): 1-35.';

test('a publication has its own page, with its citation and the recording and taxon it links to', async ({ page, site }) => {
  await page.goto(site.url('p/40/'));
  await expect(page.locator('#publication-content h1')).toHaveText(TITLE);
  await expect(page).toHaveTitle(new RegExp(`^${TITLE} — `));
  await expect(page.locator('#publication-content')).toContainText(CITATION);
  await expect(page.locator('#publication-content .detail-action-link', { hasText: 'DOI' })).toHaveAttribute(
    'href', 'https://doi.org/10.0000/fixture.40');

  // The recording that cites it opens. The page's requests finish first, so that a click that
  // leaves the page doesn't cancel one of them.
  await page.waitForLoadState('networkidle');
  await page.locator('#publication-content a', { hasText: RECORDING_7 }).click();
  await expect(page.locator('#detail-content h1')).toHaveText(RECORDING_7);
  await expect(page).toHaveURL(site.url('r/7/'));
});

test('a recording lists the publications that cite it, and the list opens each', async ({ page, site }) => {
  await page.goto(site.url('r/7/'));
  await expect(page.locator('#detail-content h1')).toHaveText(RECORDING_7);

  const publications = page.locator('#detail-publications-block');
  await expect(publications.locator('a')).toHaveCount(1);
  await expect(publications.locator('a')).toContainText(TITLE);
  await publications.locator('a').click();
  await expect(page).toHaveURL(site.url('p/40/'));
  await expect(page.locator('#publication-content h1')).toHaveText(TITLE);
});

test('a taxon has Literature and Descriptions tabs, with its publications and its descriptions', async ({ page, site }) => {
  await page.goto(site.url('t/6/'));
  await expect(page.locator('#taxon-content h1')).toHaveText(CRICKET);

  await page.locator('#taxon-tabbtn-literature').click();
  await expect(page.locator('#literature-content .results-count')).toHaveText('1 publication');
  await expect(page.locator('#literature-content a', { hasText: TITLE })).toHaveCount(1);

  await page.locator('#taxon-tabbtn-descriptions').click();
  await expect(page.locator('#descriptions-content')).toContainText('Males call from grass stems at dusk.');
  await page.waitForLoadState('networkidle');
  await page.locator('#descriptions-content a', { hasText: TITLE }).click();
  await expect(page).toHaveURL(site.url('p/40/'));
  await expect(page.locator('#publication-content h1')).toHaveText(TITLE);
});
