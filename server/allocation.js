// Normalises OpenCost allocation rows and adds ownership.
import { resolveOwner } from './enrich/ownership.js';

export const ALLOC_AGGREGATE = 'cluster,namespace,controllerKind,controller';

export function normalizeRow(key, a, kubeNamespaces) {
  const p = a.properties || {};
  const namespace = p.namespace || (key === '__idle__' ? '__idle__' : 'unknown');
  const controllerKind = p.controllerKind || (key === '__idle__' ? '__idle__' : (p.container === '__unmounted__' ? '__unmounted__' : '__unallocated__'));
  const controller = p.controller || (key === '__idle__' ? '__idle__' : (p.container === '__unmounted__' ? '__unmounted__' : (p.pod || '__unallocated__')));
  const row = {
    key,
    cluster: p.cluster || 'unknown',
    namespace,
    controllerKind,
    controller,
    pod: p.pod || null,
    node: p.node || null,
    labels: p.labels || {},
    namespaceLabels: p.namespaceLabels || {},
    start: a.start,
    end: a.end,
    minutes: a.minutes || 0,
    cpuCost: (a.cpuCost || 0) + (a.cpuCostAdjustment || 0),
    ramCost: (a.ramCost || 0) + (a.ramCostAdjustment || 0),
    gpuCost: (a.gpuCost || 0) + (a.gpuCostAdjustment || 0),
    pvCost: (a.pvCost || 0) + (a.pvCostAdjustment || 0),
    networkCost: (a.networkCost || 0) + (a.networkCostAdjustment || 0),
    loadBalancerCost: (a.loadBalancerCost || 0) + (a.loadBalancerCostAdjustment || 0),
    sharedCost: a.sharedCost || 0,
    externalCost: a.externalCost || 0,
    totalCost: a.totalCost || 0,
    cpuReq: a.cpuCoreRequestAverage || 0,
    cpuUse: a.cpuCoreUsageAverage || 0,
    cpuCores: a.cpuCores || 0,
    cpuCoreHours: a.cpuCoreHours || 0,
    ramReq: a.ramByteRequestAverage || 0,
    ramUse: a.ramByteUsageAverage || 0,
    ramBytes: a.ramBytes || 0,
    ramByteHours: a.ramByteHours || 0,
    cpuEff: a.cpuEfficiency || 0,
    ramEff: a.ramEfficiency || 0,
    totalEff: a.totalEfficiency || 0,
    netBytes: (a.networkTransferBytes || 0) + (a.networkReceiveBytes || 0),
    pvBytes: a.pvBytes || 0,
    pvs: a.pvs ? Object.fromEntries(Object.entries(a.pvs).map(([k, v]) => [k.replace(/^cluster=[^:]+:name=/, ''), { cost: v.cost, byteHours: v.byteHours }])) : null,
  };
  row.owner = resolveOwner(row, kubeNamespaces);
  // Keep payloads small: labels are only needed for ownership resolution
  delete row.labels;
  delete row.namespaceLabels;
  return row;
}

export function normalizeSets(data, kubeNamespaces) {
  return (data || []).map((set) => {
    const rows = Object.entries(set || {}).map(([k, a]) => normalizeRow(k, a, kubeNamespaces));
    const any = rows[0];
    return {
      start: any?.start || null,
      end: any?.end || null,
      rows,
    };
  }).filter((s) => s.rows.length);
}

// Sum step sets into one accumulated row per key (minute-weighted averages).
export function accumulate(sets) {
  const acc = new Map();
  for (const set of sets) {
    for (const r of set.rows) {
      const id = `${r.cluster}/${r.namespace}/${r.controllerKind}/${r.controller}`;
      let a = acc.get(id);
      if (!a) {
        a = { ...r, minutes: 0, history: [], _w: { cpuReq: 0, cpuUse: 0, ramReq: 0, ramUse: 0 } };
        for (const f of ['cpuCost', 'ramCost', 'gpuCost', 'pvCost', 'networkCost', 'loadBalancerCost', 'sharedCost', 'externalCost', 'totalCost', 'cpuCoreHours', 'ramByteHours', 'netBytes']) a[f] = 0;
        acc.set(id, a);
      }
      for (const f of ['cpuCost', 'ramCost', 'gpuCost', 'pvCost', 'networkCost', 'loadBalancerCost', 'sharedCost', 'externalCost', 'totalCost', 'cpuCoreHours', 'ramByteHours', 'netBytes']) a[f] += r[f];
      a.minutes += r.minutes;
      for (const f of ['cpuReq', 'cpuUse', 'ramReq', 'ramUse']) a._w[f] += r[f] * r.minutes;
      a.pvBytes = Math.max(a.pvBytes, r.pvBytes);
      if (r.pvs) a.pvs = { ...(a.pvs || {}), ...r.pvs };
      a.history.push({ start: set.start, end: set.end, minutes: r.minutes, cpuUse: r.cpuUse, cpuReq: r.cpuReq, ramUse: r.ramUse, ramReq: r.ramReq, totalCost: r.totalCost, netBytes: r.netBytes });
      a.start = a.start < r.start ? a.start : r.start;
      a.end = a.end > r.end ? a.end : r.end;
    }
  }
  const out = [];
  for (const a of acc.values()) {
    const m = a.minutes || 1;
    for (const f of ['cpuReq', 'cpuUse', 'ramReq', 'ramUse']) a[f] = a._w[f] / m;
    delete a._w;
    a.cpuEff = a.cpuReq > 0 ? a.cpuUse / a.cpuReq : (a.cpuUse > 0 ? 1 : 0);
    a.ramEff = a.ramReq > 0 ? a.ramUse / a.ramReq : (a.ramUse > 0 ? 1 : 0);
    const denom = a.cpuCost + a.ramCost;
    a.totalEff = denom > 0 ? (a.cpuEff * a.cpuCost + a.ramEff * a.ramCost) / denom : 0;
    out.push(a);
  }
  return out;
}
