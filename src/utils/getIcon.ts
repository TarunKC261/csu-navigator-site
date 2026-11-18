import * as Tabler from '@tabler/icons-react';
import { IconRegistry, type IconComponent } from '@/lib/icons';

/**
 * Back-compat: previous code imported `LucideIcon` from this module via
 * `lucide-react`. We keep the same exported type name so consumers
 * (e.g. CalloutCard) need no changes.
 */
export type LucideIcon = IconComponent;

const cache = new Map<string, IconComponent | null>();
const tabler = Tabler as Record<string, unknown>;

function pascal(name: string): string {
  return name
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function tryTabler(key: string): IconComponent | null {
  // Tabler exports are `Icon<Pascal>` — try with and without the prefix.
  const candidates = key.startsWith('Icon') ? [key] : [`Icon${key}`, key];
  for (const c of candidates) {
    if (typeof tabler[c] === 'function') return tabler[c] as IconComponent;
  }
  return null;
}

/**
 * Look up an icon by name. Supports exact match, kebab→PascalCase, and
 * case-insensitive fallback. Searches the curated Lucide-name registry first
 * (so legacy aliases like `CheckCircle2`, `MicOff` keep working), then falls
 * back to the full Tabler set via the `Icon<Pascal>` convention.
 */
export function getIcon(iconName?: string): IconComponent | null {
  if (!iconName) return null;
  if (cache.has(iconName)) return cache.get(iconName)!;

  // 1) Curated Lucide-name registry (exact, then PascalCase).
  if (IconRegistry[iconName]) {
    cache.set(iconName, IconRegistry[iconName]);
    return IconRegistry[iconName];
  }
  const p = pascal(iconName);
  if (IconRegistry[p]) {
    cache.set(iconName, IconRegistry[p]);
    return IconRegistry[p];
  }

  // 2) Direct Tabler lookup (`Icon<Pascal>` or already-prefixed).
  const direct = tryTabler(p);
  if (direct) {
    cache.set(iconName, direct);
    return direct;
  }

  // 3) Case-insensitive fallback over registry then Tabler exports.
  const lower = iconName.toLowerCase();
  for (const key of Object.keys(IconRegistry)) {
    if (key.toLowerCase() === lower) {
      cache.set(iconName, IconRegistry[key]);
      return IconRegistry[key];
    }
  }
  const wantedTablerKey = `icon${lower}`;
  for (const key of Object.keys(tabler)) {
    if (key.toLowerCase() === wantedTablerKey && typeof tabler[key] === 'function') {
      const v = tabler[key] as IconComponent;
      cache.set(iconName, v);
      return v;
    }
  }

  cache.set(iconName, null);
  return null;
}

export function getIconOrFallback(
  iconName?: string,
  fallback: IconComponent = IconRegistry.Zap,
): IconComponent {
  return getIcon(iconName) ?? fallback;
}
