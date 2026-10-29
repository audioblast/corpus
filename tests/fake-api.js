// A fake audioBlast API for the tests, with the two collection endpoints the
// static-page generator reads. It answers with the given rows, and records each
// source it is asked for, so a test can check the requests are scoped.
import { once } from 'node:events';
import http from 'node:http';

export async function fakeApi({ taxa = [], recordings = [] }) {
  const sources = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    sources.add(url.searchParams.get('source'));
    const rows = { '/data/taxa/': taxa, '/data/recordings/': recordings }[url.pathname];
    if (!rows) return res.writeHead(404).end();
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
