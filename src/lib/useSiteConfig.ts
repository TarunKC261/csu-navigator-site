'use client';

import { useSyncExternalStore } from 'react';
import { getSiteConfig, onSiteConfig, type SiteConfig } from '@/lib/siteConfig';

/** Re-render when the dashboard's names or the owner's Studio document arrive (or change). */
export function useSiteConfig(): SiteConfig {
  return useSyncExternalStore(
    (fn) => onSiteConfig(() => fn()),
    getSiteConfig,
    getSiteConfig,
  );
}
