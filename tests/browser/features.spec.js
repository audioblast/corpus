// Browser checks on the check sites that leave features out (features, in
// js/config.js): "no-browse", without Browse taxa and the recordings map, and
// "no-traits", without Browse traits and Browse annotations. Both show the collection
// in data/collection.js. A feature that is off has no place in the page, its address
// shows home, and the app asks the API for none of it.
import { test, expect, nav } from './harness.js';

const RECORDING_7 = 'Field cricket calling song';
const CRICKET = 'Gryllus (Gryllus) campestris';   // "Gryllus Gryllus campestris", as the app shows it

// The addresses of the requests the page makes, from now on.
function requestsFrom(page) {
  const urls = [];
  page.on('request', request => urls.push(request.url()));
  return urls;
}

const navButtons = page => page.getByRole('navigation', { name: 'Primary' }).getByRole('button');

// The address shows the home page, with its recent recordings.
async function expectHome(page) {
  await expect(page.locator('.page.active')).toHaveAttribute('id', 'page-home');
  await expect(page.locator('#featured-list .card-title')).toHaveCount(3);
}

test.describe('without Browse taxa and the map', () => {
  test.use({ siteName: 'no-browse' });

  test('the page has neither, their addresses show home, and neither is loaded', async ({ page, site }) => {
    const requests = requestsFrom(page);
    await page.goto(site.url());
    await expect(navButtons(page)).toHaveText(['Search', 'Browse traits', 'Browse annotations', 'About']);
    await expect(page.locator('.hero-actions button')).toHaveText(['Search recordings']);
    for (const [stat, count] of [['recordings', '5'], ['taxa', '9'], ['traits', '3'], ['annotations', '3']]) {
      await expect(page.locator(`#stat-${stat} strong`)).toHaveText(count);
    }
    await expectHome(page);

    // With Browse taxa, the tree is loaded once the page is idle, or 2 s after it
    // loads where there is no requestIdleCallback (Safari). Give it the time it would take.
    await page.waitForTimeout(3500);

    for (const address of ['?page=browse', '?page=map']) {
      await page.goto(site.url(address));
      await expectHome(page);
    }

    expect(requests.filter(url => /\/data\/recordings\/\?.*page_size=10000|\/data\/traits\//.test(url)),
      "the tree's requests").toEqual([]);
    expect(requests.filter(url => /\/data\/(links|specimens)\/|\/js\/map\.js|leaflet|tile\.openstreetmap\.org/.test(url)),
      "the map's code and requests").toEqual([]);
  });

  test('a recording still leads to its taxon, which has its own page', async ({ page, site }) => {
    await page.goto(site.url('r/7/'));
    await expect(page.locator('#detail-content h1')).toHaveText(RECORDING_7);

    await page.locator('#taxon-links .taxon-name', { hasText: CRICKET }).click();
    await expect(page.locator('#taxon-content h1')).toHaveText(CRICKET);
    await expect(page).toHaveURL(site.url('t/6/'));
    await expect(page.locator('#taxon-content').getByRole('tab')).toHaveText(['Recordings', 'Traits', 'Annotations']);
  });
});

test.describe('without Browse traits and Browse annotations', () => {
  test.use({ siteName: 'no-traits' });

  test('the page, the tree and taxa leave them out, their addresses show home, and neither is asked for', async ({ page, site }) => {
    const requests = requestsFrom(page);
    await page.goto(site.url());
    await expect(navButtons(page)).toHaveText(['Search', 'Browse taxa', 'Recordings map', 'About']);
    await expect(page.locator('.header-stat')).toHaveCount(2);
    await expect(page.locator('#stat-recordings strong')).toHaveText('5');
    await expect(page.locator('#stat-taxa strong')).toHaveText('9');
    await expectHome(page);

    for (const address of ['?page=traits', '?page=annotations']) {
      await page.goto(site.url(address));
      await expectHome(page);
    }
    // A taxon in the address is a filter on those pages, and with no page, the taxon
    await page.goto(site.url('?page=traits&taxon=Gryllus+Gryllus+campestris'));
    await expect(page.locator('#taxon-content h1')).toHaveText(CRICKET);

    // The tree counts recordings alone
    await nav(page, 'Browse taxa').click();
    await expect(page.locator('#browse-list .taxa-tree-header span')).toHaveText(['Recordings']);
    await expect(page.locator('#browse-list .tree-count').first()).toBeVisible();
    await expect(page.locator('#browse-list .tree-trait-count')).toHaveCount(0);

    // A taxon's page has its recordings alone
    await page.goto(site.url('t/6/'));
    await expect(page.locator('#taxon-count')).toHaveText('2 recordings for Gryllus Gryllus campestris');
    await expect(page.locator('#taxon-content').getByRole('tab')).toHaveText(['Recordings']);

    // A recording keeps its own annotations
    await page.goto(site.url('r/7/'));
    await expect(page.locator('#detail-annotations-block tbody tr')).toHaveCount(2);

    expect(requests.filter(url => /\/data\/(traits|traitstaxa)\//.test(url)), 'traits requests').toEqual([]);
    expect(requests.filter(url => /\/data\/annomate\//.test(url) && !/[?&]source_id=/.test(url)),
      "annotations requests, but a recording's own").toEqual([]);
  });
});
