import express from 'express';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { opencost, OpenCostError } from './opencost.js';
import { getInventory, inventoryStatus } from './kube.js';
import { prom } from './prom.js';
import { ALLOC_AGGREGATE, normalizeSets, accumulate } from './allocation.js';
import { loadOwnership, ownershipConfig } from './enrich/ownership.js';
import { loadCategories, categoriesConfig, categoryForService, categoryForAssetType } from './enrich/categories.js';
import { loadInventory, joinInventory } from './enrich/inventory.js';
import { loadRules, rulesConfig, detect } from './enrich/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const PORT = Number(process.env.PORT || 8080);

loadOwnership(); loadCategories(); loadRules();

const app = express();
app.use(express.json());

// ---- small response cache so the UI can re-slice without hammering OpenCost
const cache = new Map();
const CACHE_TTL = Number(process.env.API_CACHE_TTL_MS || 60_000);
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  const status = e instanceof OpenCostError ? (e.status === 0 ? 502 : 502) : 500;
  res.status(status).json({ error: e.message, upstreamStatus: e.status ?? null, detail: typeof e.body === 'string' ? e.body.slice(0, 300) : e.body });
});

function windowStep(req) {
  const window = String(req.query.window || '7d');
  let step = req.query.step ? String(req.query.step) : undefined;
  if (!step) {
    if (/^\d+h$/.test(window) || window === 'today' || window === '1d') step = '1h';
    else step = '1d';
  }
  return { window, step };
}

async function kubeNamespaceMap() {
  const inv = await getInventory();
  if (!inv) return null;
  return Object.fromEntries(inv.namespaces.map((n) => [n.name, n]));
}

async function allocationSets(window, step) {
  return cached(`alloc:${window}:${step}`, async () => {
    const [raw, nsMap] = await Promise.all([
      opencost.allocation({ window, step, aggregate: ALLOC_AGGREGATE, includeIdle: true, shareIdle: false }),
      kubeNamespaceMap(),
    ]);
    return normalizeSets(raw.data, nsMap);
  });
}

// ---- status
app.get('/api/status', wrap(async (req, res) => {
  const [ocOk, inv] = await Promise.all([opencost.healthy(), getInventory()]);
  let cloudCost = { enabled: false, reason: 'unknown' };
  try {
    await opencost.cloudCost({ window: '1d', aggregate: 'provider' });
    cloudCost = { enabled: true };
  } catch (e) {
    cloudCost = { enabled: false, reason: e.status === 404 ? 'Cloud cost ingestion is disabled in this OpenCost deployment (CLOUD_COST_ENABLED=false or no billing integration configured).' : e.message };
  }
  const promOk = prom.enabled ? await prom.healthy() : false;
  res.json({
    opencost: { url: opencost.base, reachable: ocOk },
    cloudCost,
    inventory: inventoryStatus(),
    prometheus: { configured: prom.enabled, url: prom.base || null, reachable: promOk },
    cluster: inv ? { nodes: inv.nodes.length, namespaces: inv.namespaces.length, workloads: inv.workloads.length, pvcs: inv.pvcs.length, pods: inv.podCount } : null,
    now: new Date().toISOString(),
  });
}));

// ---- allocation (cluster / namespace / workload, with ownership)
app.get('/api/allocation', wrap(async (req, res) => {
  const { window, step } = windowStep(req);
  const sets = await allocationSets(window, step);
  res.json({ window, step, sets, totals: accumulate(sets) });
}));

// ---- utilization series (cluster or single workload) + capacity
app.get('/api/utilization', wrap(async (req, res) => {
  const { window, step } = windowStep(req);
  const sets = await allocationSets(window, step);
  const inv = await getInventory();
  const ns = req.query.namespace ? String(req.query.namespace) : null;
  const ctrl = req.query.controller ? String(req.query.controller) : null;
  const team = req.query.team ? String(req.query.team) : null;
  const series = sets.map((s) => {
    const rows = s.rows.filter((r) => r.namespace !== '__idle__' && r.controllerKind !== '__idle__')
      .filter((r) => (!ns || r.namespace === ns) && (!ctrl || r.controller === ctrl) && (!team || r.owner.team === team));
    const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
    const idle = s.rows.find((r) => r.namespace === '__idle__' || r.controllerKind === '__idle__');
    return { start: s.start, end: s.end, cpuUse: sum('cpuUse'), cpuReq: sum('cpuReq'), cpuCores: sum('cpuCores'), ramUse: sum('ramUse'), ramReq: sum('ramReq'), ramBytes: sum('ramBytes'), totalCost: sum('totalCost'), idleCost: idle?.totalCost || 0, pvBytes: sum('pvBytes'), netBytes: sum('netBytes') };
  });
  const capacity = inv ? {
    cpu: inv.nodes.reduce((a, n) => a + n.allocatable.cpu, 0),
    memory: inv.nodes.reduce((a, n) => a + n.allocatable.memory, 0),
    ephemeralStorage: inv.nodes.reduce((a, n) => a + n.allocatable.ephemeralStorage, 0),
    nodes: inv.nodes,
  } : null;
  res.json({ window, step, series, capacity });
}));

