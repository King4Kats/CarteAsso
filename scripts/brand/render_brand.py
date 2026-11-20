"""
Rend les SVG de marque en PNG/ICO (Chromium headless via Playwright).

Usage : python scripts/brand/render_brand.py <dossier_svg> <dossier_public>
  -> logo.png (x2), og-image.png, favicon.ico (16/32/48), favicon.svg,
     apple-touch-icon.png (180), icon-192.png, icon-512.png, badge.svg/.png
"""
import io
import os
import shutil
import sys

from PIL import Image
from playwright.sync_api import sync_playwright


def render(page, svg_path, width, height, transparent=True):
    with open(svg_path, encoding="utf-8") as f:
        svg = f.read()
    html = (f'<html><body style="margin:0;background:transparent">'
            f'<div style="width:{width}px;height:{height}px">'
            f'{svg.replace("<svg ", f"<svg style=\"width:{width}px;height:{height}px;display:block\" ", 1)}'
            f'</div></body></html>')
    page.set_viewport_size({"width": width, "height": height})
    page.set_content(html)
    png = page.screenshot(omit_background=transparent, clip={"x": 0, "y": 0, "width": width, "height": height})
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main():
    src, pub = sys.argv[1], sys.argv[2]
    os.makedirs(pub, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(device_scale_factor=1)

        # Logo : on garde le ratio du SVG, rendu en x2 pour les écrans retina
        import re
        with open(os.path.join(src, "logo.svg"), encoding="utf-8") as f:
            vb = re.search(r'viewBox="0 0 (\d+) (\d+)"', f.read())
        lw, lh = int(vb.group(1)), int(vb.group(2))
        render(page, os.path.join(src, "logo.svg"), lw * 2, lh * 2).save(os.path.join(pub, "logo.png"), optimize=True)

        render(page, os.path.join(src, "og-image.svg"), 1200, 630, transparent=False) \
            .convert("RGB").save(os.path.join(pub, "og-image.png"), optimize=True)

        icon_t = render(page, os.path.join(src, "icon.svg"), 256, 256)
        icon_t.save(os.path.join(pub, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
        for size, name in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
            render(page, os.path.join(src, "icon-bg.svg"), size, size, transparent=False) \
                .convert("RGB").save(os.path.join(pub, name), optimize=True)

        with open(os.path.join(src, "badge.svg"), encoding="utf-8") as f:
            bv = re.search(r'viewBox="0 0 (\d+) (\d+)"', f.read())
        badge_size = (int(bv.group(1)) * 2, int(bv.group(2)) * 2)
        render(page, os.path.join(src, "badge.svg"), *badge_size).save(os.path.join(pub, "badge.png"), optimize=True)
        b.close()

    shutil.copy(os.path.join(src, "icon.svg"), os.path.join(pub, "favicon.svg"))
    shutil.copy(os.path.join(src, "logo.svg"), os.path.join(pub, "logo.svg"))
    shutil.copy(os.path.join(src, "badge.svg"), os.path.join(pub, "badge.svg"))
    print("rendu terminé dans", pub)


if __name__ == "__main__":
    main()
