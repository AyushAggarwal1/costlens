const cache = new Map();

export async function api(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const key = url.toString();
  if (cache.has(key)) return cache.get(key);
  const p = fetch(url).then(async (r) => {
    const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  setTimeout(() => cache.delete(key), 60_000);
  return p;
}

export const money = (v, digits) => {
  if (v == null || Number.isNaN(v)) return '–';
  const abs = Math.abs(v);
  const d = digits ?? (abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4);
  return (v < 0 ? '-' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
export const pct = (v, d = 0) => (v == null || Number.isNaN(v) ? '–' : `${(v * 100).toFixed(d)}%`);
export const cores = (v) => (v == null ? '–' : v >= 1 ? `${v.toFixed(2)} cores` : `${Math.round(v * 1000)}m`);
export const bytes = (v) => {
  if (v == null || Number.isNaN(v)) return '–';
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0; let n = v;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};
export const num = (v, d = 0) => (v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: d }));
export const shortDate = (iso, step) => {
  const d = new Date(iso);
  if (step === '1h') return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
export const monthly = (cost, minutes) => (minutes ? (cost / (minutes / 60)) * 730 : 0);

export const RESOURCES = [
  { key: 'cpuCost', label: 'CPU', field: 'cpuCost' },
  { key: 'ramCost', label: 'Memory', field: 'ramCost' },
  { key: 'pvCost', label: 'Storage', field: 'pvCost' },
  { key: 'networkCost', label: 'Network', field: 'networkCost' },
  { key: 'loadBalancerCost', label: 'Load balancer', field: 'loadBalancerCost' },
  { key: 'gpuCost', label: 'GPU', field: 'gpuCost' },
  { key: 'sharedCost', label: 'Shared', field: 'sharedCost' },
  { key: 'externalCost', label: 'External', field: 'externalCost' },
];

export const isSystemRow = (r) => r.namespace === '__idle__' || r.controllerKind === '__idle__';
export const displayName = (s) => s;
