import React, { useMemo } from 'react';
import { money, pct, RESOURCES, isSystemRow, displayName } from '../api.js';
import { matchesFilters } from '../hooks.js';
import { Tiles, Tile, Section, HBars, Loading, ErrorBox, RESOURCE_COLORS } from '../components/ui.jsx';
import { ChartCard, StackedBars } from '../components/charts.jsx';

export default function Overview({ filters, alloc, go }) {
  const model = useMemo(() => {
    if (!alloc.data) return null;
    const { sets, totals, step } = alloc.data;
    const rows = totals.filter((r) => !isSystemRow(r) && matchesFilters(r, filters));
    const unfiltered = Object.entries(filters).every(([k, v]) => k === 'window' || !v);
    const idleRow = totals.find((r) => isSystemRow(r));
    const idle = unfiltered && idleRow ? idleRow.totalCost : 0;
    const byRes = RESOURCES.map((r) => ({ ...r, value: rows.reduce((a, x) => a + x[r.key], 0) })).filter((r) => r.value > 0.0005);
    const total = rows.reduce((a, r) => a + r.totalCost, 0);
    const trend = sets.map((s) => {
      const rs = s.rows.filter((r) => !isSystemRow(r) && matchesFilters(r, filters));
      const o = { x: s.start };
      for (const r of RESOURCES) o[r.key] = rs.reduce((a, x) => a + x[r.key], 0);
      const id = s.rows.find((r) => isSystemRow(r));
      o.idle = unfiltered && id ? id.totalCost : 0;
      return o;
    });
    const group = (f) => {
      const m = new Map();
      for (const r of rows) m.set(f(r), (m.get(f(r)) || 0) + r.totalCost);
      return [...m.entries()].map(([label, value]) => ({ label: displayName(label), key: label, value })).sort((a, b) => b.value - a.value);
    };
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    return { rows, byRes, total, idle, trend, step, byNs: group((r) => r.namespace), byCluster: group((r) => r.cluster), byKind: group((r) => r.controllerKind),
      cpuReq: sum('cpuReq'), cpuUse: sum('cpuUse'), cpuCores: sum('cpuCores'), ramReq: sum('ramReq'), ramUse: sum('ramUse'), ramBytes: sum('ramBytes'), pvBytes: sum('pvBytes') };
  }, [alloc.data, filters]);

  if (alloc.error && !alloc.data) return <ErrorBox error={alloc.error} />;
  if (!model) return <Loading />;
  const { byRes, total, idle, trend, step, byNs, byCluster, byKind } = model;
  const series = byRes.map((r) => ({ key: r.key, label: r.field, color: RESOURCE_COLORS[r.key] }));
  const trendSeries = idle > 0 ? [...series, { key: 'idle', label: '__idle__', color: 'var(--idle)' }] : series;

  return (
    <div className={alloc.loading ? 'loading' : ''}>
      <div className="page-head">
        <div><h1>OpenCost allocation, summed</h1><p>Sums of the <code>/allocation</code> response for the last {filters.window}, aggregated by cluster, namespace, controllerKind and controller. Nothing is added or mapped.</p></div>
      </div>
      <Tiles>
        <Tile label="totalCost in window" value={money(total)} hero sub={`${model.rows.length} allocation rows, ${byNs.length} namespaces`} />
        <Tile label="__idle__ totalCost" value={idle > 0 ? money(idle) : money(0)} sub={idle > 0 ? `${pct(idle / (total + idle))} of the cluster` : 'OpenCost returns 0 idle for this cluster'} />
        <Tile label="cpuCores (allocated)" value={`${model.cpuCores.toFixed(2)} cores`} sub={`requested ${model.cpuReq.toFixed(2)} · used ${model.cpuUse.toFixed(2)}`} />
        <Tile label="ramBytes (allocated)" value={`${(model.ramBytes / 2 ** 30).toFixed(1)} GiB`} sub={`requested ${(model.ramReq / 2 ** 30).toFixed(1)} · used ${(model.ramUse / 2 ** 30).toFixed(1)} GiB`} />
      </Tiles>

      <div className="ledger">
        <div className="ledger-bar" role="img" aria-label="Cost split by field">
          {byRes.map((r) => <div className="seg-fill" key={r.key} style={{ flex: r.value, background: RESOURCE_COLORS[r.key] }} title={`${r.field}: ${money(r.value)}`} />)}
          {idle > 0 && <div className="seg-fill idle" style={{ flex: idle }} title={`__idle__: ${money(idle)}`} />}
        </div>
        <div className="ledger-labels">
          {byRes.map((r) => <div className="item" key={r.key}><span className="sw" style={{ background: RESOURCE_COLORS[r.key] }} /><span>{r.field}</span><span className="v">{money(r.value)}</span><span className="p">{pct(r.value / (total + idle))}</span></div>)}
          {idle > 0 && <div className="item"><span className="sw idle" /><span>__idle__</span><span className="v">{money(idle)}</span><span className="p">{pct(idle / (total + idle))}</span></div>}
        </div>
      </div>

      <Section title="Trend" sub={`totalCost per ${step === '1h' ? 'hour' : 'day'} split by cost field`}>
        <ChartCard title="Cost over time" data={trend} series={trendSeries} step={step} height={260}>
          <StackedBars data={trend} series={trendSeries} step={step} />
        </ChartCard>
      </Section>

      <div className="grid-2 section">
        <div>
          <div className="section-head"><div><h2>totalCost by namespace</h2><p>Click to filter every view</p></div><button className="btn small" type="button" onClick={() => go('allocation')}>All namespaces</button></div>
          <HBars rows={byNs.slice(0, 15)} total={total} onClick={(r) => go('allocation', { namespace: r.key.startsWith('__') ? '' : r.key })} />
        </div>
        <div>
          <div className="section-head"><div><h2>totalCost by controllerKind</h2><p>Straight from the <code>controllerKind</code> property</p></div></div>
          <HBars rows={byKind} total={total} onClick={(r) => go('allocation', { kind: r.key.startsWith('__') ? '' : r.key })} />
          {byCluster.length > 1 && <><div className="section-head" style={{ marginTop: 24 }}><div><h2>totalCost by cluster</h2></div></div><HBars rows={byCluster} total={total} onClick={(r) => go('allocation', { cluster: r.key })} /></>}
        </div>
      </div>
    </div>
  );
}
