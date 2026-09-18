// Detection rules for dead / oversized / under-provisioned / unmanaged workloads and orphaned storage.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.RULES_CONFIG || path.join(here, '..', '..', 'config', 'rules.json');

let rules = null;
export function loadRules() {
  rules = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  rules.schedules._compiled = (rules.schedules.entries || []).map((e) => ({
    ...e,
    _re: Object.fromEntries(Object.entries(e.match || {}).map(([k, v]) => [k, new RegExp(v)])),
  }));
  return rules;
}
export function rulesConfig() { return rules || loadRules(); }

const GiB = 2 ** 30;

function scheduleFor(w) {
  for (const e of rulesConfig().schedules._compiled) {
    if (Object.entries(e._re).every(([f, re]) => re.test(String(w[f] ?? '')))) return e;
  }
  return null;
}

/**
 * history: per-workload array of { start, minutes, cpuUse, cpuReq, ramUse, ramReq, netBytes, totalCost, cpuCost, ramCost, cpuCoreHours, ramByteHours }
 * summary: accumulated row (same fields, whole window) with identity + owner
 * inventory: kubectl inventory (optional)
 * hourly: optional per-workload hourly series for schedule checks
 */
export function detect({ workloads, inventory, hourly }) {
  const R = rulesConfig();
  const H = R.hoursPerMonth;
  const findings = [];

  const kubeIdx = new Map();
  for (const w of inventory?.workloads || []) kubeIdx.set(`${w.kind}/${w.namespace}/${w.name}`, w);
  const hpaIdx = new Map();
  for (const h of inventory?.hpas || []) hpaIdx.set(`${h.targetKind}/${h.namespace}/${h.targetName}`, h);

  for (const w of workloads) {
    const hours = w.minutes / 60;
    if (!hours) continue;
    const monthly = (w.totalCost / hours) * H;
    const cpuPrice = w.cpuCoreHours > 0 ? w.cpuCost / w.cpuCoreHours : 0; // $ per core-hour
    const ramPrice = w.ramByteHours > 0 ? (w.ramCost / w.ramByteHours) * GiB : 0; // $ per GiB-hour
    const kube = kubeIdx.get(`${w.controllerKind}/${w.namespace}/${w.controller}`);
    const hpa = hpaIdx.get(`${w.controllerKind}/${w.namespace}/${w.controller}`);
    const base = {
      namespace: w.namespace, workload: w.controller, kind: w.controllerKind, owner: w.owner,
      monthlyCost: monthly, windowCost: w.totalCost, history: w.history,
      replicas: kube ? { desired: kube.replicasDesired, ready: kube.replicasReady } : null,
      hpa: hpa ? { min: hpa.min, max: hpa.max } : null,
    };

    if (w.namespace === '__unmounted__' || w.controller === '__unmounted__' || (w.pod || '').endsWith('-unmounted-pvcs')) {
      if (monthly >= R.orphanedStorage.minMonthlyCost) {
        findings.push({ ...base, rule: 'orphaned-storage', severity: 'warning',
          title: `Unmounted persistent volumes in ${w.namespace === '__unmounted__' ? 'the cluster' : w.namespace}`,
          evidence: { pvBytes: w.pvBytes, pvs: w.pvs },
          estimatedMonthlySavings: monthly,
          recommendation: 'No pod mounts these volumes. Snapshot if the data matters, then delete the PVC.' });
      }
      continue;
    }
    if (w.namespace === '__idle__' || w.controller === '__idle__' || w.controllerKind === '__unallocated__') continue;

    const netPerHour = w.netBytes / hours;
    const dead = w.cpuUse <= R.dead.maxCpuCores && netPerHour <= R.dead.maxNetworkBytesPerHour && monthly >= R.dead.minMonthlyCost;
    if (dead) {
      findings.push({ ...base, rule: 'dead', severity: monthly > 5 ? 'serious' : 'warning',
        title: `${w.controller} shows no meaningful CPU or network activity`,
        evidence: { cpuUseCores: w.cpuUse, cpuReqCores: w.cpuReq, ramUseBytes: w.ramUse, networkBytesPerHour: netPerHour,
          lastScheduleTime: kube?.lastScheduleTime || null, schedule: kube?.schedule || null },
        estimatedMonthlySavings: monthly,
        recommendation: kube?.kind === 'cronjob'
          ? 'CronJob pods are idle between runs; check whether the job still needs to run on this schedule.'
          : 'Confirm with the owner and scale to zero or delete. Keep manifests in git so it can be restored.' });
      continue; // dead supersedes sizing findings
    }

    // Oversized: requests far above observed peak usage
    // Peak = highest hourly average where we have it (daily averages hide spikes), else highest daily average
    const hourlySeries = hourly?.[`${w.controllerKind}/${w.namespace}/${w.controller}`] || [];
    const peakCpu = Math.max(w.cpuUse, ...(w.history || []).map((h) => h.cpuUse || 0), ...hourlySeries.map((h) => h.cpuUse || 0));
    const peakRam = Math.max(w.ramUse, ...(w.history || []).map((h) => h.ramUse || 0), ...hourlySeries.map((h) => h.ramUse || 0));
    const cpuOver = w.cpuReq >= R.oversized.minCpuRequestCores && w.cpuReq / Math.max(peakCpu, 0.001) >= R.oversized.cpuRequestToUsageRatio;
    const ramOver = w.ramReq >= R.oversized.minRamRequestBytes && w.ramReq / Math.max(peakRam, 1) >= R.oversized.ramRequestToUsageRatio;
    if (cpuOver || ramOver) {
      const recCpu = cpuOver ? Math.max(R.oversized.minRecommendedCpuCores, peakCpu * R.oversized.recommendationHeadroom) : w.cpuReq;
      const recRam = ramOver ? Math.max(R.oversized.minRecommendedRamBytes, peakRam * R.oversized.recommendationHeadroom) : w.ramReq;
      const savings = Math.min(monthly, Math.max(0, (w.cpuReq - recCpu)) * cpuPrice * H + Math.max(0, (w.ramReq - recRam) / GiB) * ramPrice * H);
      if (savings >= R.oversized.minMonthlySavings) {
        findings.push({ ...base, rule: 'oversized', severity: savings > 10 ? 'serious' : 'warning',
          title: `${w.controller} requests ${cpuOver && ramOver ? 'CPU and memory' : cpuOver ? 'CPU' : 'memory'} far above peak usage`,
          evidence: { cpuReqCores: w.cpuReq, cpuPeakCores: peakCpu, cpuUseCores: w.cpuUse, ramReqBytes: w.ramReq, ramPeakBytes: peakRam, ramUseBytes: w.ramUse,
            recommendedCpuCores: recCpu, recommendedRamBytes: recRam, cpuPricePerCoreHour: cpuPrice, ramPricePerGiBHour: ramPrice, hpa: hpa || null },
          estimatedMonthlySavings: savings,
          recommendation: `Set requests to about ${recCpu.toFixed(2)} cores and ${(recRam / 2 ** 20).toFixed(0)} MiB (observed peak × ${R.oversized.recommendationHeadroom}, based on ${hourlySeries.length ? 'hourly' : 'daily'} averages).` + (hpa ? ' An HPA targets this workload, so lower requests will also change its scaling points.' : '') });
        continue;
      }
    }

    // Under-provisioned: usage well above request (eviction / throttling risk, not a saving)
    const ramUnder = w.ramReq > 0 && w.ramUse >= R.underProvisioned.minRamUsageBytes && w.ramUse / w.ramReq >= R.underProvisioned.usageToRequestRatio;
    const cpuUnder = w.cpuReq > 0 && w.cpuUse / w.cpuReq >= R.underProvisioned.usageToRequestRatio && w.cpuUse > 0.05;
    if (ramUnder || cpuUnder) {
      findings.push({ ...base, rule: 'under-provisioned', severity: ramUnder ? 'serious' : 'warning',
        title: `${w.controller} uses ${ramUnder ? 'memory' : 'CPU'} well beyond its request`,
        evidence: { cpuReqCores: w.cpuReq, cpuUseCores: w.cpuUse, ramReqBytes: w.ramReq, ramUseBytes: w.ramUse, ramRatio: w.ramReq ? w.ramUse / w.ramReq : null },
        estimatedMonthlySavings: 0,
        recommendation: `Raise requests toward observed usage (${(w.ramUse / 2 ** 20).toFixed(0)} MiB memory, ${w.cpuUse.toFixed(2)} cores) so the scheduler bin-packs correctly and the pod is not first in line for eviction.` });
      continue;
    }

    // No requests at all: cost is real but the workload is invisible to scheduling and budgeting
    if (w.cpuReq === 0 && w.ramReq === 0 && monthly >= R.noRequests.minMonthlyCost) {
      findings.push({ ...base, rule: 'no-requests', severity: 'info',
        title: `${w.controller} runs without resource requests`,
        evidence: { cpuUseCores: w.cpuUse, ramUseBytes: w.ramUse },
        estimatedMonthlySavings: 0,
        recommendation: `Add requests near observed usage (${w.cpuUse.toFixed(2)} cores, ${(w.ramUse / 2 ** 20).toFixed(0)} MiB) so cost is attributable and the node is not overcommitted.` });
    }

    // Schedule: workload configured to be active only in certain hours but consuming outside them
    const sched = scheduleFor(w);
    const series = hourly?.[`${w.controllerKind}/${w.namespace}/${w.controller}`];
    if (sched && series && series.length) {
      const outside = series.filter((p) => {
        const d = new Date(p.start);
        const inDay = sched.days.includes(d.getUTCDay());
        const h = d.getUTCHours();
        const inHours = sched.startHour <= sched.endHour ? h >= sched.startHour && h < sched.endHour : h >= sched.startHour || h < sched.endHour;
        return !(inDay && inHours);
      });
      const outsideCost = outside.reduce((s, p) => s + p.totalCost, 0);
      const outsideHours = outside.reduce((s, p) => s + p.minutes / 60, 0);
      if (outsideHours > 0 && outsideCost > 0) {
        findings.push({ ...base, rule: 'outside-schedule', severity: 'info',
          title: `${w.controller} runs outside its expected schedule (${sched.label})`,
          evidence: { schedule: sched.label, hoursOutside: outsideHours, hoursObserved: series.reduce((s, p) => s + p.minutes / 60, 0), costOutside: outsideCost },
          estimatedMonthlySavings: (outsideCost / (series.reduce((s, p) => s + p.minutes / 60, 0) || 1)) * H,
          recommendation: 'Scale to zero outside the schedule with a CronJob, KEDA cron scaler or your scheduler of choice.' });
      }
    }
  }

  const order = { critical: 0, serious: 1, warning: 2, info: 3 };
  findings.sort((a, b) => (b.estimatedMonthlySavings - a.estimatedMonthlySavings) || (order[a.severity] - order[b.severity]));
  return findings;
}
