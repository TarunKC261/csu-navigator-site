'use client';

import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import GridView from '@/components/cards/GridView';
import { LAYOUT_MAP } from '@/components/layouts';
import { Suspense, useCallback, useMemo } from 'react';

/**
 * SceneManager — Renders the current scene as the main page content.
 *
 * This is NOT an overlay. The scene IS the page content (minus the chat sidebar).
 * When no scene is active, this renders nothing and the static page content shows.
 * When a scene is set, it replaces the main content area.
 * When the session disconnects, the last scene remains visible.
 * There is no close button — scenes persist until replaced.
 *
 * Layout resolution:
 *   - LAYOUT|layout:<name>  → resolves to a custom layout from LAYOUT_MAP
 *   - LAYOUT|2x3, LAYOUT|1-2-3, etc. → standard GridView grid layouts
 *   - No LAYOUT directive → GridView with auto-layout
 */
export function SceneManager() {
  const currentScene = useVoiceSessionStore((s) => s.currentScene);
  const sceneActive = useVoiceSessionStore((s) => s.sceneActive);
  const navigateSceneBack = useVoiceSessionStore((s) => s.navigateSceneBack);
  const sceneHistory = useVoiceSessionStore((s) => s.sceneHistory);
  const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
  const skeletonLayout = useVoiceSessionStore((s) => s.skeletonLayout);

  const handleAction = useCallback(
    (phrase: string) => {
      tellAgent(phrase);
    },
    [tellAgent],
  );

  // Resolve custom layout: LAYOUT|layout:<name> → LAYOUT_MAP lookup
  const customLayout = useMemo(() => {
    const raw = currentScene?.layout;
    if (!raw) return null;
    // Only match "layout:<name>" prefix (case-insensitive)
    const match = raw.match(/^layout:(.+)$/i);
    if (!match) return null;
    const name = match[1].toLowerCase().trim();
    return LAYOUT_MAP[name] || null;
  }, [currentScene?.layout]);

  // Nothing to show — let static page content through
  if (!sceneActive && !currentScene) return null;
  if (!currentScene && !skeletonLayout) return null;

  const hasHistory = sceneHistory.length > 0;

  return (
    // 2026-09-02: every layout style below was deleted, and this is the fix for
    // the content-under-avatar bleed rather than a tidy-up.
    //
    //   paddingRight: 'min(42vw, 640px)'  a HARDCODED copy of --avatar-w that
    //     never picked up the `min(50vw, 980px)` step globals.css applies above
    //     1025px. Above that width the avatar took up to 980px while content
    //     stepped aside for 640px, so up to 340px of content painted underneath
    //     it. Adjusting browser zoom only appeared to fix it by moving the
    //     viewport to where the two expressions coincide.
    //   maxWidth / isIncidentList        multi-incident lists opted OUT of the
    //     reservation entirely and rendered full-width UNDER the avatar. With
    //     the old desktop overflow lock there was no page scroll either, so the
    //     overflow was simply clipped.
    //   paddingTop / paddingBottom       chrome clearance by calc(). The header,
    //     banner and footer are grid rows now, so this cell already starts and
    //     ends exactly where they do.
    //   id="scene-root"                  moved to the shell's content cell. Both
    //     elements carried it, so the document had duplicate IDs.
    //
    // The cell scrolls (`.shell-content { overflow-y: auto }`), so a long list
    // scrolls instead of being cut off, at any zoom.
    <div
      className="relative flex flex-col w-full h-full min-h-0"
      style={{ color: '#041E42' }}
    >
      {/* Header — badge + optional back button */}
      <header className="scene-pad-x relative z-10 flex items-center justify-between py-3 shrink-0">
        <div className="flex items-center gap-3">
          {hasHistory && (
            <button
              onClick={navigateSceneBack}
              className="flex items-center gap-1 text-sm transition-colors"
              style={{ color: 'rgba(4, 30, 66, 0.6)' }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              Back
            </button>
          )}
        </div>
        {currentScene?.badge && (
          // chk2: the badge ("CREATE FAILED", "TRY THIS FIRST", ...) sat hard
          // against the content-column right edge, right on top of the avatar
          // shoulder that bleeds --avatar-bleed-left px into Col1. Pulling it
          // left by that same bleed (plus a hair) clears her shoulder AND any
          // list scrollbar, so it reads as page text, not text stuck to her.
          <span
            className="text-xs font-medium tracking-wider uppercase font-data"
            style={{
              color: 'rgba(4, 30, 66, 0.5)',
              marginRight: 'calc(var(--avatar-bleed-left, 96px) + 0.25rem)',
            }}
          >
            {currentScene.badge}
          </span>
        )}
      </header>

      {/* Title area */}
      {(currentScene?.title || currentScene?.subtitle) && (
        <div className="scene-pad-x relative z-10 pb-4 shrink-0">
          {currentScene?.title && (
            <h1 className="text-2xl font-bold tracking-tight font-hero" style={{ color: '#041E42' }}>
              {currentScene.title}
            </h1>
          )}
          {currentScene?.subtitle && (
            <p className="text-sm mt-1 font-voice" style={{ color: 'rgba(4, 30, 66, 0.6)' }}>
              {currentScene.subtitle}
            </p>
          )}
        </div>
      )}

      {/* Main content — Custom Layout, GridView, or Skeleton.
          chk2: pb-4 -> pb-0. The error card, the incident list and the KB list
          stopped ~16px short of the bottom while the avatar runs edge to edge,
          so the bottom of Col1 read as a gap instead of blending into her. With
          no bottom pad the card/list is flush with the viewport bottom. */}
      <main className="scene-pad-x relative z-10 flex-1 pb-0 overflow-auto min-h-0">
        {skeletonLayout ? (
          <SceneSkeleton layout={skeletonLayout} />
        ) : customLayout && currentScene ? (
          /* Custom layout: full control over rendering */
          <Suspense
            fallback={
              <div className="animate-pulse h-full bg-white/5 rounded-xl" />
            }
          >
            {(() => {
              const LayoutComponent = customLayout;
              return (
                <LayoutComponent
                  cards={currentScene.cards || []}
                  badge={currentScene.badge}
                  layout={currentScene.layout}
                  maxRows={currentScene.maxRows}
                />
              );
            })()}
          </Suspense>
        ) : currentScene?.cards && currentScene.cards.length > 0 ? (
          /* Standard GridView: grid/mosaic/vertical layouts */
          <Suspense
            fallback={
              <div className="animate-pulse h-full bg-white/5 rounded-xl" />
            }
          >
            <GridView
              badge={currentScene.badge}
              layout={currentScene.layout}
              cards={currentScene.cards}
              maxRows={currentScene.maxRows}
            />
          </Suspense>
        ) : (
          <div className="flex items-center justify-center h-full font-data" style={{ color: 'rgba(4, 30, 66, 0.4)' }}>
            Awaiting data...
          </div>
        )}
      </main>

      {/* Footer */}
      {(currentScene?.footerLeft || currentScene?.footerRight) && (
        <footer className="scene-pad-x relative z-10 flex items-center justify-between py-3 text-xs shrink-0 font-data" style={{ color: 'rgba(4, 30, 66, 0.4)' }}>
          <span>{currentScene.footerLeft || ''}</span>
          <span>{currentScene.footerRight || ''}</span>
        </footer>
      )}
    </div>
  );
}

/** Skeleton loading grid — shows shimmer cards matching the layout */
function SceneSkeleton({ layout }: { layout: string }) {
  const rows = layout.includes('x')
    ? (() => {
        const [cols, rowCount] = layout.split('x').map(Number);
        return Array(rowCount).fill(cols);
      })()
    : layout.split('-').map(Number);

  return (
    <div className="h-full flex flex-col gap-3">
      {rows.map((colCount, rowIdx) => (
        <div
          key={rowIdx}
          className="flex-1 grid gap-3"
          style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}
        >
          {Array(colCount)
            .fill(0)
            .map((_, colIdx) => {
              const delay = `${(rowIdx * colCount + colIdx) * 120}ms`;
              return (
                <div
                  key={colIdx}
                  className="rounded-xl animate-skeleton-bounce skeleton-shimmer-bg"
                  style={{
                    minHeight: rowIdx === 0 ? '60px' : '120px',
                    animationDelay: delay,
                  }}
                >
                  <div className="p-4 space-y-3">
                    <div
                      className="h-3 rounded-full w-1/3"
                      style={{ background: 'rgba(255,255,255,0.12)', animationDelay: delay }}
                    />
                    <div
                      className="h-2 rounded-full w-2/3"
                      style={{ background: 'rgba(255,255,255,0.08)', animationDelay: `calc(${delay} + 80ms)` }}
                    />
                    {rowIdx > 0 && (
                      <>
                        <div
                          className="h-2 rounded-full w-1/2"
                          style={{ background: 'rgba(255,255,255,0.06)', animationDelay: `calc(${delay} + 160ms)` }}
                        />
                        <div
                          className="h-8 rounded-lg w-full mt-2"
                          style={{ background: 'rgba(255,255,255,0.05)', animationDelay: `calc(${delay} + 240ms)` }}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/* Last updated: 2026-09-17 16:23 UTC+8 */
