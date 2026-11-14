#!/usr/bin/env python3
"""Builds every Crowdpulse brand asset from one definition of the mark.

The bar geometry below was measured from the approved logo image and snapped
to a regular grid, so every asset shares the same proportions.

Needs: fonttools, brotli, pillow (pip) and rsvg-convert (brew install librsvg).
Run:   python design-system/brand/build_brand.py
"""
import subprocess
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

HERE = Path(__file__).resolve().parent
FONT = HERE.parent / "fonts" / "Geist-Variable.woff2"

# Colours: design-system/tokens.json
SURFACE_0 = "#0a0c0f"
SURFACE_2 = "#161a1f"
INK = "#e8edf2"
SIGNAL = "#a9dcf7"
SIGNAL_STRONG = "#d9eefb"

# The mark. Units are pixels of the approved 1254px image.
# Each bar: (top, bottom). Bars are W wide, GAP apart, with fully round ends.
W, GAP = 78, 31
PITCH = W + GAP
TOP = 337  # top of the tallest bar; y is stored relative to it
BARS = [(636, 763), (636, 763), (540, 771), (337, 872), (663, 763), (636, 763), (636, 763)]
TALL = 3  # index of the bright bar
MARK_H = 872 - TOP


def bars_svg(indices, x0, y0, scale):
    """Rects for the chosen bars, top-left of their box at (x0, y0)."""
    out = []
    for n, i in enumerate(indices):
        top, bottom = BARS[i]
        x = x0 + n * PITCH * scale
        y = y0 + (top - TOP) * scale
        w = W * scale
        h = (bottom - top) * scale
        fill = SIGNAL_STRONG if i == TALL else SIGNAL
        out.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{w / 2:.2f}" fill="{fill}"/>')
    return "\n  ".join(out)


def box_w(count):
    return count * W + (count - 1) * GAP


def svg(width, height, body, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">\n'
            f'{defs}  {body}\n</svg>\n')


def centred_mark(size, indices, fill_ratio):
    scale = size * fill_ratio / box_w(len(indices))
    x0 = (size - box_w(len(indices)) * scale) / 2
    y0 = (size - MARK_H * scale) / 2
    return bars_svg(indices, x0, y0, scale)


def wordmark_path(text, size, x0, baseline, tracking=-0.02):
    """Outlines of `text` in Geist SemiBold. Returns (path d, advance width)."""
    font = instantiateVariableFont(TTFont(FONT), {"wght": 600})
    glyphs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
    s = size / upm
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}")
    x = x0
    for ch in text:
        name = cmap[ord(ch)]
        glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, baseline)))
        x += glyphs[name].width * s + tracking * size
    return pen.getCommands(), x - tracking * size - x0


def write(name, content):
    (HERE / name).write_text(content)
    return HERE / name


def png(svg_path, out_name, size_w, size_h=None):
    out = HERE / out_name
    cmd = ["rsvg-convert", "-w", str(size_w)]
    if size_h:
        cmd += ["-h", str(size_h)]
    subprocess.run(cmd + [str(svg_path), "-o", str(out)], check=True)
    return out


def main():
    all7 = list(range(7))
    five = [1, 2, 3, 4, 5]

    # 1. The mark: transparent, and on graphite.
    mark = write("mark.svg", svg(1024, 1024, centred_mark(1024, all7, 0.72)))
    mark_bg = write("mark-on-graphite.svg", svg(
        1024, 1024, f'<rect width="1024" height="1024" fill="{SURFACE_0}"/>\n  ' + centred_mark(1024, all7, 0.58)))
    png(mark, "mark-1024.png", 1024)
    png(mark_bg, "mark-on-graphite-2048.png", 2048)

    # 2. iOS app icon: five bars, full-bleed square, opaque.
    defs = (f'  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{SURFACE_2}"/><stop offset="1" stop-color="{SURFACE_0}"/>'
            f'</linearGradient></defs>\n')
    icon = write("app-icon.svg", svg(
        1024, 1024, '<rect width="1024" height="1024" fill="url(#g)"/>\n  ' + centred_mark(1024, five, 0.56), defs))
    icon_png = png(icon, "app-icon-1024.png", 1024)
    Image.open(icon_png).convert("RGB").save(icon_png)  # no alpha channel
    Image.open(icon_png).resize((180, 180), Image.LANCZOS).save(HERE / "apple-touch-icon.png")

    # 3. Favicon: three bars (medium, tall, dot) on a pixel grid.
    def favicon(grid, w, gap, x0, top, bottom, radius):
        tall_h = bottom - top
        k = tall_h / MARK_H
        mid_top = top + (BARS[2][0] - TOP) * k
        dot_bottom = bottom - (872 - BARS[4][1]) * k
        rows = [(mid_top, bottom - (872 - BARS[2][1]) * k, SIGNAL),
                (top, bottom, SIGNAL_STRONG),
                (dot_bottom - w, dot_bottom, SIGNAL)]
        rects = "\n  ".join(
            f'<rect x="{x0 + n * (w + gap)}" y="{t:.2f}" width="{w}" height="{b - t:.2f}" rx="{w / 2}" fill="{c}"/>'
            for n, (t, b, c) in enumerate(rows))
        return svg(grid, grid, f'<rect width="{grid}" height="{grid}" rx="{radius}" fill="{SURFACE_0}"/>\n  ' + rects)

    fav = write("favicon.svg", favicon(32, 6, 4, 3, 4, 28, 7))
    fav16 = write("favicon-16.svg", favicon(16, 3, 2, 2, 2, 14, 3))
    p16 = png(fav16, "favicon-16.png", 16)
    p32 = png(fav, "favicon-32.png", 32)
    p48 = png(fav, "favicon-48.png", 48)
    png(fav, "favicon-512.png", 512)
    Image.open(p48).save(HERE / "favicon.ico", format="ICO",
                         append_images=[Image.open(p32), Image.open(p16)], sizes=[(48, 48), (32, 32), (16, 16)])

    # 4. Wordmark and the horizontal lockup (mark + wordmark).
    size = 200  # font size; cap height is 0.71 of it
    cap = 0.71 * size
    pad = 24
    d, text_w = wordmark_path("Crowdpulse", size, pad, pad + cap)
    descender = 0.24 * size
    word_h = pad * 2 + cap + descender
    write("wordmark.svg", svg(round(text_w + pad * 2), round(word_h), f'<path d="{d}" fill="{INK}"/>'))

    mark_h = cap * 1.7
    scale = mark_h / MARK_H
    mark_w = box_w(7) * scale
    gap = 0.3 * size
    height = mark_h + pad * 2
    baseline = pad + (mark_h + cap) / 2  # cap height centred on the mark
    d, text_w = wordmark_path("Crowdpulse", size, pad + mark_w + gap, baseline)
    width = pad + mark_w + gap + text_w + pad
    body = bars_svg(all7, pad, pad, scale) + f'\n  <path d="{d}" fill="{INK}"/>'
    lockup = write("lockup.svg", svg(round(width), round(height), body))
    write("lockup-on-graphite.svg", svg(
        round(width), round(height),
        f'<rect width="{round(width)}" height="{round(height)}" fill="{SURFACE_0}"/>\n  ' + body))
    png(lockup, "lockup-2400.png", 2400)
    png(HERE / "lockup-on-graphite.svg", "lockup-on-graphite-2400.png", 2400)


if __name__ == "__main__":
    main()
