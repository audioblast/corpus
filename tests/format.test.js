// Tests for the helpers that the app and the tools share (js/format.js):
// escaping, the two URL checks and taxon names. That this file runs at all
// shows that the module loads in Node, as the tools need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, safeUrl, httpUrl, subgenusBrackets, ITALIC_RANKS, isOwnLevel } from '../js/format.js';

test('esc escapes the characters that are special in HTML text and attributes', () => {
  assert.equal(esc(`<a href="x" title='y'>Tom & Jerry</a>`),
    '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;');
  assert.equal(esc('Gryllus campestris'), 'Gryllus campestris');
});

test('esc writes nothing for a missing value, and anything else as text', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(7), '7');
  assert.equal(esc(false), 'false');
});

test('safeUrl keeps web, mail and relative addresses, and drops any other scheme', () => {
  for (const url of ['https://example.org/a?b=1', 'http://example.org/', 'mailto:someone@example.org',
                     '/r/7/', '#top', '?id=7', 't/2/', 'view']) {
    assert.equal(safeUrl(url), url);
  }
  assert.equal(safeUrl('  https://example.org/  '), 'https://example.org/');
  for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<p>x</p>',
                     'vbscript:x', '', null, undefined]) {
    assert.equal(safeUrl(url), '', String(url));
  }
});

test('httpUrl keeps only absolute web addresses', () => {
  assert.equal(httpUrl('https://creativecommons.org/licenses/by/4.0/'), 'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(httpUrl('  HTTP://example.org/7.wav '), 'HTTP://example.org/7.wav');
  for (const url of ['view', '/r/7/', '//example.org/x', 'https:example.org', 'mailto:someone@example.org',
                     'javascript:alert(1)', 'data:text/html,x', '', null, undefined]) {
    assert.equal(httpUrl(url), '', String(url));
  }
});

test('subgenusBrackets brackets a subgenus, which starts with a capital', () => {
  assert.equal(subgenusBrackets('Aus Bus'), 'Aus (Bus)');
  assert.equal(subgenusBrackets('Aus Bus cus'), 'Aus (Bus) cus');
  assert.equal(subgenusBrackets('Aus Bus cus dus'), 'Aus (Bus) cus dus');
  assert.equal(subgenusBrackets('Aus bus cus'), 'Aus bus cus');
  assert.equal(subgenusBrackets('Gryllus'), 'Gryllus');
});

test('names are italic at genus rank and below', () => {
  for (const rank of ['genus', 'subgenus', 'species', 'subspecies', 'variety', 'form', 'infraspecies']) {
    assert.equal(ITALIC_RANKS.has(rank), true, rank);
  }
  // Callers lower-case the rank first.
  for (const rank of ['family', 'tribe', 'order', 'Genus']) {
    assert.equal(ITALIC_RANKS.has(rank), false, rank);
  }
});

test('isOwnLevel finds a taxon at its own level, by its name and its rank', () => {
  assert.equal(isOwnLevel('Crassiclitellata', 'Order', 'Order', 'Crassiclitellata'), true);
  assert.equal(isOwnLevel('Crassiclitellata', 'order', 'Order', 'Crassiclitellata'), true);
  assert.equal(isOwnLevel('Crassiclitellata', 'Order', 'Class', 'Clitellata'), false);
  assert.equal(isOwnLevel('Aus', 'Genus', 'Genus', ''), false);
  // A genus that shares its name with its class is the genus, not the class
  assert.equal(isOwnLevel('Aus', 'Genus', 'Class', 'Aus'), false);
  assert.equal(isOwnLevel('Aus', 'Genus', 'Genus', 'Aus'), true);
});

test('isOwnLevel goes by the name alone for a taxon with no rank', () => {
  for (const rank of ['', null, undefined]) {
    assert.equal(isOwnLevel('Aus', rank, 'Class', 'Aus'), true, String(rank));
    assert.equal(isOwnLevel('Aus', rank, 'Class', 'Bus'), false, String(rank));
  }
});
