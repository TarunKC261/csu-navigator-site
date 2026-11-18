'use client';

import { useEffect } from 'react';
import { trackHostedPageView } from '@/lib/analytics/relay';

/** Fires one page-view relay event per full page load. Renders nothing. */
export function AnalyticsRelay() {
  useEffect(() => {
    trackHostedPageView();
  }, []);
  return null;
}
