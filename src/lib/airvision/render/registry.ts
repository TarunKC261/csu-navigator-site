// AirVision — overlay renderer registry.

import type { OverlayRenderer, RendererFactory } from './types';

const registry = new Map<string, RendererFactory>();

export function registerRenderer(id: string, factory: RendererFactory): void {
  registry.set(id, factory);
}

export function createRenderer(id: string): OverlayRenderer {
  const factory = registry.get(id);
  if (!factory) {
    throw new Error(
      `AirVision: unknown renderer "${id}". Registered: ${[...registry.keys()].join(', ') || '(none)'}`,
    );
  }
  return factory();
}

export function listRenderers(): string[] {
  return [...registry.keys()];
}
