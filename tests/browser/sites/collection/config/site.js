// The config of the "collection" check site: a site like bio's, on the collection in
// data/collection.js. It sets only what differs from the core's defaults, as a site may.
export default {
  source: 'test-collection',
  siteName: 'Test collection',
  siteTagline: 'Browser checks',
  siteDescription: 'A collection for the browser checks.',
  logo: ['Test', 'Collection'],
  hero: { emphasis: 'crickets' },

  // As bio's: Soundscapes are left out of every listing, and have BirdNET results.
  excludeRecordingTypes: ['Soundscape'],
  soundscapeTypes: ['Soundscape'],
};
