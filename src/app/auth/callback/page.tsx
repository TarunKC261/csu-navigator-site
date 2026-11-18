'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth-store';

/**
 * /auth/callback — Microsoft Entra ID redirects here after a Unisys Azure login
 * with `?code=&state=` (entra-client sets redirectUri = origin + /auth/callback).
 *
 * Aped from the starter (0.7.0 Phase 3). AuthGuard exempts this path so its
 * redirect-to-picker check does NOT race this page's own completion. Static
 * exported like every other route; the OIDC code exchange runs client-side only
 * (@azure/msal-browser, navigateToLoginRequestUrl:false, so MSAL finishes here).
 *
 * Reached only in a Unisys/Henkel Azure flow. An AWS US (Auth0) login never
 * lands here, Auth0 handles its own redirect at '/'.
 */
export default function AuthCallbackPage() {
  const completeCallback = useAuthStore((s) => s.completeCallback);
  const login = useAuthStore((s) => s.login);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    completeCallback()
      .then((returnTo) => {
        router.replace(returnTo || '/');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Sign-in failed.');
      });
  }, [completeCallback, router]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-voice text-sm text-[#1A1A1A]">Sign-in failed: {error}</p>
        <button
          type="button"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            login('/');
          }}
          className="rounded-md border border-[#E5E7EB] bg-[#F5F7FA] px-4 py-2 font-voice text-sm font-medium text-[#1A1A1A] transition hover:bg-white disabled:opacity-50"
        >
          {retrying ? 'Redirecting…' : 'Try again'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="font-voice text-sm text-[#5A5A5A]">Signing you in…</p>
    </div>
  );
}
