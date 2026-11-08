// A fake audioBlast API for the tests, with the collection endpoints the static-page
// generator reads. It answers with the given rows, filtered by each parameter the
// request gives (exactly, as the API matches these fields), and records each source it
// is asked for, so a test can check the requests are scoped.
import { once } from 'node:events';
import http from 'node:http';

const NOT_FILTERS = new Set(['source', 'page', 'page_size', 'output']);

export async function fakeApi({ taxa = [], recordings = [], specimens = [], links = [] }) {
  const sources = new Set();
  const modules = {
    '/data/taxa/': taxa, '/data/recordings/': recordings, '/data/specimens/': specimens, '/data/links/': links,
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    sources.add(url.searchParams.get('source'));
    const all = modules[url.pathname];
    if (!all) return res.writeHead(404).end();
    const filters = [...url.searchParams].filter(([name]) => !NOT_FILTERS.has(name));
    const rows = all.filter(r => filters.every(([name, q]) => String(r[name] ?? '') === q));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: rows, last_page: rows.length ? 1 : 0 }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    sources,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
