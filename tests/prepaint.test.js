// Tests for prepaint.js, which shows the page an address is for before the app has
// loaded: in the order the app's router takes them, and with no page for a feature
// the site leaves out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const PREPAINT = await fs.readFile(new URL('../js/prepaint.js', import.meta.url), 'utf8');
const PAGES = ['home', 'browse', 'traits', 'annotations', 'map', 'about', 'detail', 'taxon'];

// The page prepaint.js shows for an address, in a page that has these pages.
function prepaint(address, pages = PAGES) {
  const url = new URL(address, 'https://example.test/');
  const shown = [];
  vm.runInNewContext(PREPAINT, {
    URLSearchParams,
    location: { search: url.search, pathname: url.pathname },
    document: {
      getElementById: id => pages.includes(id.slice('page-'.length))
        ? { classList: { add: () => shown.push(id.slice('page-'.length)) } }
        : null,
    },
  });
  return shown.join();
}

test('an address shows its page', () => {
  assert.equal(prepaint('/'), 'home');
  assert.equal(prepaint('/?id=7'), 'detail');
  assert.equal(prepaint('/r/7/'), 'detail');
  assert.equal(prepaint('/t/1/'), 'taxon');
  assert.equal(prepaint('/?taxon=Gryllus'), 'taxon');
  for (const page of ['browse', 'traits', 'annotations', 'map', 'about']) {
    assert.equal(prepaint(`/?page=${page}`), page);
  }
  assert.equal(prepaint('/?page=detail'), 'home', 'only a named page is shown by name');
});

test('on the traits and annotations pages, a taxon in the address is a filter', () => {
  assert.equal(prepaint('/?page=traits&taxon=Gryllus'), 'traits');
  assert.equal(prepaint('/?page=annotations&taxon=Gryllus'), 'annotations');
  assert.equal(prepaint('/?page=browse&taxon=Gryllus'), 'taxon');
});

test('the address of a feature the site leaves out shows home, or the taxon it names', () => {
  const pages = PAGES.filter(page => page !== 'map' && page !== 'traits');
  assert.equal(prepaint('/?page=map', pages), 'home');
  assert.equal(prepaint('/?page=traits', pages), 'home');
  assert.equal(prepaint('/?page=traits&taxon=Gryllus', pages), 'taxon');
});
