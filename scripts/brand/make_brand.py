"""
Génère les fichiers de marque CarteAsso (SVG autonomes, texte vectorisé).

Style volontairement IDENTIQUE à l'ancien logo GemensKarte : typo grasse
(Arial/Liberation Sans Bold), « Carte » couleur encre, « Asso » magenta,
confettis autour. Le texte est converti en tracés (pas de police à charger).

Usage : SITE_HOST=gemenskarte.fr python scripts/brand/make_brand.py <dossier_sortie>
  (SITE_HOST = domaine écrit sur l'image de partage ; carteasso.fr après la bascule)
  -> logo.svg, logo-white.svg, icon.svg, og-image.svg, badge.svg
Les PNG/ICO sont produits ensuite par render_brand.py (navigateur headless).
"""
import os
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

INK = "#2e3034"
MAGENTA = "#e11567"
VIOLET = "#9d77b3"
BLUE = "#4f6cb3"
GREEN = "#57ba95"
YELLOW = "#fcc22d"
CORAL = "#ee785d"
SITE_HOST = os.environ.get("SITE_HOST", "gemenskarte.fr")

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def load_font():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return TTFont(p)
    sys.exit("Police grasse introuvable (Arial Bold / Liberation Sans Bold)")


FONT = load_font()
GLYPHS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UPM = FONT["head"].unitsPerEm
KERN_TRACK = -0.035  # resserre légèrement, comme l'ancien wordmark


def text_path(text, x, baseline, size):
    """Retourne (d, largeur) : le tracé SVG du texte, origine à gauche sur la ligne de base."""
    scale = size / UPM
    pen = SVGPathPen(GLYPHS)
    cursor = 0.0
    for ch in text:
        name = CMAP[ord(ch)]
        g = GLYPHS[name]
        # y inversé : les polices ont l'axe Y vers le haut, le SVG vers le bas
        tp = TransformPen(pen, (scale, 0, 0, -scale, x + cursor, baseline))
        g.draw(tp)
        cursor += g.width * scale + KERN_TRACK * size
    return pen.getCommands(), cursor - KERN_TRACK * size


def wordmark(x, baseline, size, ink=INK, accent=MAGENTA):
    d1, w1 = text_path("Carte", x, baseline, size)
    d2, w2 = text_path("Asso", x + w1 + KERN_TRACK * size, baseline, size)
    svg = f'<path d="{d1}" fill="{ink}"/><path d="{d2}" fill="{accent}"/>'
    return svg, w1 + KERN_TRACK * size + w2


def confetti_left(ox, oy, s=1.0):
    """Le petit nuage de confettis à gauche du nom (repris de l'ancien logo)."""
    def c(x, y, r, fill):
        return f'<circle cx="{ox + x * s:.1f}" cy="{oy + y * s:.1f}" r="{r * s:.1f}" fill="{fill}"/>'

    def ring(x, y, r, stroke, w=2.2):
        return (f'<circle cx="{ox + x * s:.1f}" cy="{oy + y * s:.1f}" r="{r * s:.1f}" fill="none" '
                f'stroke="{stroke}" stroke-width="{w * s:.1f}"/>')

    def line(x1, y1, x2, y2, stroke, w=2.6):
        return (f'<line x1="{ox + x1 * s:.1f}" y1="{oy + y1 * s:.1f}" x2="{ox + x2 * s:.1f}" '
                f'y2="{oy + y2 * s:.1f}" stroke="{stroke}" stroke-width="{w * s:.1f}" stroke-linecap="round"/>')

    return "".join([
        line(33, 12, 42, 24, VIOLET, 3.2),
        ring(72, 8, 7, CORAL, 1.6),
        c(12, 32, 4, VIOLET),
        c(44, 47, 6, VIOLET),
        c(30, 43, 6, GREEN),
        line(18, 66, 30, 62, GREEN, 1.4),
        c(4, 73, 3.4, YELLOW),
        ring(12, 90, 8, MAGENTA, 2.4),
        c(20, 112, 3.4, CORAL),
    ])