// ---- storage: PVCs joined with OpenCost disk costs and Prometheus usage
app.get('/api/storage', wrap(async (req, res) => {
  const window = String(req.query.window || '7d');
  const [inv, assetsRaw, usage, nodeFs, sets] = await Promise.all([
    getInventory(),
    cached(`assets:${window}`, () => opencost.assets({ window, accumulate: true })),
    prom.enabled ? prom.pvcUsage() : null,
    prom.enabled ? prom.nodeFilesystems() : null,
    allocationSets(window, /^\d+h$/.test(window) ? '1h' : '1d'),
  ]);
  const assetData = assetsRaw?.data || {};
  const assetList = Array.isArray(assetData) ? assetData.flatMap((s) => Object.values(s)) : Object.values(assetData);
  const disks = assetList.filter((a) => a.type === 'Disk');
  const nodes = assetList.filter((a) => a.type === 'Node');
  // OpenCost disk asset name is the PV name; map PV -> PVC via inventory
  const pvToPvc = new Map();
  for (const p of inv?.pvcs || []) if (p.volume) pvToPvc.set(p.volume, p);
  // per-PV allocated cost from allocation rows (which namespaces/workloads paid for it)
  const pvConsumers = new Map();
  for (const r of accumulate(sets)) {
    for (const [pv, v] of Object.entries(r.pvs || {})) {
      const list = pvConsumers.get(pv) || [];
      list.push({ namespace: r.namespace, workload: r.controller, kind: r.controllerKind, cost: v.cost, owner: r.owner });
      pvConsumers.set(pv, list);
    }
  }
  const pvcs = (inv?.pvcs || []).map((p) => {
    const disk = disks.find((d) => d.properties?.name === p.volume);
    const u = usage?.[`${p.namespace}/${p.name}`];
    // hostPath-style provisioners (local-path, hostpath) report the node filesystem, not the claim
    const reportsHost = u?.capacityBytes != null && p.capacityBytes > 0 && Math.abs(u.capacityBytes - p.capacityBytes) / p.capacityBytes > 0.25;
    return {
      ...p,
      cost: disk?.totalCost ?? null,
      byteHours: disk?.byteHours ?? null,
      usedBytes: u?.usedBytes ?? null,
      reportedCapacityBytes: u?.capacityBytes ?? null,
      usageScope: u ? (reportsHost ? 'node-filesystem' : 'volume') : null,
      usedPercent: u?.usedBytes != null ? (reportsHost ? (u.usedBytes / u.capacityBytes) * 100 : (u.usedBytes / p.capacityBytes) * 100) : null,
      consumers: pvConsumers.get(p.volume) || [],
    };
  });
  const nodeNames = new Set(nodes.map((n) => n.properties?.name));
  const unmatchedDisks = disks.filter((d) => !pvToPvc.has(d.properties?.name) && !nodeNames.has(d.properties?.name)).map((d) => ({ name: d.properties?.name, cost: d.totalCost, bytes: d.bytes, byteHours: d.byteHours }));
  const nodeDisks = nodes.map((n) => {
    const fs = nodeFs?.[n.properties?.name];
    const local = disks.find((d) => d.properties?.name === n.properties?.name);
    return { name: n.properties?.name, localDiskCost: local?.totalCost ?? null, localDiskBytes: local?.bytes ?? null, fsSizeBytes: fs?.sizeBytes ?? null, fsAvailBytes: fs?.availBytes ?? null };
  });
  res.json({ window, pvcs, unmatchedDisks, nodeDisks, usageAvailable: !!usage, totalDiskCost: disks.reduce((a, d) => a + (d.totalCost || 0), 0) });
}));

