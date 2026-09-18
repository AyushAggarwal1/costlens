import React, { useMemo, useState } from 'react';
import { money, pct, bytes, num } from '../api.js';
import { useApi } from '../hooks.js';
import { Section, Seg, DataTable, Loading, ErrorBox, HBars, Tiles, Tile } from '../components/ui.jsx';

const GROUPS = [{ value: 'type', label: 'type' }, { value: 'category', label: 'category' }, { value: 'provider', label: 'provider' }, { value: 'service', label: 'service' }];

export default function Assets({ filters }) {
  const assets = useApi('/api/raw/assets', { window: filters.window, accumulate: 'true' });
  const [group, setGroup] = useState('type');
  const list = useMemo(() => {
    const d = assets.data?.response?.data;
    if (!d) return [];
    const items = Array.isArray(d) ? d.flatMap((s) => Object.entries(s)) : Object.entries(d);
    return items.map(([key, a]) => ({ key, ...a }));
  }, [assets.data]);

  if (assets.error && !assets.data) return <ErrorBox error={assets.error} />;
  if (!assets.data) return <Loading />;
  const total = list.reduce((a, x) => a + (x.totalCost || 0), 0);
  const groups = (() => {
    const m = new Map();
    for (const a of list) { const k = a.properties?.[group] ?? a[group] ?? 'unknown'; m.set(k, (m.get(k) || 0) + (a.totalCost || 0)); }
    return [...m.entries()].map(([label, value]) => ({ label, key: label, value })).sort((a, b) => b.value - a.value);
  })();
  const nodes = list.filter((a) => a.type === 'Node');
  const disks = list.filter((a) => a.type === 'Disk');
  const others = list.filter((a) => a.type !== 'Node' && a.type !== 'Disk');
  const prop = (k) => (r) => r.properties?.[k] ?? '';

  return (
    <div className={assets.loading ? 'loading' : ''}>
      <div className="page-head">
        <div><h1>Assets</h1><p>The <code>/assets?accumulate=true</code> response: one record per node, disk, load balancer and cluster-management fee, with OpenCost's own <code>category</code>, <code>provider</code> and <code>service</code> properties.</p></div>
        <Seg options={GROUPS} value={group} onChange={setGroup} />
      </div>
      <Tiles>
        <Tile label="totalCost, all assets" value={money(total)} hero sub={`${list.length} asset records in ${filters.window}`} />
        <Tile label="Node cpuCores" value={nodes.some((n) => n.cpuCores != null) ? num(nodes.reduce((a, n) => a + (n.cpuCores || 0), 0)) : 'null'} sub={nodes.some((n) => n.cpuCores != null) ? `${nodes.length} node${nodes.length === 1 ? '' : 's'}` : 'OpenCost returns null without node pricing'} />
        <Tile label="Node ramBytes" value={nodes.some((n) => n.ramBytes != null) ? bytes(nodes.reduce((a, n) => a + (n.ramBytes || 0), 0)) : 'null'} sub={nodes.some((n) => n.ramBytes != null) ? '' : 'OpenCost returns null without node pricing'} />
        <Tile label="Disk bytes" value={bytes(disks.reduce((a, d) => a + (d.bytes || 0), 0))} sub={`${disks.length} disk records · ${money(disks.reduce((a, d) => a + (d.totalCost || 0), 0))}`} />
      </Tiles>

      <Section title={`totalCost by ${group}`} sub="Grouped on the asset property, as OpenCost reports it">
        <HBars rows={groups} total={total} />
      </Section>

      <Section title="Node" sub="Capacity, hours and the idle / system / user breakdown">
        <DataTable rowKey={(r) => r.key} defaultSort="totalCost" emptyText="No Node assets in this window."
          columns={[
            { key: 'name', label: 'name', sort: prop('name'), render: (r) => <><span>{r.properties?.name}</span><span className="sub">{r.properties?.providerID}</span></> },
            { key: 'nodeType', label: 'nodeType' },
            { key: 'minutes', label: 'minutes', align: 'r', render: (r) => num(r.minutes) },
            { key: 'cpuCores', label: 'cpuCores', align: 'r', render: (r) => r.cpuCores ?? <span className="muted">null</span> },
            { key: 'ramBytes', label: 'ramBytes', align: 'r', render: (r) => r.ramBytes != null ? bytes(r.ramBytes) : <span className="muted">null</span> },
            { key: 'cpuCoreHours', label: 'cpuCoreHours', align: 'r', render: (r) => num(r.cpuCoreHours, 2) },
            { key: 'ramByteHours', label: 'ramByteHours', align: 'r', render: (r) => num(r.ramByteHours) },
            { key: 'cpuBreakdown', label: 'cpuBreakdown', sortable: false, render: (r) => r.cpuBreakdown ? Object.entries(r.cpuBreakdown).map(([k, v]) => `${k} ${pct(v)}`).join(' · ') : '–' },
            { key: 'ramBreakdown', label: 'ramBreakdown', sortable: false, render: (r) => r.ramBreakdown ? Object.entries(r.ramBreakdown).map(([k, v]) => `${k} ${pct(v)}`).join(' · ') : '–' },
            { key: 'preemptible', label: 'preemptible', align: 'r' },
            { key: 'discount', label: 'discount', align: 'r' },
            { key: 'cpuCost', label: 'cpuCost', align: 'r', render: (r) => money(r.cpuCost) },
            { key: 'ramCost', label: 'ramCost', align: 'r', render: (r) => money(r.ramCost) },
            { key: 'gpuCost', label: 'gpuCost', align: 'r', render: (r) => money(r.gpuCost) },
            { key: 'totalCost', label: 'totalCost', align: 'r', render: (r) => <strong>{money(r.totalCost)}</strong> },
          ]}
          rows={nodes} />
      </Section>

      <Section title="Disk" sub="Provisioned bytes, byte-hours and cost per persistent volume">
        <DataTable rowKey={(r) => r.key} defaultSort="totalCost" pageSize={40} emptyText="No Disk assets in this window."
          columns={[
            { key: 'name', label: 'name', sort: prop('name'), render: (r) => <><span>{r.properties?.name}</span><span className="sub">{r.claimNamespace ? `${r.claimNamespace}/${r.claimName}` : ''}{r.storageClass ? ` · ${r.storageClass}` : ''}</span></> },
            { key: 'local', label: 'local', render: (r) => String(r.local ?? '') },
            { key: 'minutes', label: 'minutes', align: 'r', render: (r) => num(r.minutes) },
            { key: 'bytes', label: 'bytes', align: 'r', render: (r) => r.bytes != null ? bytes(r.bytes) : <span className="muted">null</span> },
            { key: 'byteHours', label: 'byteHours', align: 'r', render: (r) => num(r.byteHours) },
            { key: 'byteHoursUsed', label: 'byteHoursUsed', align: 'r', render: (r) => r.byteHoursUsed != null ? num(r.byteHoursUsed) : <span className="muted">null</span> },
            { key: 'byteUsageMax', label: 'byteUsageMax', align: 'r', render: (r) => r.byteUsageMax != null ? bytes(r.byteUsageMax) : <span className="muted">null</span> },
            { key: 'breakdown', label: 'breakdown', sortable: false, render: (r) => r.breakdown ? Object.entries(r.breakdown).map(([k, v]) => `${k} ${pct(v)}`).join(' · ') : <span className="muted">null</span> },
            { key: 'adjustment', label: 'adjustment', align: 'r', render: (r) => money(r.adjustment) },
            { key: 'totalCost', label: 'totalCost', align: 'r', render: (r) => <strong>{money(r.totalCost)}</strong> },
          ]}
          rows={disks} footer={{ name: `${disks.length} disks`, bytes: bytes(disks.reduce((a, d) => a + (d.bytes || 0), 0)), totalCost: money(disks.reduce((a, d) => a + (d.totalCost || 0), 0)) }} />
      </Section>

      <Section title="LoadBalancer, ClusterManagement and other assets">
        <DataTable rowKey={(r) => r.key} defaultSort="totalCost" emptyText="No other assets in this window."
          columns={[
            { key: 'type', label: 'type' },
            { key: 'name', label: 'name', sort: prop('name'), render: (r) => <><span>{r.properties?.name || '–'}</span><span className="sub">{r.properties?.providerID || ''}{r.ip ? ` · ${r.ip}` : ''}{r.private != null ? ` · private ${r.private}` : ''}</span></> },
            { key: 'category', label: 'category', sort: prop('category'), render: prop('category') },
            { key: 'provider', label: 'provider', sort: prop('provider'), render: prop('provider') },
            { key: 'service', label: 'service', sort: prop('service'), render: prop('service') },
            { key: 'minutes', label: 'minutes', align: 'r', render: (r) => num(r.minutes) },
            { key: 'totalCost', label: 'totalCost', align: 'r', render: (r) => <strong>{money(r.totalCost)}</strong> },
          ]}
          rows={others} />
      </Section>
    </div>
  );
}
