// Thin client for the OpenCost API. All numbers come back as-is; enrichment happens elsewhere.
const BASE = (process.env.OPENCOST_URL || 'http://localhost:9003').replace(/\/$/, '');

export class OpenCostError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Number(process.env.OPENCOST_TIMEOUT_MS || 90000));
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    throw new OpenCostError(`OpenCost unreachable at ${BASE}: ${e.message}`, 0);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new OpenCostError(`OpenCost ${path} returned ${res.status}`, res.status, body);
  if (body && typeof body === 'object' && body.code && body.code >= 400) {
    throw new OpenCostError(body.message || `OpenCost ${path} error`, body.code, body);
  }
  return body;
}

export const opencost = {
  base: BASE,
  allocation: (params) => get('/allocation', params),
  assets: (params) => get('/assets', params),
  cloudCost: (params) => get('/cloudCost', params),
  async healthy() {
    try {
      await get('/allocation', { window: '10m', aggregate: 'cluster' });
      return true;
    } catch { return false; }
  },
};
