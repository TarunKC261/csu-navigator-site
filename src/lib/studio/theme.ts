import { rawValue, type SiteDocument } from './siteDocument';

/**
 * Apply the owner's theme on top of the template's.
 *
 * The template's look is one accent (the cyan of its buttons and headline
 * word) on one near-black background, plus a hover tint, a glow and a button
 * ink derived from the accent (app/globals.css). The Studio edits the two
 * bases and the typeface; this derives the rest the same way the stylesheet's
 * literals were derived, and writes them as overrides in one <style> element.
 * Nothing set means nothing written — the stylesheet stands.
 */

const STYLE_ID = 'site-theme';
const FONT_LINK_ID = 'site-theme-font';

const sans = (name: string) => `'${name}', ui-sans-serif, system-ui, -apple-system, sans-serif`;
const serif = (name: string) => `'${name}', ui-serif, Georgia, serif`;

/**
 * `outfit` is the template's own pairing (Outfit headlines, Instrument Sans
 * text), already loaded by the layout: choosing it writes nothing. Every other
 * choice sets one typeface for both.
 */
const FONTS: Record<string, { query: string; stack: string } | null> = {
  outfit: null,
  manrope: { query: 'Manrope:wght@400;500;600;700;800', stack: sans('Manrope') },
  inter: { query: 'Inter:wght@400;500;600;700;800', stack: sans('Inter') },
  'dm-sans': { query: 'DM+Sans:wght@400;500;600;700;800', stack: sans('DM Sans') },
  'space-grotesk': { query: 'Space+Grotesk:wght@400;500;600;700', stack: sans('Space Grotesk') },
  poppins: { query: 'Poppins:wght@400;500;600;700;800', stack: sans('Poppins') },
  lora: { query: 'Lora:wght@400;500;600;700', stack: serif('Lora') },
  playfair: { query: 'Playfair+Display:wght@400;500;600;700;800', stack: serif('Playfair Display') },
};

type Rgb = [number, number, number];

function rgbOf(hex: unknown): Rgb | null {
  if (typeof hex !== 'string') return null;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** Mix toward white: `amount` 0 is the colour, 1 is white. */
function tint([r, g, b]: Rgb, amount: number): string {
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

const solid = (c: Rgb) => `rgb(${c.join(' ')})`;

/**
 * Button text on the accent: the template's near-black on a light accent,
 * white on a dark one — an owner who picks navy must still be able to read
 * "Start conversation".
 */
function inkOn([r, g, b]: Rgb): string {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.25 ? 'rgb(10 14 20)' : 'rgb(255 255 255)';
}

function fontOf(doc: SiteDocument | null) {
  return FONTS[String(rawValue(doc, 'theme.font') ?? '')] ?? null;
}

/** The override stylesheet for a theme. Exported for tests. */
export function themeCss(doc: SiteDocument | null): string {
  const accent = rgbOf(rawValue(doc, 'theme.accent'));
  const background = rgbOf(rawValue(doc, 'theme.background'));
  const font = fontOf(doc);

  const root: string[] = [];
  if (accent) {
    root.push(
      `--amber:${solid(accent)}`,
      `--accent-hover:${tint(accent, 0.2)}`,
      `--accent-rgb:${accent.join(' ')}`,
      `--accent-ink:${inkOn(accent)}`,
    );
  }
  if (background) {
    root.push(`--color-midnight:${solid(background)}`);
  }
  if (font) {
    root.push(`--font-voice:${font.stack}`, `--font-hero:${font.stack}`);
  }

  const out: string[] = [];
  if (root.length) out.push(`html:root{${root.join(';')}}`);
  if (font) out.push(`html .font-voice,html .font-hero{font-family:${font.stack}}`);
  return out.join('\n');
}

export function applyTheme(doc: SiteDocument | null): void {
  if (typeof document === 'undefined') return;

  const css = themeCss(doc);
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    style?.remove();
  } else {
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }
    if (style.textContent !== css) style.textContent = css;
    // Last in <head>, so it wins over the template's stylesheet at equal weight.
    if (document.head.lastElementChild !== style) document.head.appendChild(style);
  }

  const font = fontOf(doc);
  const href = font?.query ? `https://fonts.googleapis.com/css2?family=${font.query}&display=swap` : '';
  let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (!href) {
    link?.remove();
  } else {
    if (!link) {
      link = document.createElement('link');
      link.id = FONT_LINK_ID;
      link.rel = 'stylesheet';
      document.head.insertBefore(link, document.head.firstChild);
    }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
}
