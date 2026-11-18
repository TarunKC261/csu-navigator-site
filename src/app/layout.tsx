import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/voice/AppShell';
import { AuthGate } from '@/components/auth/AuthGate';
import { ConsentGate } from '@/components/privacy/ConsentGate';

// Pinned (not NEXT_PUBLIC_AGENT_NAME from the dashboard) so the tab title and
// link previews always read as the product, whatever the agent is called there.
const agentName = 'CSU Student Engagement Platform';

export const metadata: Metadata = {
  title: agentName,
  description: `${agentName}: your guide from admission to the first day of class at the California State University.`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Runtime config FIRST, before any app code. Sets window.__DX_CONFIG__
            from /public/config.js (editable on the host, no rebuild). Synchronous
            on purpose so the values exist before the bundle runs. See
            src/lib/runtime-config.ts. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/config.js" />
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&family=Playfair+Display:wght@400;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {/* Sign-in first (Unisys Entra SSO), then the consent notice, then the app.
            The consent click happens in the same document that then plays the
            avatar, which is what lets the greeting be heard, and it is the natural
            place to request the microphone. */}
        <AuthGate>
          <ConsentGate>
            <AppShell>{children}</AppShell>
          </ConsentGate>
        </AuthGate>
      </body>
    </html>
  );
}
