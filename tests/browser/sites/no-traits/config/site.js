// The config of the "no-traits" check site: the collection's site, on the same
// collection (data/no-traits.js), without Browse traits and Browse annotations, as a
// site may leave them out (features, in js/config.js).
export default {
  source: 'test-collection',
  siteName: 'Test collection',
  siteTagline: 'Browser checks',
  siteDescription: 'A collection for the browser checks, without traits and annotations.',

  excludeRecordingTypes: ['Soundscape'],
  soundscapeTypes: ['Soundscape'],

  features: { traits: false, annotations: false },
};