app.get('/api/storage/series', wrap(async (req, res) => {
  const { namespace, claim } = req.query;
  const hours = Number(req.query.hours || 168);
  const series = prom.enabled ? await prom.pvcUsageSeries(String(namespace), String(claim), hours) : null;
  res.json({ namespace, claim, series });
}));

// ---- assets (nodes, disks, load balancers) with category
app.get('/api/assets', wrap(async (req, res) => {
  const window = String(req.query.window || '7d');
  const raw = await cached(`assets:${window}`, () => opencost.assets({ window, accumulate: true }));
  const data = raw?.data || {};
  const list = Array.isArray(data) ? data.flatMap((s) => Object.values(s)) : Object.values(data);
  res.json({ window, assets: list.map((a) => ({
    type: a.type, name: a.properties?.name, cluster: a.properties?.cluster, provider: a.properties?.provider, service: a.properties?.service,
    providerCategory: a.properties?.category, category: categoryForAssetType(a.type), providerID: a.properties?.providerID,
    totalCost: a.totalCost || 0, cpuCost: a.cpuCost || 0, ramCost: a.ramCost || 0, gpuCost: a.gpuCost || 0, minutes: a.minutes,
    cpuCores: a.cpuCores, ramBytes: a.ramBytes, bytes: a.bytes, nodeType: a.nodeType, cpuBreakdown: a.cpuBreakdown, ramBreakdown: a.ramBreakdown,
  })) });
}));

// ---- cloud cost (live, or sample when the integration is off)
function flattenCloudCost(payload) {
  // Accept CloudCostSetRange ({sets:[{cloudCosts:{...}}]}) or an array of sets.
  const d = payload?.data ?? payload;
  const sets = Array.isArray(d) ? d : (d?.sets || []);
  const lines = [];
  for (const set of sets) {
    const items = set.cloudCosts || set;
    for (const [key, cc] of Object.entries(items || {})) {
      const p = cc.properties || {};
      lines.push({
        key,
        provider: p.provider || 'unknown',
        accountID: p.accountID || p.invoiceEntityID || 'unknown',
        invoiceEntityID: p.invoiceEntityID || null,
        service: p.service || 'unknown',
        providerCategory: p.category || null,
        providerID: p.providerID || '',
        region: p.regionID || p.region || null,
        labels: p.labels || {},
        start: set.window?.start || cc.window?.start,
        end: set.window?.end || cc.window?.end,
        cost: cc.netCost?.cost ?? cc.amortizedNetCost?.cost ?? cc.listCost?.cost ?? 0,
        listCost: cc.listCost?.cost ?? null,
        netCost: cc.netCost?.cost ?? null,
        amortizedNetCost: cc.amortizedNetCost?.cost ?? null,
        invoicedCost: cc.invoicedCost?.cost ?? null,
        kubernetesPercent: cc.netCost?.kubernetesPercent ?? cc.listCost?.kubernetesPercent ?? 0,
      });
    }
  }
  return lines;
}

function sampleCloudCost(window) {
  const days = /^(\d+)d$/.test(window) ? Number(RegExp.$1) : (/^(\d+)h$/.test(window) ? Math.max(1, Number(RegExp.$1) / 24) : 7);
  const sample = JSON.parse(readFileSync(path.join(ROOT, 'config', 'demo-cloudcost.json'), 'utf8'));
  const lines = [];
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(end); dayStart.setUTCDate(end.getUTCDate() - i - 1);
    const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayStart.getUTCDate() + 1);
    // deterministic wobble so the trend is not flat
    const wobble = 1 + 0.12 * Math.sin((dayStart.getUTCDate() + 1) * 1.7);
    for (const l of sample.lines) {
      lines.push({ key: `${l.provider}/${l.accountID}/${l.service}/${l.providerID}`, provider: l.provider, accountID: l.accountID, invoiceEntityID: l.invoiceEntityID, service: l.service, providerCategory: l.category, providerID: l.providerID, region: l.region, labels: {},
        start: dayStart.toISOString(), end: dayEnd.toISOString(), cost: +(l.dailyCost * wobble).toFixed(4), listCost: +(l.dailyCost * wobble * 1.08).toFixed(4), netCost: +(l.dailyCost * wobble).toFixed(4), amortizedNetCost: null, invoicedCost: null, kubernetesPercent: l.kubernetesPercent });
    }
  }
  return lines;
}

