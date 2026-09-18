import React, { useMemo, useState } from 'react';
import { money, pct, RESOURCES, isSystemRow, displayName, cores, bytes, num } from '../api.js';
import { matchesFilters, useApi } from '../hooks.js';
import { Section, Seg, DataTable, Loading, ErrorBox, SERIES } from '../components/ui.jsx';
import { ChartCard, StackedBars } from '../components/charts.jsx';

const LEVELS = [{ value: 'cluster', label: 'cluster' }, { value: 'namespace', label: 'namespace' }, { value: 'workload', label: 'controller' }];
const keyOf = { cluster: (r) => r.cluster, namespace: (r) => `${r.cluster}|${r.namespace}`, workload: (r) => `${r.cluster}|${r.namespace}|${r.controllerKind}|${r.controller}` };

function aggregate(rows, level) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf[level](r);
    let a = m.get(k);
    if (!a) {
      a = { key: k, cluster: r.cluster, namespace: r.namespace, controllerKind: r.controllerKind, controller: r.controller, minutes: 0, count: 0, cpuReq: 0, cpuUse: 0, cpuCores: 0, cpuCoreHours: 0, ramReq: 0, ramUse: 0, ramBytes: 0, ramByteHours: 0, netBytes: 0, pvBytes: 0, totalCost: 0 };
      for (const x of RESOURCES) a[x.key] = 0;
      m.set(k, a);
    }
    for (const x of RESOURCES) a[x.key] += r[x.key];
    for (const f of ['totalCost', 'cpuReq', 'cpuUse', 'cpuCores', 'cpuCoreHours', 'ramReq', 'ramUse', 'ramBytes', 'ramByteHours', 'netBytes', 'pvBytes']) a[f] += r[f];
    a.minutes = Math.max(a.minutes, r.minutes);
    a.count++;
  }
  return [...m.values()].map((a) => ({ ...a, cpuEff: a.cpuReq ? a.cpuUse / a.cpuReq : null, ramEff: a.ramReq ? a.ramUse / a.ramReq : null }));
}

