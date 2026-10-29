// The collection the "collection" check site shows, as the fake API serves it
// (fake-api.js): a small collection shaped like bio's, with the API's field names
// and its habit of giving numbers as strings.
//
// What it is made to cover:
//   - two families of Orthoptera, and a name with a subgenus ("Gryllus Gryllus
//     campestris", shown as "Gryllus (Gryllus) campestris");
//   - recordings identified to species and to genus;
//   - a Soundscape recording, which the site's config excludes, so it must not
//     show anywhere, the map included;
//   - traits with ontology links and ranges, and annotations with and without
//     frequency bounds;
//   - specimens at three places, and one without coordinates, so that one
//     recording is not on the map.

const SOURCE = 'test-collection';

const taxon = (id, parent_id, name, rank, hierarchy) => ({
  source: SOURCE, id, parent_id, taxon: name, rank,
  species: null, genus: null, family: null, order: null, class: null, kingdom: 'Animalia',
  ...hierarchy,
});
const orthoptera = { class: 'Insecta', order: 'Orthoptera' };

const taxa = [
  taxon('1', null, 'Animalia', 'Kingdom', {}),
  taxon('2', '1', 'Insecta', 'Class', { class: 'Insecta' }),
  taxon('3', '2', 'Orthoptera', 'Order', orthoptera),
  taxon('4', '3', 'Gryllidae', 'Family', { ...orthoptera, family: 'Gryllidae' }),
  taxon('5', '4', 'Gryllus', 'Genus', { ...orthoptera, family: 'Gryllidae', genus: 'Gryllus' }),
  taxon('6', '5', 'Gryllus Gryllus campestris', 'Species',
    { ...orthoptera, family: 'Gryllidae', genus: 'Gryllus', species: 'Gryllus Gryllus campestris' }),
  taxon('7', '3', 'Tettigoniidae', 'Family', { ...orthoptera, family: 'Tettigoniidae' }),
  taxon('8', '7', 'Tettigonia', 'Genus', { ...orthoptera, family: 'Tettigoniidae', genus: 'Tettigonia' }),
  taxon('9', '8', 'Tettigonia viridissima', 'Species',
    { ...orthoptera, family: 'Tettigoniidae', genus: 'Tettigonia', species: 'Tettigonia viridissima' }),
];

// Every recording plays the same generated file (media.js), under its own address.
const recording = (id, name, taxonName, type, extra = {}) => ({
  source: SOURCE, id, name, taxon: taxonName,
  filename: `https://files.example/recordings/${id}.wav`,
  author: 'A. Recordist', post_date: '2024-06-02', human_size: '86.2 KB', bytes: '88244',
  mime: 'audio/x-wav', recording_type: type, date: '2024-06-01', time: null, duration: '2',
  license: 'https://creativecommons.org/licenses/by/4.0/', info_url: null, rights_holder: null,
  country: null, locality: null, sample_rate: '22050', channels: '1',
  peaks_url: null, spectrogram_url: null,
  ...extra,
});

// In the order the API lists them. The first three are the home page's recent
// additions, so the excluded Soundscape comes last.
const recordings = [
  recording('7', 'Field cricket calling song', 'Gryllus Gryllus campestris', 'Call'),
  recording('8', 'Great green bush-cricket song', 'Tettigonia viridissima', 'Call'),
  recording('10', 'Cricket in a garden', 'Gryllus', 'Call', { author: 'B. Recordist' }),
  recording('11', 'Field cricket, second male', 'Gryllus Gryllus campestris', 'Call'),
  recording('9', 'Dawn chorus', 'Unknown species', 'Soundscape'),
];

const trait = (id, name, traitName, value, extra = {}) => ({
  source: SOURCE, id, taxon: name, trait: traitName,
  trait_ontology: `https://vocab.audioblast.org/${traitName.replace(/ /g, '')}`, value,
  call_type: '', call_type_ontology: null, call_part: null, call_qualifier: null,
  sex: '', temperature: '', value_min: null, value_max: null,
  ...extra,
});

const traits = [
  trait('1', 'Gryllus Gryllus campestris', 'Dominant Frequency', '4.5',
    { call_type: 'Calling song', sex: 'Male', temperature: '22', value_min: '4.2', value_max: '4.8' }),
  trait('2', 'Gryllus Gryllus campestris', 'Sound Production Method', 'Stridulation'),
  trait('3', 'Tettigonia viridissima', 'Sound Production Method', 'Stridulation'),
];

const annotation = (id, recordingId, name, type, start, end, extra = {}) => ({
  source: SOURCE, source_id: recordingId, recording_source: SOURCE,
  annotator: 'C. Annotator', annotation_id: id, annotation_date: '2024-07-01 10:00',
  annotation_info_url: 'view', recording_url: `https://files.example/recordings/${recordingId}.wav`,
  time_start: start, time_end: end, freq_low: null, freq_high: null,
  taxon: name, type, lat: '', lon: '', contact: id,
  ...extra,
});

// The chirps of recording 7 are at 0.25–0.75 s and 1.25–1.75 s (media.js).
const annotations = [
  annotation('1', '7', 'Gryllus Gryllus campestris', 'Chirp', '0.25', '0.75', { freq_low: '3000', freq_high: '6000' }),
  annotation('2', '7', 'Gryllus Gryllus campestris', 'Chirp', '1.25', '1.75'),
  annotation('3', '8', 'Tettigonia viridissima', 'Song', '0.5', '1.5'),
];

const specimen = (id, name, lat, lon, countryCode) => ({
  source: SOURCE, id, scientificName: name, basisOfRecord: 'PreservedSpecimen',
  eventDate: '2024-05-30', countryCode, decimalLatitude: lat, decimalLongitude: lon,
});

const specimens = [
  specimen('S1', 'Gryllus campestris', '51.4967', '-0.1764', 'GB'),
  specimen('S2', 'Gryllus campestris', '51.7520', '-1.2577', 'GB'),
  specimen('S3', 'Tettigonia viridissima', '48.8566', '2.3522', 'FR'),
  specimen('S4', 'Gryllus', null, null, 'GB'),
  specimen('S5', 'Unknown', '-1.2921', '36.8219', 'KE'),
];

// Which specimen each recording is of
const links = [['7', 'S1'], ['11', 'S2'], ['8', 'S3'], ['10', 'S4'], ['9', 'S5']].map(([recordingId, specimenId]) => ({
  source: SOURCE, id: `link-${recordingId}`,
  subject_type: 'recordings', subject_source: SOURCE, subject_id: recordingId,
  predicate: 'http://rs.tdwg.org/ac/terms/associatedSpecimenReference',
  object_type: 'specimens', object_source: SOURCE, object_id: specimenId,
  qualifier: null, remarks: null,
}));

export default { source: SOURCE, taxa, recordings, traits, annotations, specimens, links };
