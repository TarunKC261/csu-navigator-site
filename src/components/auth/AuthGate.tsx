'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth-store';
import { SSOLoginPage } from './SSOLoginPage';

const CALLBACK_PATH = '/auth/callback';

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * AuthGate — blocks all app content until the Entra ID (Unisys) sign-in
 * completes.
 *
 * An unauthenticated visitor sees the branded SSOLoginPage; the redirect to
 * Microsoft fires only on that page's button, never automatically. The
 * callback route is exempt: it completes its own sign-in, and gating it here
 * would race /auth/callback's exchange with a second redirect.
 *
 * init() runs once, while status is still the store's initial 'loading'
 * (AuthGate never unmounts, so re-running it after the callback resolved could
 * clobber 'authenticated' and start a login loop).
 */
export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const login = useAuthStore((s) => s.login);
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword);
  const error = useAuthStore((s) => s.error);
  const isCallbackRoute = pathname === CALLBACK_PATH;

  useEffect(() => {
    if (!isCallbackRoute && status === 'loading') init();
  }, [init, isCallbackRoute, status]);

  if (isCallbackRoute) return <>{children}</>;

  if (status === 'unauthenticated') {
    return (
      <SSOLoginPage
        error={error}
        onSignIn={() => login(window.location.pathname + window.location.search)}
        onPasswordSignIn={loginWithPassword}
      />
    );
  }

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white">
        <span className="text-sm uppercase tracking-widest text-neutral-500">Authenticating...</span>
      </div>
    );
  }

  return <>{children}</>;
}
