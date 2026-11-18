// AirVision — vision engine registry.

import type { EngineFactory, VisionEngine } from './types';

const registry = new Map<string, EngineFactory>();

export function registerEngine(id: string, factory: EngineFactory): void {
  registry.set(id, factory);
}

export function createEngine(id: string): VisionEngine {
  const factory = registry.get(id);
  if (!factory) {
    throw new Error(
      `AirVision: unknown engine "${id}". Registered: ${[...registry.keys()].join(', ') || '(none)'}`,
    );
  }
  return factory();
}

export function hasEngine(id: string): boolean {
  return registry.has(id);
}
