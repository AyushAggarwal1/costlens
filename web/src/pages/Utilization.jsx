import React, { useMemo } from 'react';
import { money, pct, cores, bytes, displayName, isSystemRow } from '../api.js';
import { useApi, matchesFilters } from '../hooks.js';
import { Section, Tiles, Tile, DataTable, Loading, ErrorBox, Meter } from '../components/ui.jsx';
import { ChartCard, Lines } from '../components/charts.jsx';

export default function Utilization({ filters, alloc }) {
  const step = /^\d+h$/.test(filters.window) || filters.window === '3d' ? '1h' : '1d';
  const util = useApi('/api/utilization', { window: filters.window, step, namespace: filters.namespace });
  const series = util.data?.series || [];
  const cpuData = series.map((s) => ({ x: s.start, cpuCores: s.cpuCores, cpuCoreUsageAverage: s.cpuUse, cpuCoreRequestAverage: s.cpuReq }));
  const ramData = series.map((s) => ({ x: s.start, ramBytes: s.ramBytes / 2 ** 30, ramByteUsageAverage: s.ramUse / 2 ** 30, ramByteRequestAverage: s.ramReq / 2 ** 30 }));
  const avg = (k) => (series.length ? series.reduce((a, s) => a + s[k], 0) / series.length : 0);
  const workloads = useMemo(() => (alloc.data ? alloc.data.totals.filter((r) => !isSystemRow(r) && matchesFilters(r, filters)) : []), [alloc.data, filters]);
  const idleSeries = series.map((s) => ({ x: s.start, __idle__: s.idleCost, allocated: s.totalCost }));

  if (util.error && !util.data) return <ErrorBox error={util.error} />;
  if (!util.data) return <Loading />;
  const cpuS = [{ key: 'cpuCores', label: 'cpuCores (allocated)', color: 'var(--s1)' }, { key: 'cpuCoreRequestAverage', label: 'cpuCoreRequestAverage', color: 'var(--s2)' }, { key: 'cpuCoreUsageAverage', label: 'cpuCoreUsageAverage', color: 'var(--s3)' }];
  const ramS = [{ key: 'ramBytes', label: 'ramBytes (allocated)', color: 'var(--s1)' }, { key: 'ramByteRequestAverage', label: 'ramByteRequestAverage', color: 'var(--s2)' }, { key: 'ramByteUsageAverage', label: 'ramByteUsageAverage', color: 'var(--s3)' }];

  return (
    <div className={util.loading ? 'loading' : ''}>
      <div className="page-head">
        <div><h1>Utilization</h1><p>Allocated (<code>cpuCores</code>, <code>ramBytes</code>), requested and used averages from <code>/allocation</code> with <code>step={step}</code>, summed across the rows in the current filter. Allocated is OpenCost's max(request, usage); efficiency is usage ÷ request.</p></div>
      </div>
      <Tiles>
        <Tile label="cpuCores (allocated)" value={cores(avg('cpuCores'))} sub={`requested ${cores(avg('cpuReq'))} · used ${cores(avg('cpuUse'))} (${pct(avg('cpuUse') / (avg('cpuReq') || 1))} of request)`} />
        <Tile label="ramBytes (allocated)" value={bytes(avg('ramBytes'))} sub={`requested ${bytes(avg('ramReq'))} · used ${bytes(avg('ramUse'))} (${pct(avg('ramUse') / (avg('ramReq') || 1))} of request)`} />
        <Tile label="pvBytes" value={bytes(avg('pvBytes'))} sub="provisioned volume bytes mounted by these rows" />
        <Tile label="network bytes" value={bytes(series.reduce((a, s) => a + s.netBytes, 0))} sub="networkTransferBytes + networkReceiveBytes over the window" />
      </Tiles>
      <div className="grid-2 section">
        <ChartCard title="CPU cores" data={cpuData} series={cpuS} step={step} format={(v) => Number(v).toFixed(2)} height={240}><Lines data={cpuData} series={cpuS} step={step} format={(v) => `${Number(v).toFixed(v >= 10 ? 0 : 1)} cores`} /></ChartCard>
        <ChartCard title="Memory GiB" data={ramData} series={ramS} step={step} format={(v) => Number(v).toFixed(1)} height={240}><Lines data={ramData} series={ramS} step={step} format={(v) => `${Number(v).toFixed(0)} GiB`} /></ChartCard>
      </div>
      <Section title="Rows" sub="Per controller, window averages as OpenCost reports them">
        <DataTable rowKey={(r) => r.key} defaultSort="totalCost" pageSize={30}
          columns={[
            { key: 'controller', label: 'controller', render: (r) => <><span>{displayName(r.controller)}</span><span className="sub">{r.controllerKind} · {r.namespace}</span></> },
            { key: 'cpuReq', label: 'cpuCoreRequestAverage', align: 'r', render: (r) => cores(r.cpuReq) },
            { key: 'cpuUse', label: 'cpuCoreUsageAverage', align: 'r', render: (r) => cores(r.cpuUse) },
            { key: 'cpuCores', label: 'cpuCores (allocated)', align: 'r', render: (r) => <strong>{cores(r.cpuCores)}</strong> },
            { key: 'cpuEff', label: 'cpuEfficiency', sort: (r) => r.cpuReq ? r.cpuEff : -1, render: (r) => r.cpuReq ? <Meter value={Math.min(r.cpuEff, 1)} max={1} tone={r.cpuEff > 1 ? 'bad' : ''} /> : <span className="muted small">no request</span>, width: 150 },
            { key: 'ramReq', label: 'ramByteRequestAverage', align: 'r', render: (r) => bytes(r.ramReq) },
            { key: 'ramUse', label: 'ramByteUsageAverage', align: 'r', render: (r) => bytes(r.ramUse) },
            { key: 'ramBytes', label: 'ramBytes (allocated)', align: 'r', render: (r) => <strong>{bytes(r.ramBytes)}</strong> },
            { key: 'ramEff', label: 'ramEfficiency', sort: (r) => r.ramReq ? r.ramEff : -1, render: (r) => r.ramReq ? <Meter value={Math.min(r.ramEff, 1)} max={1} tone={r.ramEff > 1 ? 'bad' : ''} /> : <span className="muted small">no request</span>, width: 150 },
            { key: 'pvBytes', label: 'pvBytes', align: 'r', render: (r) => bytes(r.pvBytes) },
            { key: 'netBytes', label: 'network bytes', align: 'r', render: (r) => bytes(r.netBytes) },
            { key: 'totalCost', label: 'totalCost', align: 'r', render: (r) => money(r.totalCost) },
          ]}
          rows={workloads} />
      </Section>
    </div>
  );
}
