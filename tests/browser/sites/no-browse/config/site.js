// The config of the "no-browse" check site: the collection's site, on the same
// collection (data/no-browse.js), without Browse taxa and the recordings map, as a
// site may leave them out (features, in js/config.js).
export default {
  source: 'test-collection',
  siteName: 'Test collection',
  siteTagline: 'Browser checks',
  siteDescription: 'A collection for the browser checks, without Browse taxa and the map.',

  excludeRecordingTypes: ['Soundscape'],
  soundscapeTypes: ['Soundscape'],

  features: { browse: false, map: false },
};
