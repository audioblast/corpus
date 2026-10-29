// Tests for the core's default config: the empty source, the recording-type rules, and
// the features.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../js/config.js';

test('the default config has no source, so a site must set one', () => {
  assert.equal(config.source, null);
});

test('by default every recording type is shown', () => {
  assert.equal(config.recordingTypeAllowed('Call'), true);
  assert.equal(config.recordingTypeAllowed(undefined), true);
});

test('the include and exclude lists match types case-insensitively', () => {
  const saved = { include: config.includeRecordingTypes, exclude: config.excludeRecordingTypes };
  try {
    config.includeRecordingTypes = ['call'];
    assert.equal(config.recordingTypeAllowed('CALL'), true);
    assert.equal(config.recordingTypeAllowed('Song'), false);

    config.includeRecordingTypes = [];
    config.excludeRecordingTypes = ['Soundscape'];
    assert.equal(config.recordingTypeAllowed('soundscape'), false);
    assert.equal(config.recordingTypeAllowed('Call'), true);
  } finally {
    config.includeRecordingTypes = saved.include;
    config.excludeRecordingTypes = saved.exclude;
  }
});

test('every feature is on by default, and a site turns one off by naming it alone', () => {
  for (const name of ['browse', 'traits', 'annotations', 'map']) assert.equal(config.hasFeature(name), true);
  assert.equal(config.hasFeature('about'), true, 'a page that is not a feature is always there');

  const saved = config.features;
  try {
    // start() puts the site's features in place of the defaults.
    config.features = { map: false };
    assert.equal(config.hasFeature('map'), false);
    assert.equal(config.hasFeature('browse'), true, 'a feature the site does not name is on');
  } finally {
    config.features = saved;
  }
});
