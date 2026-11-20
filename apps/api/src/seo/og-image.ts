/**
 * Images de partage (Open Graph) DYNAMIQUES, 1200×630 PNG.
 *
 * Pourquoi : quand quelqu'un partage la page de sa commune sur WhatsApp, Facebook,
 * X ou LinkedIn, l'aperçu affiche SON chiffre (« 412 associations à Challans »)
 * au lieu d'une image générique. C'est ce qui donne envie de cliquer… et de
 * repartager (levier viral n°1 des pages locales).
 *
 * Rendu : on compose un SVG (logo vectorisé + texte) puis resvg le convertit en
 * PNG, sans navigateur. Police embarquée : Liberation Sans Bold (licence OFL),
 * dans apps/api/assets/fonts. Cache mémoire LRU : une commune n'est rendue qu'une
 * fois par démarrage ; Cloudflare met ensuite le PNG en cache (Cache-Control).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

// dist/seo/og-image.js et src/seo/og-image.ts sont à la même profondeur -> ../../assets
const ASSETS = resolve(__dirname, "../../assets");
const FONT = resolve(ASSETS, "fonts/LiberationSans-Bold.ttf");

// Contenu interne du logo (sans la balise <svg> englobante), lu une seule fois.
const LOGO_SVG = readFileSync(resolve(ASSETS, "logo.svg"), "utf8");
const LOGO_INNER = LOGO_SVG.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const INK = "#2e3034";
const MAGENTA = "#e11567";
const MUTED = "#6b6b75";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Taille de police qui fait tenir `text` sur `maxW` px (approximation largeur moyenne d'un glyphe gras). */
function fit(text: string, max: number, maxW: number): number {
  return Math.max(30, Math.min(max, Math.floor(maxW / (text.length * 0.56))));
}

export interface OgCard {
  big: string;    // le chiffre mis en avant, ex. « 412 »
  line1: string;  // ex. « associations à Challans »
  line2?: string; // ex. « Vendée · Pays de la Loire »
  host: string;   // domaine affiché en bas à droite (SITE_URL)
}

function svg(card: OgCard): string {
  const W = 1200, H = 630;
  const logoScale = 0.9;
  const bigSize = fit(card.big, 190, 1060);
  const l1Size = fit(card.line1, 68, 1060);
  // Petits confettis de rappel dans le coin, couleurs de la marque.
  const confetti = [
    [1110, 70, 16, "#57ba95"], [1150, 140, 9, "#fcc22d"], [1060, 128, 7, "#9d77b3"],
    [1010, 64, 6, "#ee785d"], [1160, 250, 12, "#4f6cb3"],
  ].map(([x, y, r, c]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<rect x="0" y="${H - 14}" width="${W}" height="14" fill="${MAGENTA}"/>
${confetti}
<g transform="translate(44 34) scale(${logoScale})">${LOGO_INNER}</g>
<text x="66" y="${250 + bigSize * 0.62}" font-family="Liberation Sans" font-weight="700" font-size="${bigSize}" fill="${MAGENTA}" letter-spacing="-4">${esc(card.big)}</text>
<text x="70" y="${250 + bigSize * 0.62 + l1Size + 28}" font-family="Liberation Sans" font-weight="700" font-size="${l1Size}" fill="${INK}" letter-spacing="-1">${esc(card.line1)}</text>
${card.line2 ? `<text x="72" y="${H - 52}" font-family="Liberation Sans" font-weight="700" font-size="30" fill="${MUTED}">${esc(card.line2)}</text>` : ""}
<text x="${W - 60}" y="${H - 52}" text-anchor="end" font-family="Liberation Sans" font-weight="700" font-size="30" fill="${MAGENTA}">${esc(card.host)}</text>
</svg>`;
}

// Cache LRU minimal (Map conserve l'ordre d'insertion).
const CACHE = new Map<string, Buffer>();
const CACHE_MAX = 400;

export function renderOg(key: string, card: OgCard): Buffer {
  const hit = CACHE.get(key);
  if (hit) {
    CACHE.delete(key);
    CACHE.set(key, hit);
    return hit;
  }
  const png = new Resvg(svg(card), {
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "Liberation Sans" },
    fitTo: { mode: "original" },
  }).render().asPng();
  CACHE.set(key, png);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  return png;
}

