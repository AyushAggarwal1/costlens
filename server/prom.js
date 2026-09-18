// Optional Prometheus client for disk and node metrics OpenCost does not expose.
const BASE = (process.env.PROMETHEUS_URL || '').replace(/\/$/, '');

async function query(q) {
  if (!BASE) return null;
  const url = new URL(BASE + '/api/v1/query');
  url.searchParams.set('query', q);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.json();
    if (body.status !== 'success') return null;
    return body.data.result;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function queryRange(q, start, end, step) {
  if (!BASE) return null;
  const url = new URL(BASE + '/api/v1/query_range');
  url.searchParams.set('query', q);
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('step', step);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.json();
    if (body.status !== 'success') return null;
    return body.data.result;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const prom = {
  enabled: !!BASE,
  base: BASE,
  async healthy() {
    const r = await query('up');
    return Array.isArray(r);
  },
  // PVC usage keyed by namespace/claim
  async pvcUsage() {
    const [used, cap] = await Promise.all([
      query('max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_used_bytes)'),
      query('max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes)'),
    ]);
    if (!used) return null;
    const out = {};
    for (const s of used) {
      const k = `${s.metric.namespace}/${s.metric.persistentvolumeclaim}`;
      out[k] = { usedBytes: Number(s.value[1]) };
    }
    for (const s of cap || []) {
      const k = `${s.metric.namespace}/${s.metric.persistentvolumeclaim}`;
      out[k] = { ...(out[k] || {}), capacityBytes: Number(s.value[1]) };
    }
    return out;
  },
  // Node root filesystem
  async nodeFilesystems() {
    const [size, avail] = await Promise.all([
      query('max by (instance, nodename) (node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"} * on(instance) group_left(nodename) node_uname_info)'),
      query('max by (instance, nodename) (node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"} * on(instance) group_left(nodename) node_uname_info)'),
    ]);
    if (!size) return null;
    const out = {};
    for (const s of size) out[s.metric.nodename || s.metric.instance] = { sizeBytes: Number(s.value[1]) };
    for (const s of avail || []) {
      const k = s.metric.nodename || s.metric.instance;
      out[k] = { ...(out[k] || {}), availBytes: Number(s.value[1]) };
    }
    return out;
  },
  // PVC usage history for one claim
  async pvcUsageSeries(namespace, claim, hours = 24 * 7) {
    const end = Math.floor(Date.now() / 1000);
    const start = end - hours * 3600;
    const r = await queryRange(
      `max(kubelet_volume_stats_used_bytes{namespace="${namespace}",persistentvolumeclaim="${claim}"})`,
      start, end, Math.max(300, Math.floor((hours * 3600) / 200)),
    );
    if (!r || !r[0]) return null;
    return r[0].values.map(([t, v]) => ({ t: t * 1000, usedBytes: Number(v) }));
  },
};
