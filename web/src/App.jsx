import React, { useEffect, useMemo, useState } from 'react';
import { useApi, DEFAULT_FILTERS, useFilterOptions } from './hooks.js';
import { displayName } from './api.js';
import Overview from './pages/Overview.jsx';
import Allocation from './pages/Allocation.jsx';
import Assets from './pages/Assets.jsx';
import CloudCosts from './pages/CloudCosts.jsx';
import Utilization from './pages/Utilization.jsx';
import Raw from './pages/Raw.jsx';

const PAGES = [
  { id: 'overview', label: 'Overview', key: '1' },
  { id: 'allocation', label: 'Allocation', key: '2' },
  { id: 'assets', label: 'Assets', key: '3' },
  { id: 'cloud', label: 'Cloud costs', key: '4' },
  { id: 'utilization', label: 'Utilization', key: '5' },
  { id: 'raw', label: 'Raw query', key: '6' },
];
const WINDOWS = [{ value: '24h', label: '24h' }, { value: '3d', label: '3d' }, { value: '7d', label: '7d' }, { value: '14d', label: '14d' }, { value: '30d', label: '30d' }];

function readHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [page, qs] = h.split('?');
  const f = { ...DEFAULT_FILTERS };
  if (qs) for (const [k, v] of new URLSearchParams(qs)) if (k in f) f[k] = v;
  return { page: PAGES.some((p) => p.id === page) ? page : 'overview', filters: f };
}

export default function App() {
  const init = useMemo(readHash, []);
  const [page, setPage] = useState(init.page);
  const [filters, setFilters] = useState(init.filters);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('theme') || ''; } catch { return ''; } });

  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([k, v]) => v && v !== DEFAULT_FILTERS[k])).toString();
    window.history.replaceState(null, '', `#/${page}${qs ? '?' + qs : ''}`);
  }, [page, filters]);
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);
  useEffect(() => {
    const onHash = () => { const h = readHash(); setPage(h.page); setFilters(h.filters); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const p = PAGES.find((x) => x.key === e.key);
      if (p) setPage(p.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const status = useApi('/api/status', {});
  const alloc = useApi('/api/allocation', { window: filters.window });
  const opts = useFilterOptions(alloc.data?.totals);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target ? e.target.value : e }));
  const reset = () => setFilters({ ...DEFAULT_FILTERS, window: filters.window });
  const active = Object.entries(filters).filter(([k, v]) => k !== 'window' && v).length;

  const pageProps = { filters, setFilters, alloc, status: status.data, opts, go: (p, f) => { if (f) setFilters((x) => ({ ...x, ...f })); setPage(p); } };
  const Page = { overview: Overview, allocation: Allocation, assets: Assets, cloud: CloudCosts, utilization: Utilization, raw: Raw }[page];
  const st = status.data;
  const showFilters = page !== 'raw';

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand"><span className="brand-name">Cost Ledger</span><span className="brand-sub">raw OpenCost data</span></div>
        <nav className="nav" aria-label="Views">
          {PAGES.map((p) => <button key={p.id} type="button" aria-current={page === p.id ? 'page' : undefined} onClick={() => setPage(p.id)}><span className="key">{p.key}</span>{p.label}</button>)}
        </nav>
        <div className="rail-foot">
          <div><span className={`dot ${st ? (st.opencost.reachable ? 'on' : 'off') : 'na'}`} />OpenCost {st ? (st.opencost.reachable ? 'connected' : 'unreachable') : '…'}</div>
          {st && <div className="muted">{st.opencost.url}</div>}
          <div><span className={`dot ${st ? (st.cloudCost.enabled ? 'on' : 'na') : 'na'}`} />Cloud cost API {st ? (st.cloudCost.enabled ? 'enabled' : 'disabled') : '…'}</div>
          <div style={{ marginTop: 8 }}><button className="btn small" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? '' : 'dark')}>Theme: {theme || 'system'}</button></div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="seg" role="group" aria-label="Time window">
            {WINDOWS.map((w) => <button key={w.value} type="button" aria-pressed={filters.window === w.value} onClick={() => setFilters((f) => ({ ...f, window: w.value }))}>{w.label}</button>)}
          </div>
          {showFilters && (
            <>
              {opts.clusters.length > 1 && <select className="select" value={filters.cluster} onChange={set('cluster')} aria-label="Cluster"><option value="">All clusters</option>{opts.clusters.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
              <select className="select" value={filters.namespace} onChange={set('namespace')} aria-label="Namespace"><option value="">All namespaces</option>{opts.namespaces.map((c) => <option key={c} value={c}>{displayName(c)}</option>)}</select>
              <select className="select" value={filters.kind} onChange={set('kind')} aria-label="controllerKind"><option value="">All controllerKinds</option>{opts.kinds.map((c) => <option key={c} value={c}>{displayName(c)}</option>)}</select>
              <input className="input" type="search" placeholder="Search namespace or controller" value={filters.search} onChange={set('search')} aria-label="Search" />
              {active > 0 && <button className="btn" type="button" onClick={reset}>Clear {active} filter{active > 1 ? 's' : ''}</button>}
            </>
          )}
          <div className="spacer" />
          {alloc.data && <span className="muted small">Data {new Date(alloc.data.sets[0]?.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to {new Date(alloc.data.sets[alloc.data.sets.length - 1]?.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
        </div>
        <main className="content"><Page {...pageProps} /></main>
      </div>
    </div>
  );
}
