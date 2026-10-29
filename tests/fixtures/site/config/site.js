// A site's config/ for the page builder's tests. It sets only what differs from the
// core's defaults, as a site may, with copy that needs escaping and a basemap on a
// host of its own.
export default {
  source: 'test-source',
  siteName: 'Test',
  siteTagline: 'Fixture',
  siteDescription: 'Fixture site for the page builder tests.',
  logo: ['Te', 'st'],
  hero: { lead: 'Listen to', emphasis: 'tests & fixtures', text: 'Sounds <and> silence.' },
  examples: { taxon: 'Acheta' },
  mapTiles: { url: 'https://tiles.example/{z}/{x}/{y}.png', attribution: 'Example tiles' },
};
