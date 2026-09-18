// Resolves team / environment / cost centre for an allocation row.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.OWNERSHIP_CONFIG || path.join(here, '..', '..', 'config', 'ownership.json');

let config = null;
export function loadOwnership() {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  config._compiled = (config.rules || []).map((r) => ({
    ...r,
    _re: Object.fromEntries(Object.entries(r.match || {}).map(([k, v]) => [k, new RegExp(v)])),
  }));
  return config;
}
export function ownershipConfig() { return config || loadOwnership(); }

const norm = (k) => String(k).toLowerCase().replace(/[./-]/g, '_');

function fromLabels(labels, keys) {
  if (!labels) return null;
  const idx = {};
  for (const [k, v] of Object.entries(labels)) idx[norm(k)] = v;
  for (const k of keys) {
    const v = idx[norm(k)];
    if (v) return v;
  }
  return null;
}

/**
 * row: { namespace, controller, controllerKind, labels, namespaceLabels }
 * kubeNamespaces: optional map name -> {labels, annotations} from kubectl (richer than OpenCost's sanitized labels)
 */
export function resolveOwner(row, kubeNamespaces) {
  const cfg = ownershipConfig();
  const keys = cfg.labelKeys || {};
  const out = { team: null, environment: null, costCenter: null, source: null };
  const nsMeta = kubeNamespaces?.[row.namespace];
  const nsLabels = { ...(row.namespaceLabels || {}), ...(nsMeta?.labels || {}), ...(nsMeta?.annotations || {}) };

  for (const field of ['team', 'environment', 'costCenter']) {
    const fromWorkload = fromLabels(row.labels, keys[field] || []);
    if (fromWorkload) { out[field] = fromWorkload; out.source = out.source || 'workload label'; continue; }
    const fromNs = fromLabels(nsLabels, keys[field] || []);
    if (fromNs) { out[field] = fromNs; out.source = out.source || 'namespace label'; }
  }

  if (!out.team || !out.environment) {
    for (const rule of cfg._compiled) {
      const ok = Object.entries(rule._re).every(([field, re]) => re.test(String(row[field] ?? '')));
      if (!ok) continue;
      if (!out.team && rule.team) { out.team = rule.team; out.source = out.source || 'rule'; }
      if (!out.environment && rule.environment) out.environment = rule.environment;
      if (!out.costCenter && rule.costCenter) out.costCenter = rule.costCenter;
      break;
    }
  }
  if (!out.team) { out.team = cfg.default?.team || 'Unassigned'; out.source = out.source || 'default'; }
  if (!out.environment) out.environment = cfg.default?.environment || 'unknown';
  return out;
}
