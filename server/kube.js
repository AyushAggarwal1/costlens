// Cluster inventory through kubectl (uses KUBECONFIG from the environment). Cached; degrades to null when kubectl is unavailable.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const TTL_MS = Number(process.env.KUBE_CACHE_TTL_MS || 5 * 60 * 1000);
let cache = { at: 0, value: null, error: null };

async function kubectlJson(args) {
  const { stdout } = await exec('kubectl', [...args, '-o', 'json'], { maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  return JSON.parse(stdout);
}

export function parseQuantity(q) {
  if (q === undefined || q === null) return 0;
  if (typeof q === 'number') return q;
  const m = String(q).match(/^([0-9.]+)([a-zA-Z]*)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2];
  const bin = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50 };
  const dec = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, m: 1e-3, '': 1 };
  if (unit in bin) return n * bin[unit];
  if (unit in dec) return n * dec[unit];
  return n;
}

function workloadSummary(kind, item) {
  const spec = item.spec || {};
  const meta = item.metadata || {};
  const out = {
    kind,
    namespace: meta.namespace,
    name: meta.name,
    labels: meta.labels || {},
    annotations: meta.annotations || {},
    createdAt: meta.creationTimestamp,
  };
  if (kind === 'deployment' || kind === 'statefulset') {
    out.replicasDesired = spec.replicas ?? 1;
    out.replicasReady = item.status?.readyReplicas ?? 0;
  }
  if (kind === 'daemonset') {
    out.replicasDesired = item.status?.desiredNumberScheduled ?? 0;
    out.replicasReady = item.status?.numberReady ?? 0;
  }
  if (kind === 'cronjob') {
    out.schedule = spec.schedule;
    out.timeZone = spec.timeZone || null;
    out.suspend = !!spec.suspend;
    out.lastScheduleTime = item.status?.lastScheduleTime || null;
    out.lastSuccessfulTime = item.status?.lastSuccessfulTime || null;
  }
  const podSpec = spec.template?.spec || spec.jobTemplate?.spec?.template?.spec;
  if (podSpec) {
    let cpuReq = 0, ramReq = 0, cpuLim = 0, ramLim = 0, containers = 0, withRequests = 0;
    for (const c of podSpec.containers || []) {
      containers++;
      const r = c.resources?.requests || {};
      const l = c.resources?.limits || {};
      if (r.cpu || r.memory) withRequests++;
      cpuReq += parseQuantity(r.cpu);
      ramReq += parseQuantity(r.memory);
      cpuLim += parseQuantity(l.cpu);
      ramLim += parseQuantity(l.memory);
    }
    out.containers = containers;
    out.containersWithRequests = withRequests;
    out.requests = { cpu: cpuReq, memory: ramReq };
    out.limits = { cpu: cpuLim, memory: ramLim };
  }
  return out;
}

async function load() {
  const [ns, deploy, sts, ds, cj, pvc, nodes, hpa, pods] = await Promise.all([
    kubectlJson(['get', 'namespaces']),
    kubectlJson(['get', 'deployments', '-A']),
    kubectlJson(['get', 'statefulsets', '-A']),
    kubectlJson(['get', 'daemonsets', '-A']),
    kubectlJson(['get', 'cronjobs', '-A']),
    kubectlJson(['get', 'pvc', '-A']),
    kubectlJson(['get', 'nodes']),
    kubectlJson(['get', 'hpa', '-A']).catch(() => ({ items: [] })),
    kubectlJson(['get', 'pods', '-A']).catch(() => ({ items: [] })),
  ]);

  const workloads = [
    ...deploy.items.map((i) => workloadSummary('deployment', i)),
    ...sts.items.map((i) => workloadSummary('statefulset', i)),
    ...ds.items.map((i) => workloadSummary('daemonset', i)),
    ...cj.items.map((i) => workloadSummary('cronjob', i)),
  ];

  // Which PVCs are actually mounted by a running pod
  const mounted = new Set();
  for (const p of pods.items) {
    for (const v of p.spec?.volumes || []) {
      if (v.persistentVolumeClaim?.claimName) mounted.add(`${p.metadata.namespace}/${v.persistentVolumeClaim.claimName}`);
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    namespaces: ns.items.map((n) => ({
      name: n.metadata.name,
      labels: n.metadata.labels || {},
      annotations: n.metadata.annotations || {},
      createdAt: n.metadata.creationTimestamp,
    })),
    workloads,
    hpas: hpa.items.map((h) => ({
      namespace: h.metadata.namespace,
      name: h.metadata.name,
      targetKind: (h.spec.scaleTargetRef?.kind || '').toLowerCase(),
      targetName: h.spec.scaleTargetRef?.name,
      min: h.spec.minReplicas ?? 1,
      max: h.spec.maxReplicas,
      current: h.status?.currentReplicas ?? null,
    })),
    pvcs: pvc.items.map((p) => ({
      namespace: p.metadata.namespace,
      name: p.metadata.name,
      volume: p.spec.volumeName || null,
      storageClass: p.spec.storageClassName || null,
      status: p.status?.phase,
      capacityBytes: parseQuantity(p.status?.capacity?.storage || p.spec.resources?.requests?.storage),
      accessModes: p.spec.accessModes || [],
      mounted: mounted.has(`${p.metadata.namespace}/${p.metadata.name}`),
      createdAt: p.metadata.creationTimestamp,
    })),
    nodes: nodes.items.map((n) => ({
      name: n.metadata.name,
      labels: n.metadata.labels || {},
      providerID: n.spec.providerID || null,
      instanceType: n.metadata.labels?.['node.kubernetes.io/instance-type'] || null,
      capacity: {
        cpu: parseQuantity(n.status.capacity?.cpu),
        memory: parseQuantity(n.status.capacity?.memory),
        ephemeralStorage: parseQuantity(n.status.capacity?.['ephemeral-storage']),
        pods: parseQuantity(n.status.capacity?.pods),
      },
      allocatable: {
        cpu: parseQuantity(n.status.allocatable?.cpu),
        memory: parseQuantity(n.status.allocatable?.memory),
        ephemeralStorage: parseQuantity(n.status.allocatable?.['ephemeral-storage']),
      },
      ready: (n.status.conditions || []).some((c) => c.type === 'Ready' && c.status === 'True'),
    })),
    podCount: pods.items.length,
  };
}

export async function getInventory({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;
  try {
    const value = await load();
    cache = { at: now, value, error: null };
    return value;
  } catch (e) {
    cache = { at: now, value: cache.value, error: e.message };
    return cache.value; // stale-or-null
  }
}

export function inventoryStatus() {
  return { available: !!cache.value, fetchedAt: cache.value?.fetchedAt || null, error: cache.error };
}
