// -----------------------------------------------------------------------------
// The HTTP client on a real local server: what leaves (User-Agent, no cookie,
// the date), what is refused (redirect, size, content type), the 429 parse.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { STATUS_URL, USER_AGENT } from '../src/constants.js';
import { SourceError, getStatus, retryAfterMs } from '../src/http.js';

async function server(t, handler) {
  const requests = [];
  const srv = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    handler(req, res);
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    srv.closeAllConnections();
    await new Promise((resolve) => srv.close(resolve));
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const fetchImpl = (url, init) => fetch(String(url).replace(STATUS_URL, `${base}/status`), init);
  return { requests, fetchImpl };
}

test('the request: the module User-Agent, JSON, the date, no cookie kept', async (t) => {
  const { requests, fetchImpl } = await server(t, (req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': 'AWSALB=abc; Path=/',
    });
    res.end('{"couleurJourJ":"RAS","couleurJourJ1":"NON_DETERMINE"}');
  });
  assert.deepEqual(await getStatus('2026-11-11', { fetchImpl }), {
    couleurJourJ: 'RAS',
    couleurJourJ1: 'NON_DETERMINE',
  });
  await getStatus('2026-11-11', { fetchImpl });
  assert.equal(requests[0].url, '/status?dateRelevant=2026-11-11');
  assert.equal(requests[0].headers['user-agent'], USER_AGENT);
  assert.equal(requests[0].headers.accept, 'application/json');
  assert.equal(requests[1].headers.cookie, undefined, 'the cookie set is never sent back');
  assert.equal(requests[0].headers.authorization, undefined);
});

test('a redirect is never followed', async (t) => {
  const { requests, fetchImpl } = await server(t, (req, res) => {
    res.writeHead(302, { location: '/elsewhere' });
    res.end();
  });
  await assert.rejects(getStatus('2026-11-11', { fetchImpl }), (err) => err.code === 'network');
  assert.equal(requests.length, 1);
});

test('a body larger than 4 KB is cut, declared or not', async (t) => {
  let sent = 0;
  const { fetchImpl } = await server(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const chunk = Buffer.alloc(1024, 0x20);
    const push = () => {
      while (sent < 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) return res.once('drain', push);
      }
      return res.end();
    };
    push();
  });
  await assert.rejects(getStatus('2026-11-11', { fetchImpl }), (err) => err.code === 'too_large');
  const declared = await server(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '999999' });
    res.end();
  });
  await assert.rejects(
    getStatus('2026-11-11', { fetchImpl: declared.fetchImpl }),
    (err) => err.code === 'too_large',
  );
});

test('the status codes', async (t) => {
  const cases = [
    [503, 'text/html', 'server'],
    [500, 'text/html', 'server'],
    [403, 'text/html', 'blocked'],
    [404, 'text/html', 'http'],
    [200, 'text/html', 'invalid'],
    [429, 'text/html', 'rate_limited'],
  ];
  for (const [status, type, code] of cases) {
    const { fetchImpl } = await server(t, (req, res) => {
      res.writeHead(status, { 'content-type': type, 'retry-after': '120' });
      res.end('<html>x</html>');
    });
    await assert.rejects(getStatus('2026-11-11', { fetchImpl }), (err) => {
      assert.ok(err instanceof SourceError);
      assert.equal(err.code, code, `${status}`);
      if (code === 'rate_limited') assert.equal(err.retryAfter, 120_000);
      return true;
    });
  }
});

test('a server that never answers: given up at the timeout', async (t) => {
  const { fetchImpl } = await server(t, () => {});
  const started = performance.now();
  await assert.rejects(
    getStatus('2026-11-11', { fetchImpl, timeout: 200 }),
    (err) => err.code === 'timeout',
  );
  assert.ok(performance.now() - started < 5000);
});

test('Retry-After: seconds, an HTTP date, garbage', () => {
  const now = Date.parse('2026-11-11T10:00:00Z');
  assert.equal(retryAfterMs('60', now), 60_000);
  assert.equal(retryAfterMs('Wed, 11 Nov 2026 10:05:00 GMT', now), 300_000);
  assert.equal(retryAfterMs('Wed, 11 Nov 2026 09:05:00 GMT', now), 0);
  assert.equal(retryAfterMs('-5', now), undefined);
  assert.equal(retryAfterMs('soon', now), undefined);
  assert.equal(retryAfterMs(undefined, now), undefined);
  assert.equal(retryAfterMs('9'.repeat(100), now), undefined);
});
