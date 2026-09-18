import { useEffect, useMemo, useState } from 'react';
import { api, isSystemRow } from './api.js';

export function useApi(path, params, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const key = JSON.stringify([path, params]);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path, params).then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState((s) => ({ data: s.data, error, loading: false })));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ? [key, ...deps] : [key]);
  return state;
}

export const DEFAULT_FILTERS = { window: '7d', cluster: '', namespace: '', kind: '', search: '' };

export function matchesFilters(r, f) {
  if (f.cluster && r.cluster !== f.cluster) return false;
  if (f.namespace && r.namespace !== f.namespace) return false;
  if (f.kind && r.controllerKind !== f.kind) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!`${r.namespace} ${r.controller}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

export function useFilterOptions(totals) {
  return useMemo(() => {
    const rows = (totals || []).filter((r) => !isSystemRow(r));
    const uniq = (f) => [...new Set(rows.map(f).filter(Boolean))].sort();
    return { clusters: uniq((r) => r.cluster), namespaces: uniq((r) => r.namespace), kinds: uniq((r) => r.controllerKind) };
  }, [totals]);
}
