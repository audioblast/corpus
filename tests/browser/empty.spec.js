// Browser checks on the "empty" check site: a site like soil's, on a source with no
// records (data/empty.js). Every page must show its empty state, without errors.
import { test, expect, expectMapDrawn, nav } from './harness.js';

test.use({ siteName: 'empty' });

test('the home page and search show that there are no recordings, and say why', async ({ page, site }) => {
  await page.goto(site.url());
  for (const stat of ['recordings', 'taxa', 'traits', 'annotations']) {
    await expect(page.locator(`#stat-${stat} strong`)).toHaveText('0');
  }
  await expect(page.locator('#featured-list')).toContainText('No recordings found.');
  // The app reports an empty source, as it does a misspelt one, in the console
  await expect.poll(() => site.warnings.join('\n')).toContain('audioBlast has no records for source "test-empty"');

  const search = page.locator('#main-search');
  await search.fill('cricket');
  await search.press('Enter');
  await expect(page.locator('#results-count')).toHaveText('0 recordings matching "cricket"');
  await expect(page.locator('#results-list')).toContainText('No recordings found.');
});

test('the browse pages show that there is nothing to browse', async ({ page, site }) => {
  await page.goto(site.url());
  await nav(page, 'Browse taxa').click();
  await expect(page.locator('#browse-list')).toContainText('No taxa found.');

  await nav(page, 'Browse traits').click();
  await expect(page.locator('#traits-count')).toHaveText('0 trait measurements');
  await expect(page.locator('#traits-list')).toContainText('No traits found. Try different filters.');

  await nav(page, 'Browse annotations').click();
  await expect(page.locator('#annotations-count')).toHaveText('0 annotations');
  await expect(page.locator('#annotations-list')).toContainText('No annotations found. Try different filters.');
});

test('the map shows the world with no markers, and the about page loads', async ({ page, site }) => {
  await page.goto(site.url());
  await nav(page, 'Recordings map').click();
  await expect(page.locator('#map-count')).toHaveText('No recordings are of a specimen with coordinates yet.');
  await expect(page.locator('#map-note')).toHaveText('');
  await expectMapDrawn(page, { zoom: 2, markers: 0 });

  await nav(page, 'About').click();
  await expect(page.locator('#page-about h2')).toHaveText('About the empty source');
  await expect(page.locator('#about-api-recordings')).toHaveText(
    'GET https://api.audioblast.org/data/recordings/?source=test-empty');
});
