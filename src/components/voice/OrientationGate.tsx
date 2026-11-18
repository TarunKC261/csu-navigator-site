'use client';

/**
 * OrientationGate, the full-screen "rotate to landscape" overlay.
 *
 * Rotation cannot be forced from a web page, so blocking with an instruction is
 * the only option. This replaces the old desktop-only posture: a landscape
 * phone or tablet now gets the real UI, scaled down by the responsive shell,
 * rather than a dead end.
 *
 * All the gating is CSS (`.rotate-gate` in globals.css), keyed on
 * `(orientation: portrait) and (pointer: coarse)`. Two reasons it is not a JS
 * hook:
 *
 *   1. No hydration flash. A `useState(false)` + `useEffect` hook paints one
 *      frame of the wrong answer on every load, which on a phone means the
 *      whole app renders and then vanishes.
 *   2. `pointer: coarse` keeps it off desktop. Orientation alone matches a
 *      desktop browser in a tall narrow window, and telling someone with a
 *      mouse to rotate their laptop is worse than showing them a squeezed
 *      layout.
 *
 * The sibling combinator in globals.css (`.rotate-gate ~ .app-shell`) hides the
 * shell while the gate is up, so this must stay the FIRST child of the body
 * wrapper, immediately before the shell.
 */
export function OrientationGate() {
    return (
        <div className="rotate-gate" role="alertdialog" aria-label="Rotate your device">
            <svg
                width="56"
                height="56"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#C91235"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <path d="M12 18h.01" />
                <path d="M20.5 9.5a8 8 0 0 1 0 5" />
                <path d="M3.5 9.5a8 8 0 0 0 0 5" />
            </svg>
            <p className="font-hero text-lg font-bold" style={{ color: '#1A1A1A' }}>
                Please rotate your device
            </p>
            <p className="font-data text-sm" style={{ color: '#5A5A5A' }}>
                CSU Navigator needs landscape orientation.
            </p>
        </div>
    );
}

/* Last updated: 2026-09-02 03:55 UTC+8 */
