// Tests for the core's default config: the empty source, and the recording-type rules.
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
