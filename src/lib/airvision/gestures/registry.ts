// AirVision — gesture recognizer registry.

import type { GestureRecognizer, RecognizerFactory } from './types';

const registry = new Map<string, RecognizerFactory>();

export function registerRecognizer(id: string, factory: RecognizerFactory): void {
  registry.set(id, factory);
}

export function createRecognizer(id: string): GestureRecognizer {
  const factory = registry.get(id);
  if (!factory) {
    throw new Error(
      `AirVision: unknown gesture "${id}". Registered: ${[...registry.keys()].join(', ') || '(none)'}`,
    );
  }
  return factory();
}

export function listRecognizers(): string[] {
  return [...registry.keys()];
}
