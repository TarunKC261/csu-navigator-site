'use client';

import { useState } from 'react';
import { Lock } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BrandMark } from '@/components/brand/BrandMark';
import { passwordLoginEnabled } from '@/lib/auth/password-login';

interface SSOLoginPageProps {
  onSignIn: () => void;
  onPasswordSignIn: (username: string, password: string) => Promise<void>;
  error?: string | null;
}

/**
 * Branded sign-in screen, shown instead of an instant, invisible redirect to
 * Microsoft: something to look at and a deliberate action to take before the
 * browser leaves for the Entra ID (Unisys) sign-in page. Same two-panel layout
 * as the Henkel DX Tele, in CSU colours. Below the SSO button, a username +
 * password form for people without Unisys SSO (when config.js enables it).
 */
export function SSOLoginPage({ onSignIn, onPasswordSignIn, error }: SSOLoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const showPassword = passwordLoginEnabled();

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await onPasswordSignIn(username, password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Invalid username or password.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <div className="relative flex flex-col justify-between overflow-hidden bg-[var(--henkel-ink)] px-8 py-12 text-white md:w-1/2 md:px-16 md:py-16">
        {/* CSU red band, the one accent on the dark panel */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-1.5 bg-[var(--henkel-red)]" />
        <BrandMark tone="light" withName />

        <div className="my-16 md:my-0">
          <h1 className="text-4xl font-bold leading-tight md:text-5xl">
            Get ready for
            <br />
            your first semester
          </h1>
          <p className="mt-6 max-w-md text-white/70">
            Help with financial aid, orientation and classes for students admitted to CSU.
          </p>
        </div>

        <p className="text-xs text-white/50">CSU demo · sample data</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-[var(--henkel-surface-alt)] px-8 py-16">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-[var(--henkel-ink)]">Sign in</h2>
          <p className="mt-1 text-[var(--henkel-ink-muted)]">Use your campus account.</p>

          <Button
            onClick={onSignIn}
            className="mt-8 h-14 w-full rounded-full bg-[var(--henkel-red)] text-base font-semibold text-white hover:bg-[var(--henkel-red-hover)]"
          >
            <Lock className="size-4" />
            Sign in with Enterprise ID
          </Button>

          {error && <p className="mt-4 text-sm text-[var(--henkel-red)]">{error}</p>}

          {showPassword && (
            <>
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--henkel-ink-muted)]/20" />
                <span className="text-xs uppercase tracking-wide text-[var(--henkel-ink-muted)]">or</span>
                <div className="h-px flex-1 bg-[var(--henkel-ink-muted)]/20" />
              </div>

              <form onSubmit={handlePasswordSubmit} className="space-y-3">
                <div>
                  <label htmlFor="sso-username" className="mb-1 block text-sm font-medium text-[var(--henkel-ink)]">
                    Username
                  </label>
                  <Input
                    id="sso-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="sso-password" className="mb-1 block text-sm font-medium text-[var(--henkel-ink)]">
                    Password
                  </label>
                  <Input
                    id="sso-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {formError && <p className="text-sm text-[var(--henkel-red)]">{formError}</p>}

                <Button
                  type="submit"
                  disabled={submitting}
                  variant="outline"
                  className="h-12 w-full rounded-full text-base font-semibold"
                >
                  {submitting ? 'Signing in...' : 'Sign in with username'}
                </Button>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-sm text-[var(--henkel-ink-muted)]">
            Need access? Contact the Unisys demo team.
          </p>
        </div>
      </div>
    </div>
  );
}
