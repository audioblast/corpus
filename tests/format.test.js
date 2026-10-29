// Tests for the helpers that the app and the tools share (js/format.js):
// escaping, the two URL checks and taxon names. That this file runs at all
// shows that the module loads in Node, as the tools need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, safeUrl, httpUrl, subgenusBrackets, ITALIC_RANKS } from '../js/format.js';

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