export default function Allocation({ filters, alloc, setFilters }) {
  const [level, setLevel] = useState(filters.namespace ? 'workload' : 'namespace');
  const [selected, setSelected] = useState(null);

  const model = useMemo(() => {
    if (!alloc.data) return null;
    const { sets, totals, step } = alloc.data;
    const rows = totals.filter((r) => !isSystemRow(r) && matchesFilters(r, filters));
    const agg = aggregate(rows, level).sort((a, b) => b.totalCost - a.totalCost);
    const total = agg.reduce((a, r) => a + r.totalCost, 0);
    const ranking = aggregate(totals.filter((r) => !isSystemRow(r)), level).sort((a, b) => b.totalCost - a.totalCost);
    const slot = new Map(ranking.slice(0, 7).map((r, i) => [r.key, i]));
    const top = agg.filter((r) => slot.has(r.key)).slice(0, 7);
    const hasOther = agg.length > top.length;
    const series = [...top.map((r) => ({ key: r.key, label: labelOf(r, level), color: SERIES[slot.get(r.key)] })), ...(hasOther ? [{ key: '__other__', label: 'Other', color: 'var(--idle)' }] : [])];
    const trend = sets.map((s) => {
      const o = { x: s.start };
      for (const k of series) o[k.key] = 0;
      for (const r of s.rows) {
        if (isSystemRow(r) || !matchesFilters(r, filters)) continue;
        const k = keyOf[level](r);
        if (top.some((t) => t.key === k)) o[k] += r.totalCost; else if (hasOther) o.__other__ += r.totalCost;
      }
      return o;
    });
    return { agg, total, series, trend, step };
  }, [alloc.data, filters, level]);

  if (alloc.error && !alloc.data) return <ErrorBox error={alloc.error} />;
  if (!model) return <Loading />;
  const { agg, total, series, trend, step } = model;

  const costCols = RESOURCES.filter((r) => agg.some((a) => a[r.key] > 0.0005)).map((r) => ({ key: r.key, label: r.field, align: 'r', render: (x) => money(x[r.key]) }));
  const nameCol = {
    cluster: { key: 'cluster', label: 'cluster', render: (r) => r.cluster },
    namespace: { key: 'namespace', label: 'namespace', render: (r) => <><span>{displayName(r.namespace)}</span><span className="sub">{r.count} controller{r.count === 1 ? '' : 's'}</span></> },
    workload: { key: 'controller', label: 'controller', render: (r) => <><span>{displayName(r.controller)}</span><span className="sub">{displayName(r.controllerKind)} · {displayName(r.namespace)}</span></> },
  }[level];
  const columns = [
    nameCol,
    { key: 'minutes', label: 'minutes', align: 'r', render: (r) => num(r.minutes) },
    { key: 'cpuReq', label: 'cpuCoreRequestAverage', align: 'r', render: (r) => r.cpuReq ? cores(r.cpuReq) : <span className="muted">0</span> },
    { key: 'cpuUse', label: 'cpuCoreUsageAverage', align: 'r', render: (r) => cores(r.cpuUse) },
    { key: 'cpuCores', label: 'cpuCores (allocated)', align: 'r', render: (r) => <strong>{cores(r.cpuCores)}</strong> },
    { key: 'cpuEff', label: 'cpuEfficiency', align: 'r', render: (r) => r.cpuEff == null ? <span className="muted">–</span> : pct(r.cpuEff) },
    { key: 'ramReq', label: 'ramByteRequestAverage', align: 'r', render: (r) => r.ramReq ? bytes(r.ramReq) : <span className="muted">0</span> },
    { key: 'ramUse', label: 'ramByteUsageAverage', align: 'r', render: (r) => bytes(r.ramUse) },
    { key: 'ramBytes', label: 'ramBytes (allocated)', align: 'r', render: (r) => <strong>{bytes(r.ramBytes)}</strong> },
    { key: 'ramEff', label: 'ramEfficiency', align: 'r', render: (r) => r.ramEff == null ? <span className="muted">–</span> : pct(r.ramEff) },
    { key: 'pvBytes', label: 'pvBytes', align: 'r', render: (r) => r.pvBytes ? bytes(r.pvBytes) : <span className="muted">0</span> },
    { key: 'netBytes', label: 'network bytes', align: 'r', render: (r) => bytes(r.netBytes) },
    ...costCols,
    { key: 'totalCost', label: 'totalCost', align: 'r', render: (r) => <strong>{money(r.totalCost)}</strong> },
    { key: 'share', label: 'share', align: 'r', sort: (r) => r.totalCost, render: (r) => pct(r.totalCost / (total || 1)) },
  ];
  const footer = { [nameCol.key]: `${agg.length} rows`, totalCost: money(total), share: '100%', cpuReq: cores(agg.reduce((a, r) => a + r.cpuReq, 0)), cpuUse: cores(agg.reduce((a, r) => a + r.cpuUse, 0)), cpuCores: cores(agg.reduce((a, r) => a + r.cpuCores, 0)), ramBytes: bytes(agg.reduce((a, r) => a + r.ramBytes, 0)), ramReq: bytes(agg.reduce((a, r) => a + r.ramReq, 0)), ramUse: bytes(agg.reduce((a, r) => a + r.ramUse, 0)), pvBytes: bytes(agg.reduce((a, r) => a + r.pvBytes, 0)), netBytes: bytes(agg.reduce((a, r) => a + r.netBytes, 0)) };
  for (const c of costCols) footer[c.key] = money(agg.reduce((a, r) => a + r[c.key], 0));

  const drill = (r) => {
    if (level === 'cluster') { setFilters((f) => ({ ...f, cluster: r.cluster })); setLevel('namespace'); }
    else if (level === 'namespace') { setFilters((f) => ({ ...f, namespace: r.namespace })); setLevel('workload'); }
    else setSelected(selected === r.key ? null : r.key);
  };

  return (
    <div className={alloc.loading ? 'loading' : ''}>
      <div className="page-head">
        <div><h1>Allocation</h1><p>Rows from <code>/allocation?aggregate=cluster,namespace,controllerKind,controller&includeIdle=true</code>, summed per {level === 'workload' ? 'controller' : level}. Column names are the OpenCost field names. Allocated CPU and memory are <code>cpuCores</code> and <code>ramBytes</code>: OpenCost's max(request, usage) average, which is what it bills. Averages are summed across rows, not re-averaged.</p></div>
        <Seg options={LEVELS} value={level} onChange={setLevel} />
      </div>
      <ChartCard title={`totalCost per ${step === '1h' ? 'hour' : 'day'} by ${level === 'workload' ? 'controller' : level}`} sub={series.length > 7 ? 'Top seven, remainder folded into Other' : undefined} data={trend} series={series} step={step} height={260}>
        <StackedBars data={trend} series={series} step={step} />
      </ChartCard>
      <Section title={`By ${level === 'workload' ? 'controller' : level}`} sub={level === 'workload' ? 'Click a row to see the full OpenCost record' : 'Click a row to drill down'}>
        <DataTable columns={columns} rows={agg} defaultSort="totalCost" rowKey={(r) => r.key} onRowClick={drill} selectedKey={selected} footer={footer} pageSize={level === 'workload' ? 30 : 60} />
      </Section>
      {selected && level === 'workload' && <RawRecord row={agg.find((r) => r.key === selected)} window={filters.window} />}
    </div>
  );
}