def logo_svg(ink=INK):
    """Logo horizontal, même proportions que l'ancien (≈ 466×122)."""
    size = 74
    x0, base = 70, 86
    wm, w = wordmark(x0, base, size, ink=ink)
    W = int(x0 + w + 16)
    H = 122
    # Confettis posés comme sur l'ancien : jaune derrière la 1re lettre, magenta au-dessus,
    # vert entre les deux mots, bleu en bas à droite du dernier « o ».
    split = x0 + text_path("Carte", 0, 0, size)[1]
    parts = [
        f'<circle cx="{x0 + 6}" cy="{base - 4}" r="8.5" fill="{YELLOW}"/>',
        f'<circle cx="{x0 + 62}" cy="20" r="9" fill="{MAGENTA}"/>',
        f'<circle cx="{split - 4}" cy="44" r="9.5" fill="{GREEN}"/>',
        confetti_left(0, 4, 0.95),
        wm,
        f'<circle cx="{x0 + w - 8}" cy="{base + 4}" r="9.5" fill="{BLUE}"/>',
    ]
    return W, H, (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
                  f'role="img" aria-label="CarteAsso">{"".join(parts)}</svg>')


def icon_svg(bg=None):
    """Icône carrée : le « C » avec ses confettis (comme l'ancien favicon « G »)."""
    d, w = text_path("C", 0, 0, 100)
    # Centre le C dans un carré de 128
    x = (128 - w) / 2
    d, _ = text_path("C", x, 100, 100)
    back = f'<rect width="128" height="128" rx="28" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
            f'{back}'
            f'<circle cx="34" cy="20" r="13" fill="none" stroke="{MAGENTA}" stroke-width="5"/>'
            f'<path d="{d}" fill="{INK}"/>'
            f'<circle cx="108" cy="84" r="9" fill="{VIOLET}"/>'
            f'<circle cx="16" cy="92" r="6" fill="{GREEN}"/>'
            f'<circle cx="96" cy="24" r="6" fill="{YELLOW}"/>'
            f'<circle cx="62" cy="118" r="5" fill="{CORAL}"/>'
            f'</svg>')


def og_svg():
    """Image de partage 1200×630 (Facebook, X, LinkedIn, WhatsApp, Discord…)."""
    W, H = 1200, 630
    lw, lh, logo = logo_svg()
    inner = logo.split(">", 1)[1].rsplit("</svg>", 1)[0]
    scale = 1.55
    tx = (W - lw * scale) / 2
    ty = 175
    tag_d, tag_w = text_path("Toutes les associations de France, sur une carte.", 0, 0, 40)
    tag_d, _ = text_path("Toutes les associations de France, sur une carte.", (W - tag_w) / 2, 430, 40)
    url_d, url_w = text_path(SITE_HOST, 0, 0, 34)
    url_d, _ = text_path(SITE_HOST, (W - url_w) / 2, 520, 34)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
            f'<rect width="{W}" height="{H}" fill="#ffffff"/>'
            f'<g transform="translate({tx:.1f} {ty}) scale({scale})">{inner}</g>'
            f'<path d="{tag_d}" fill="{INK}" opacity=".78"/>'
            f'<path d="{url_d}" fill="{MAGENTA}"/>'
            f'</svg>')


def badge_svg():
    """Badge « Référencé sur CarteAsso » que les assos posent sur leur site (lien retour)."""
    lw, lh, logo = logo_svg()
    inner = logo.split(">", 1)[1].rsplit("</svg>", 1)[0]
    s = 0.40
    W, H = int(lw * s + 22), 76
    top_d, _ = text_path("Référencée sur", 14, 22, 13)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
            f'role="img" aria-label="Association référencée sur CarteAsso">'
            f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="12" fill="#fff" stroke="#e6e6e6"/>'
            f'<path d="{top_d}" fill="#6b6b75"/>'
            f'<g transform="translate(10 24) scale({s})">{inner}</g>'
            f'</svg>')


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    files = {
        "logo.svg": logo_svg()[2],
        "logo-white.svg": logo_svg(ink="#ffffff")[2],
        "icon.svg": icon_svg(),
        "icon-bg.svg": icon_svg(bg="#ffffff"),
        "og-image.svg": og_svg(),
        "badge.svg": badge_svg(),
    }
    for name, svg in files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            f.write(svg)
        print("écrit", name)


if __name__ == "__main__":
    main()
