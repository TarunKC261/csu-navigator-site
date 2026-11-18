// AirVision — resolve the site's AirVision availability + config.
//
// Availability + config come purely from the widget-session `defaults.airVision`
// payload (per-site, DB-backed, flips instantly with no rebuild), applied via the
// store's setAirVisionAvailability(). This module just supplies the pre-runtime
// default config and the merge helper.

import { resolveConfig, type AirVisionConfig } from './config';

export interface AirVisionAvailability {
  enabled: boolean;
  config: AirVisionConfig;
}

/** Shape delivered over the wire in widget-session `defaults.airVision`. */
export interface AirVisionDefaultsPayload {
  enabled?: boolean;
  engine?: string;
  renderer?: string;
  hand?: 'left' | 'right' | 'any';
  sensitivity?: number;
  mirror?: boolean;
  themeColor?: string;
}

/**
 * Config used before the runtime payload arrives. themeColor defaults to the
 * site's widget color when one is set (the runtime payload later overrides it
 * with the resolved per-site value).
 */
export function initialAirVisionConfig(): AirVisionConfig {
  const themeColor = process.env.NEXT_PUBLIC_WIDGET_COLOR || undefined;
  return resolveConfig({ themeColor });
}

/** Merge a runtime `defaults.airVision` payload over a base config. */
export function mergeDefaults(
  base: AirVisionConfig,
  payload: AirVisionDefaultsPayload | null | undefined,
): AirVisionAvailability {
  if (!payload) return { enabled: false, config: base };
  const config = resolveConfig({
    ...base,
    engine: payload.engine ?? base.engine,
    renderer: payload.renderer ?? base.renderer,
    hand: payload.hand ?? base.hand,
    sensitivity: payload.sensitivity ?? base.sensitivity,
    mirror: payload.mirror ?? base.mirror,
    themeColor: payload.themeColor ?? base.themeColor,
  });
  return { enabled: Boolean(payload.enabled), config };
}
