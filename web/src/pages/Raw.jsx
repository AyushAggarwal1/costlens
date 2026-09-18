import React, { useState } from 'react';
import { api } from '../api.js';

const AGG = {
  allocation: ['cluster', 'node', 'namespace', 'controllerKind', 'controller', 'service', 'pod', 'container'],
  assets: ['type', 'category', 'cluster', 'node', 'providerID', 'service'],
  cloudCost: ['provider', 'invoiceEntityID', 'accountID', 'service', 'category', 'providerID'],
};

export default function Raw({ filters }) {
  const [endpoint, setEndpoint] = useState('allocation');
  const [params, setParams] = useState({ window: filters.window, aggregate: 'namespace', step: '', accumulate: 'true', includeIdle: 'true', filter: '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setParams((p) => ({ ...p, [k]: e.target.value }));

  const run = async () => {
    setBusy(true); setError(null);
    const q = Object.fromEntries(Object.entries(params).filter(([k, v]) => v !== '' && !(endpoint !== 'allocation' && k === 'includeIdle')));
    try { setResult(await api(`/api/raw/${endpoint}`, { ...q, _t: Date.now() })); }
    catch (e) { setError(e); setResult(null); }
    finally { setBusy(false); }
  };
  const text = result ? JSON.stringify(result.response, null, 2) : '';
  const summarize = () => {
    const d = result?.response?.data;
    if (!d) return '';
    if (Array.isArray(d)) return `${d.length} set${d.length === 1 ? '' : 's'}, ${d.reduce((a, s) => a + Object.keys(s || {}).length, 0)} records`;
    if (d.sets) return `${d.sets.length} sets`;
    return `${Object.keys(d).length} records`;
  };

  return (
    <div>
      <div className="page-head"><div><h1>Raw query</h1><p>Send any query to OpenCost and read the response exactly as it came back.</p></div></div>
      <div className="chart-card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label className="lbl">endpoint<select className="select" value={endpoint} onChange={(e) => { setEndpoint(e.target.value); setParams((p) => ({ ...p, aggregate: AGG[e.target.value][0] })); }}>{Object.keys(AGG).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="lbl">window<input className="input" style={{ width: 120 }} value={params.window} onChange={set('window')} /></label>
          <label className="lbl">aggregate<input className="input" style={{ width: 260 }} value={params.aggregate} onChange={set('aggregate')} list="agg-options" placeholder="comma separated" /></label>
          <datalist id="agg-options">{AGG[endpoint].map((a) => <option key={a} value={a} />)}</datalist>
          <label className="lbl">step<select className="select" value={params.step} onChange={set('step')}><option value="">none</option><option value="1h">1h</option><option value="1d">1d</option></select></label>
          <label className="lbl">accumulate<select className="select" value={params.accumulate} onChange={set('accumulate')}><option value="true">true</option><option value="false">false</option></select></label>
          {endpoint === 'allocation' && <label className="lbl">includeIdle<select className="select" value={params.includeIdle} onChange={set('includeIdle')}><option value="true">true</option><option value="false">false</option></select></label>}
          <label className="lbl">filter<input className="input" style={{ width: 260 }} value={params.filter} onChange={set('filter')} placeholder='namespace:"kube-system"+controllerName:"coredns"' /></label>
          <button className="btn primary" type="button" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run'}</button>
        </div>
        {result && <p className="muted small" style={{ marginTop: 10 }}>GET <code>{result.url}</code> · {result.ms} ms · {summarize()}</p>}
        {error && <p className="error" style={{ marginTop: 10 }}>{String(error.message)}</p>}
      </div>
      {result && (
        <div className="section">
          <div className="section-head"><div><h2>Response</h2><p>{(text.length / 1024).toFixed(0)} KiB</p></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn small" type="button" onClick={() => navigator.clipboard?.writeText(text)}>Copy JSON</button>
              <a className="btn small" href={`data:application/json;charset=utf-8,${encodeURIComponent(text)}`} download={`opencost-${endpoint}-${params.window}.json`}>Download</a>
            </div>
          </div>
          <pre style={{ maxHeight: '70vh', overflow: 'auto' }}>{text.length > 400000 ? text.slice(0, 400000) + '\n… truncated in view; use Download for the full response' : text}</pre>
        </div>
      )}
    </div>
  );
}
