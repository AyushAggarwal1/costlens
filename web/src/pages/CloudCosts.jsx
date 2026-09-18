import React, { useMemo, useState } from 'react';
import { money, pct } from '../api.js';
import { useApi } from '../hooks.js';
import { Section, Seg, DataTable, Loading, ErrorBox, Notice, Tiles, Tile, SERIES } from '../components/ui.jsx';
import { ChartCard, StackedBars } from '../components/charts.jsx';

const GROUPS = [{ value: 'provider', label: 'provider' }, { value: 'invoiceEntityID', label: 'invoiceEntityID' }, { value: 'accountID', label: 'accountID' }, { value: 'service', label: 'service' }, { value: 'category', label: 'category' }, { value: 'providerID', label: 'providerID' }];
const COSTS = ['listCost', 'netCost', 'amortizedNetCost', 'invoicedCost', 'amortizedCost'];

function flatten(payload) {
  const d = payload?.data ?? payload;
  const sets = Array.isArray(d) ? d : (d?.sets || []);
  const lines = [];
  for (const set of sets) {
    const items = set.cloudCosts || set;
    for (const [key, cc] of Object.entries(items || {})) {
      const p = cc.properties || {};
      const line = { key, provider: p.provider, invoiceEntityID: p.invoiceEntityID, accountID: p.accountID, service: p.service, category: p.category, providerID: p.providerID, regionID: p.regionID, start: set.window?.start || cc.window?.start, end: set.window?.end || cc.window?.end };
      for (const c of COSTS) { line[c] = cc[c]?.cost ?? null; line[c + 'K8s'] = cc[c]?.kubernetesPercent ?? null; }
      lines.push(line);
    }
  }
  return lines;
}

export default function CloudCosts({ filters, status }) {
  const [group, setGroup] = useState('service');
  const [costField, setCostField] = useState('netCost');
  const cc = useApi('/api/raw/cloudCost', { window: filters.window, aggregate: 'provider,invoiceEntityID,accountID,service,category,providerID' });

  const model = useMemo(() => {
    if (!cc.data?.response) return null;
    const lines = flatten(cc.data.response);
    if (!lines.length) return { lines, agg: [], total: 0, series: [], trend: [] };
    const m = new Map();
    for (const l of lines) {
      const k = l[group] || '(empty)';
      const a = m.get(k) || { key: k, label: k, lines: 0, ...Object.fromEntries(COSTS.map((c) => [c, 0])), k8s: 0 };
      for (const c of COSTS) a[c] += l[c] || 0;
      a.k8s += (l[costField] || 0) * (l[costField + 'K8s'] || 0);
      a.lines++;
      m.set(k, a);
    }
    const agg = [...m.values()].sort((a, b) => b[costField] - a[costField]);
    const total = agg.reduce((a, r) => a + r[costField], 0);
    const slot = new Map(agg.slice(0, 7).map((r, i) => [r.key, i]));
    const hasOther = agg.length > 7;
    const series = [...agg.slice(0, 7).map((r) => ({ key: r.key, label: r.label.length > 34 ? '…' + r.label.slice(-32) : r.label, color: SERIES[slot.get(r.key)] })), ...(hasOther ? [{ key: '__other__', label: 'Other', color: 'var(--idle)' }] : [])];
    const days = new Map();
    for (const l of lines) {
      const d = (l.start || '').slice(0, 10);
      let o = days.get(d);
      if (!o) { o = { x: l.start }; for (const s of series) o[s.key] = 0; days.set(d, o); }
      const k = l[group] || '(empty)';
      if (slot.has(k)) o[k] += l[costField] || 0; else if (hasOther) o.__other__ += l[costField] || 0;
    }
    return { lines, agg, total, series, trend: [...days.values()].sort((a, b) => String(a.x).localeCompare(String(b.x))) };
  }, [cc.data, group, costField]);

  const disabled = cc.error && /404|disabled/i.test(String(cc.error.message));
  return (
    <div className={cc.loading ? 'loading' : ''}>
      <div className="page-head">
        <div><h1>Cloud costs</h1><p>The <code>/cloudCost</code> response grouped on its own properties: provider, invoiceEntityID, accountID, service, category and providerID.</p></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Seg options={GROUPS} value={group} onChange={setGroup} />
          <select className="select" value={costField} onChange={(e) => setCostField(e.target.value)} aria-label="Cost field">{COSTS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>
      </div>
      {cc.error && (
        <Notice tone="warn" title={disabled ? 'OpenCost returned 404 for /cloudCost' : 'Could not load /cloudCost'}>
          {disabled ? `${status?.cloudCost?.reason || 'Cloud cost ingestion is disabled on this deployment.'} Enable it with a billing export integration and this view fills in.` : String(cc.error.message)}
          {cc.data?.url && <><br /><code>{cc.data.url}</code></>}
        </Notice>
      )}
      {!cc.error && !model && <Loading />}
      {model && model.lines.length === 0 && <div className="empty">OpenCost returned no cloud cost lines for {filters.window}.</div>}
      {model && model.lines.length > 0 && (
        <>
          <Tiles>
            <Tile label={`${costField}, sum`} value={money(model.total)} hero sub={`${model.lines.length} lines · GET ${cc.data.url}`} />
            <Tile label="listCost, sum" value={money(model.agg.reduce((a, r) => a + r.listCost, 0))} />
            <Tile label="amortizedNetCost, sum" value={money(model.agg.reduce((a, r) => a + r.amortizedNetCost, 0))} />
            <Tile label={`kubernetesPercent-weighted ${costField}`} value={money(model.agg.reduce((a, r) => a + r.k8s, 0))} sub={pct(model.agg.reduce((a, r) => a + r.k8s, 0) / (model.total || 1))} />
          </Tiles>
          <Section title="Trend" sub={`${costField} per day by ${group}`}>
            <ChartCard title={`${costField} per day`} data={model.trend} series={model.series} step="1d" height={260}><StackedBars data={model.trend} series={model.series} step="1d" /></ChartCard>
          </Section>
          <Section title={`By ${group}`}>
            <DataTable rowKey={(r) => r.key} defaultSort={costField}
              columns={[
                { key: 'label', label: group, render: (r) => <span style={{ wordBreak: 'break-all' }}>{r.label}</span> },
                { key: 'lines', label: 'lines', align: 'r' },
                ...COSTS.map((c) => ({ key: c, label: c, align: 'r', render: (r) => money(r[c]) })),
                { key: 'k8s', label: 'kubernetesPercent share', align: 'r', render: (r) => pct(r.k8s / (r[costField] || 1)) },
                { key: 'share', label: 'share', align: 'r', sort: (r) => r[costField], render: (r) => pct(r[costField] / (model.total || 1)) },
              ]}
              rows={model.agg} footer={{ label: `${model.agg.length} rows`, [costField]: money(model.total), share: '100%' }} />
          </Section>
        </>
      )}
    </div>
  );
}
