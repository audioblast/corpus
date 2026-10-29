// A fake audioBlast API for the browser checks. It answers the requests the app
// makes from a fixture collection (data/*.js), with the matching rules the live API
// has for the parameters the app sends (see js/audioblast.js), so that the app's
// filters, paging and empty states behave as they do against the live API.
//
// A request it has no answer for gets a 404, which the checks report with its URL.
// When the app starts using a new endpoint or parameter, add it here.

// How a module's parameters match, where they are not exact. Exact matches ignore
// case, as the API's database does.
const MATCH = {
  recordings: { id: 'list', name: 'fulltext', taxon: 'fulltext', author: 'fulltext', filename: 'contains' },
  annomate:   { annotator: 'contains', annotation_date: 'contains', taxon: 'contains', type: 'contains' },
  specimens:  { id: 'list', scientificName: 'contains', decimalLatitude: 'range', decimalLongitude: 'range' },
};

// Parameters that page or shape the answer rather than filter it. `source` is
// checked on its own: every request must carry the collection's.
const NOT_FILTERS = new Set(['source', 'page', 'page_size', 'output', 'format']);

const PAGE_SIZE = 250;

const lower = v => String(v ?? '').toLowerCase();

// MATCH(col) AGAINST ('<query>*' IN BOOLEAN MODE): any one of the query's words,
// the last as a prefix.
function fulltext(value, query) {
  const words = lower(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const terms = lower(query).split(/\s+/).filter(Boolean);
  return terms.some((term, i) => words.some(w => (i === terms.length - 1 ? w.startsWith(term) : w === term)));
}

function matches(kind, value, query) {
  switch (kind) {
    case 'list':     return query.split(',').some(q => lower(q) === lower(value));
    case 'contains': return lower(value).includes(lower(query));
    case 'fulltext': return fulltext(value, query);
    case 'range': {
      const [min, max] = query.split(':').map(Number);
      const v = parseFloat(value);
      return Number.isFinite(v) && v >= min && v <= max;
    }
    default:         return lower(value) === lower(query);
  }
}

// One page of rows, as the API pages them: last_page is 0 when there are none.
function paged(rows, params) {
  const size = Number(params.get('page_size')) || PAGE_SIZE;
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { data: rows.slice((page - 1) * size, page * size), last_page: Math.ceil(rows.length / size) };
}

/**
 * The fake API for one collection.
 * @param {object} data  a fixture collection: its source and its rows, as in data/collection.js
 * @returns {(url: URL) => {status: number, body: object, scoped: boolean}}
 *   scoped is false for a request that does not name the collection's source.
 */
export function fakeApi(data) {
  const taxonByName = new Map(data.taxa.map(t => [t.taxon, t]));
  const modules = {
    recordings: data.recordings,
    taxa:       data.taxa,
    traits:     data.traits,
    annomate:   data.annotations,
    specimens:  data.specimens,
    links:      data.links,
    // /data/traitstaxa/: each trait with its taxon's hierarchy, under the names
    // that module gives its fields
    traitstaxa: data.traits.map(t => {
      const { id, parent_id, source, taxon, ...hierarchy } = taxonByName.get(t.taxon) ?? {};
      return {
        ...hierarchy, source: t.source, traitID: t.id, taxonID: id ?? null, taxon: t.taxon,
        trait: t.trait, url: t.trait_ontology, value: t.value, callType: t.call_type,
        sex: t.sex, min: t.value_min, max: t.value_max,
      };
    }),
  };
  const counts = {
    recordings: data.recordings.length, taxa: data.taxa.length, traits: data.traits.length,
    annomate: data.annotations.length, specimens: data.specimens.length, links: data.links.length,
  };

  return function answer(url) {
    const params = url.searchParams;
    const scoped = params.get('source') === data.source;
    const ok = body => ({ status: 200, body, scoped });

    // /data/<module>/autocomplete/<field>/: the distinct values that contain ?c=
    const ac = /^\/data\/(\w+)\/autocomplete\/(\w+)\/$/.exec(url.pathname);
    if (ac && modules[ac[1]]) {
      const [, module, field] = ac;
      const values = [...new Set(modules[module].map(r => r[field]).filter(Boolean))]
        .filter(v => lower(v).includes(lower(params.get('c'))));
      return ok({ data: values.slice(0, 50).map(v => ({ [field]: v })), last_page: 1 });
    }

    if (url.pathname === '/standalone/data/fetch_data_counts/') {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return ok({ data: { counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, String(v)])), total } });
    }

    const module = /^\/data\/(\w+)\/$/.exec(url.pathname)?.[1];
    const rows = url.pathname === '/analysis/birdnet_selection/' ? (data.birdnet ?? []) : modules[module];
    if (!rows) return { status: 404, body: { error: `no fake for ${url.pathname}` }, scoped };

    const filters = [...params].filter(([name]) => !NOT_FILTERS.has(name));
    const kinds = MATCH[module] ?? {};
    return ok(paged(rows.filter(r => filters.every(([name, q]) => matches(kinds[name], r[name], q))), params));
  };
}
