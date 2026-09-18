import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CATEGORIES_CONFIG || path.join(here, '..', '..', 'config', 'categories.json');

let config = null;
export function loadCategories() {
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  config._compiled = (config.services || []).map((s) => ({ ...s, _re: new RegExp(s.match, 'i') }));
  return config;
}
export function categoriesConfig() { return config || loadCategories(); }

export function categoryForService(service, providerCategory) {
  const cfg = categoriesConfig();
  for (const s of cfg._compiled) if (s._re.test(service || '')) return { category: s.category, source: 'mapping' };
  // Fall back to the provider's own category when it is one of ours
  const pc = providerCategory && cfg.categories.find((c) => c.toLowerCase() === String(providerCategory).toLowerCase());
  if (pc) return { category: pc, source: 'provider' };
  if (providerCategory === 'Network') return { category: 'Networking', source: 'provider' };
  return { category: 'Other', source: 'unmapped' };
}

export function categoryForAssetType(type) {
  const cfg = categoriesConfig();
  return cfg.kubernetesAssetTypes?.[type] || 'Other';
}
