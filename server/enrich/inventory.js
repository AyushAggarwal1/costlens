// Joins billing lines (cloudCost) with the cloud inventory on resource ID.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.INVENTORY_FILE || path.join(here, '..', '..', 'config', 'inventory.json');

export function loadInventory() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  return raw.assets || [];
}

const normId = (id) => String(id || '').trim().toLowerCase();

export function joinInventory(billingLines, assets) {
  const byId = new Map();
  for (const a of assets) byId.set(normId(a.id), a);
  // Also index by short ID (last path segment) so "vol-123" matches an ARN ending in /vol-123
  const byShort = new Map();
  for (const a of assets) {
    const short = normId(a.id).split(/[\/:]/).pop();
    if (short && !byShort.has(short)) byShort.set(short, a);
  }
  const matchedAssets = new Set();
  const lines = billingLines.map((l) => {
    const pid = normId(l.providerID);
    let asset = null;
    let matchType = null;
    if (pid && byId.has(pid)) { asset = byId.get(pid); matchType = 'exact'; }
    else if (pid) {
      const short = pid.split(/[\/:]/).pop();
      if (short && byShort.has(short)) { asset = byShort.get(short); matchType = 'suffix'; }
    }
    if (asset) matchedAssets.add(normId(asset.id));
    return { ...l, inventory: asset ? { id: asset.id, name: asset.name, type: asset.type, owner: asset.owner, environment: asset.environment, region: asset.region, matchType } : null };
  });
  const inventoryOnly = assets.filter((a) => !matchedAssets.has(normId(a.id)));
  const billingWithoutId = lines.filter((l) => !l.providerID);
  const billingUnmatched = lines.filter((l) => l.providerID && !l.inventory);
  return {
    lines,
    coverage: {
      inventoryAssets: assets.length,
      inventoryMatched: matchedAssets.size,
      inventoryOnly,
      billingLines: lines.length,
      billingMatched: lines.filter((l) => l.inventory).length,
      billingUnmatched,
      billingWithoutId: billingWithoutId.length,
      billingUnmatchedCost: billingUnmatched.reduce((s, l) => s + (l.cost || 0), 0),
      billingWithoutIdCost: billingWithoutId.reduce((s, l) => s + (l.cost || 0), 0),
    },
  };
}
