// A site config for the tests: the shape of js/config.js, with a source that the
// fake API answers for, and no links to other sites.
export default {
  source: 'test-source',
  siteName: 'Test',
  siteTagline: 'Fixture',
  siteDescription: 'Fixture site for the generator tests.',

  resolveFileUrl(filename) {
    return filename || '';
  },
  recordingPageUrl() {
    return null;
  },
  browseTaxonUrl() {
    return null;
  },
  githubRepo: null,

  excludeRecordingTypes: [],
  includeRecordingTypes: [],
  recordingTypeAllowed() {
    return true;
  },
  soundscapeTypes: [],

  mapTiles: { url: '', attribution: '' },
};
