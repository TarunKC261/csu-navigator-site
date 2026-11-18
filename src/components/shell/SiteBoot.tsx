'use client';

import { useEffect } from 'react';
import { applyDraft, startSiteConfig } from '@/lib/siteConfig';
import { installStudioPreview } from '@/lib/studio/preview';

/** One-time page setup: the site's live identity and its Studio document. */
export function SiteBoot() {
  useEffect(() => {
    startSiteConfig();
    // Does nothing unless the dashboard's Studio opened this page.
    installStudioPreview(applyDraft);
  }, []);

  return null;
}

export default SiteBoot;