function labelOf(r, level) {
  return { cluster: r.cluster, namespace: displayName(r.namespace), workload: `${displayName(r.controller)} (${displayName(r.namespace)})` }[level];
}

/** Fetches the untouched OpenCost record for one controller and prints it. */
function RawRecord({ row, window }) {
  const filter = `cluster:"${row.cluster}"+namespace:"${row.namespace}"+controllerKind:"${row.controllerKind}"+controllerName:"${row.controller}"`;
  const raw = useApi('/api/raw/allocation', { window, aggregate: 'cluster,namespace,controllerKind,controller', accumulate: 'true', includeIdle: 'false', filter });
  const data = raw.data?.response?.data;
  const set = Array.isArray(data) ? data[0] : data;
  const rec = set ? Object.values(set)[0] : null;
  return (
    <Section title={`${displayName(row.controller)} in ${displayName(row.namespace)}`} sub={raw.data ? `GET ${raw.data.url}` : 'Fetching the accumulated record from OpenCost'}>
      {raw.error && <ErrorBox error={raw.error} />}
      {rec ? (
        <div className="grid-2">
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Field</th><th className="r">Value</th></tr></thead><tbody>
            {Object.entries(rec).filter(([k, v]) => typeof v !== 'object' || v === null).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td className="r">{formatValue(k, v)}</td></tr>)}
          </tbody></table></div>
          <div>
            <pre style={{ maxHeight: 520, overflow: 'auto' }}>{JSON.stringify({ properties: rec.properties, window: rec.window, pvs: rec.pvs, rawAllocationOnly: rec.rawAllocationOnly, gpuAllocation: rec.gpuAllocation, lbAllocations: rec.lbAllocations, sharedCostBreakdown: rec.sharedCostBreakdown, proportionalAssetResourceCosts: rec.proportionalAssetResourceCosts }, null, 2)}</pre>
          </div>
        </div>
      ) : (!raw.error && <Loading />)}
    </Section>
  );
}

function formatValue(k, v) {
  if (v === null || v === undefined) return <span className="muted">null</span>;
  if (typeof v !== 'number') return String(v);
  if (/Cost/.test(k)) return `${money(v, 5)}`;
  if (/Byte|Bytes/.test(k) && !/Hours/.test(k)) return `${num(v)} (${bytes(v)})`;
  if (/Efficiency/.test(k)) return pct(v, 1);
  return num(v, 5);
}
