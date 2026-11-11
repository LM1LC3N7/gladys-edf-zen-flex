// -----------------------------------------------------------------------------
// The only place that talks to the network: one GET of the EDF endpoint with
// the module's User-Agent (never a browser's nor the app's), no cookie, no
// login, a timeout, no redirect followed (3xx: an error) and a body read up to a bound, never
// whole. Taken from gladys-netzentgelte-14a (approved).
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, USER_AGENT, statusUrl } from './constants.js';

export class SourceError extends Error {
  /**
   * `code`: 'rate_limited' (429), 'blocked' (403), 'server' (5xx), 'redirect' (3xx), 'http',
   * 'network', 'timeout', 'too_large', 'invalid' (not the expected JSON).
   */
  constructor(code, message, { status, retryAfter } = {}) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now) {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  // An HTTP date names its day and month: a bare number or sign is not one.
  if (!/^[A-Za-z]{3}, /.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** The body as text, refused past `limit` bytes (read in chunks, never whole). */
export async function readBounded(response, limit) {
  const tooLarge = () => new SourceError('too_large', `The answer is larger than ${limit} bytes`);
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel?.().catch(() => {});
    throw tooLarge();
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw tooLarge();
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function networkError(err) {
  const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return timedOut
    ? new SourceError('timeout', 'The EDF website did not answer in time')
    : new SourceError('network', 'The EDF website is unreachable (network error)');
}

/**
 * GET the day status of `date` (the current Paris date). Resolves the parsed
 * JSON (not checked: src/edf.js does it), throws a SourceError otherwise.
 */
export async function getStatus(
  date,
  { fetchImpl = globalThis.fetch, now = Date.now, timeout = HTTP_TIMEOUT } = {},
) {
  let response;
  try {
    response = await fetchImpl(statusUrl(date), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.max(1, timeout)),
      redirect: 'manual',
      credentials: 'omit',
    });
  } catch (err) {
    throw networkError(err);
  }
  const { status } = response;
  if (status === 200) {
    let body;
    try {
      body = await readBounded(response, MAX_BODY_BYTES);
    } catch (err) {
      throw err instanceof SourceError ? err : networkError(err);
    }
    const type = response.headers?.get?.('content-type') ?? '';
    if (!/^application\/json\b/i.test(type)) {
      throw new SourceError('invalid', 'The EDF website answered something else than JSON');
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new SourceError('invalid', 'The EDF website answered an unreadable JSON');
    }
  }
  await response.body?.cancel?.().catch(() => {});
  if (status === 429) {
    // An HTTP date is compared to the server's own clock (its Date header) when it gives one.
    const served = Date.parse(response.headers?.get?.('date') ?? '');
    throw new SourceError('rate_limited', 'The EDF website asked to slow down (429)', {
      status,
      retryAfter: retryAfterMs(
        response.headers?.get?.('retry-after'),
        Number.isFinite(served) ? served : now(),
      ),
    });
  }
  if (status >= 300 && status < 400) {
    throw new SourceError('redirect', `The EDF website answered a redirection (${status})`, {
      status,
    });
  }
  if (status === 403) {
    throw new SourceError('blocked', 'The EDF website refused the request (403)', { status });
  }
  if (status >= 500) {
    throw new SourceError('server', `The EDF website answered ${status}`, { status });
  }
  throw new SourceError('http', `The EDF website answered ${status}`, { status });
}