app.get('/api/cloudcost', wrap(async (req, res) => {
  const window = String(req.query.window || '7d');
  const wantSample = req.query.sample === '1';
  let lines = null, source = 'live', reason = null;
  if (!wantSample) {
    try {
      const raw = await cached(`cloudcost:${window}`, () => opencost.cloudCost({ window, aggregate: 'provider,accountID,service,providerID' }));
      lines = flattenCloudCost(raw);
    } catch (e) {
      source = 'unavailable';
      reason = e.status === 404 ? 'Cloud cost ingestion is disabled in this OpenCost deployment. Enable it with CLOUD_COST_ENABLED=true and a billing-export integration (AWS CUR, GCP BigQuery export or Azure cost export).' : e.message;
    }
  }
  if (wantSample) { lines = sampleCloudCost(window); source = 'sample'; }
  if (!lines) return res.json({ window, source, reason, lines: [], coverage: null, inventory: loadInventory() });
  lines = lines.map((l) => ({ ...l, ...categoryForService(l.service, l.providerCategory) }));
  const joined = joinInventory(lines, loadInventory());
  res.json({ window, source, reason, lines: joined.lines, coverage: joined.coverage, inventory: loadInventory() });
}));

// ---- findings (dead / oversized / under-provisioned / no requests / orphaned storage / schedule)
app.get('/api/findings', wrap(async (req, res) => {
  const window = String(req.query.window || '7d');
  const [sets, inv] = await Promise.all([allocationSets(window, '1d'), getInventory()]);
  const workloads = accumulate(sets);
  // Hourly resolution (last 3 days at most) gives sizing peaks and schedule checks
  const hSets = await allocationSets(/^\d+h$/.test(window) ? window : '3d', '1h');
  const hourly = {};
  for (const s of hSets) for (const r of s.rows) {
    const k = `${r.controllerKind}/${r.namespace}/${r.controller}`;
    (hourly[k] = hourly[k] || []).push({ start: s.start, minutes: r.minutes, totalCost: r.totalCost, cpuUse: r.cpuUse, ramUse: r.ramUse });
  }
  const findings = detect({ workloads, inventory: inv, hourly });
  const monthlyTotal = workloads.filter((w) => w.namespace !== '__idle__' && w.minutes > 0).reduce((a, w) => a + (w.totalCost / (w.minutes / 60)) * rulesConfig().hoursPerMonth, 0);
  res.json({ window, findings, summary: {
    count: findings.length,
    estimatedMonthlySavings: findings.reduce((a, f) => a + (f.estimatedMonthlySavings || 0), 0),
    monthlyRunRate: monthlyTotal,
    byRule: Object.fromEntries(['dead', 'oversized', 'under-provisioned', 'no-requests', 'orphaned-storage', 'outside-schedule'].map((r) => [r, findings.filter((f) => f.rule === r).length])),
  }, rules: rulesConfig() });
}));

// ---- raw passthrough: the OpenCost response, untouched
app.get('/api/raw/:endpoint', wrap(async (req, res) => {
  const ep = { allocation: opencost.allocation, assets: opencost.assets, cloudCost: opencost.cloudCost }[req.params.endpoint];
  if (!ep) return res.status(404).json({ error: `Unknown endpoint ${req.params.endpoint}; use allocation, assets or cloudCost` });
  const params = { ...req.query };
  const url = new URL(opencost.base + '/' + req.params.endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const t0 = Date.now();
  const body = await ep(params);
  res.json({ url: url.toString(), ms: Date.now() - t0, response: body });
}));

// ---- inventory & config passthrough for the UI
app.get('/api/inventory', wrap(async (req, res) => {
  const inv = await getInventory({ force: req.query.refresh === '1' });
  res.json(inv || { error: inventoryStatus().error });
}));
app.get('/api/config', (req, res) => {
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith('_') ? undefined : v)));
  res.json({ ownership: strip(ownershipConfig()), categories: strip(categoriesConfig()), rules: strip(rulesConfig()) });
});
app.post('/api/config/reload', (req, res) => {
  loadOwnership(); loadCategories(); loadRules(); cache.clear();
  res.json({ ok: true });
});

// ---- static frontend (after `npm run build`)
const dist = path.join(ROOT, 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(PORT, () => {
  console.log(`OpenCost Insight API on http://localhost:${PORT}  (OpenCost: ${opencost.base}${prom.enabled ? `, Prometheus: ${prom.base}` : ''})`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or start with PORT=<other> npm start.`);
    process.exit(1);
  }
  throw e;
});
