"""Turn the Waves mark's numbers into the things that consume them.

`apps/mobile/assets/brand/wave-mark.json` holds the mark as geometry: the
points, the stroke, the dot, the lean. This reads it and writes back a
`derived` block — the scale and offsets that centre and lean the mark, the
length of the stroke, and a polyline along it — which `WaveMark` needs to
draw the stroke on and to ride a swell along it. Edit the geometry, re-run
this, and the component follows.

It also renders the mark as a PNG. Nothing in the app draws that file any
more: the splash animates the mark instead, so `app.json` gives
expo-splash-screen a colour and no image. The raster is kept because it is
the canonical picture of the mark for anywhere outside the app that needs
one, and because it is how the geometry is checked by eye.

    python infra/art/render-splash-mark.py

Writes apps/mobile/assets/images/splash-mark-ink.png and the `derived`
block of wave-mark.json.
"""

import json
import pathlib

from PIL import Image, ImageChops, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]
GEOM = ROOT / "apps/mobile/assets/brand/wave-mark.json"
OUT = ROOT / "apps/mobile/assets/images/splash-mark-ink.png"

# The mark's colour: white, which is what reads on the splash purple
# (`SPLASH_BG` in AnimatedSplash.tsx). The PNG's own background is transparent,
# so the raster has to be looked at on something dark to be seen at all.
INK = (0xFF, 0xFF, 0xFF, 255)
# Drawn this many times over and downsampled, so the round caps and the tilt
# come out smooth without leaning on a vector rasteriser.
SS = 4


def quad(p0, c, p1, t):
    return (
        (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t**2 * p1[0],
        (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t**2 * p1[1],
    )


def sample(points, steps=400):
    out = []
    for i in range(0, len(points) - 2, 2):
        p0, c, p1 = points[i], points[i + 1], points[i + 2]
        for k in range(steps + 1):
            out.append(quad(p0, c, p1, k / steps))
    return out


def main():
    g = json.loads(GEOM.read_text(encoding="utf-8"))
    pts = sample(g["points"])
    r = g["strokeWidth"] / 2
    dot = g["dot"]
    size = g["canvas"]

    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0 = min(min(xs) - r, dot["cx"] - dot["r"])
    x1 = max(max(xs) + r, dot["cx"] + dot["r"])
    y0 = min(min(ys) - r, dot["cy"] - dot["r"])
    y1 = max(max(ys) + r, dot["cy"] + dot["r"])

    # Scale so the ink measures `inkWidth` on the canvas, and centre it there.
    s = g["inkWidth"] / (x1 - x0)
    tx = (size - (x1 - x0) * s) / 2 - x0 * s
    ty = (size - (y1 - y0) * s) / 2 - y0 * s

    im = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def place(p):
        return ((p[0] * s + tx) * SS, (p[1] * s + ty) * SS)

    # A round-capped, round-joined stroke is exactly a disc swept along the
    # curve, so stamping discs reproduces it without a stroker.
    rr = r * s * SS
    for p in pts:
        cx, cy = place(p)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=INK)

    dr = dot["r"] * s * SS
    dx, dy = place((dot["cx"], dot["cy"]))
    d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=INK)

    # The mark leans; the tilt is baked here because the native half cannot
    # run a transform. Figma's rotation field is positive counter-clockwise
    # and so is PIL's.
    im = im.rotate(g["tiltDeg"], resample=Image.BICUBIC, expand=False)

    # Turning a glyph that is not symmetric about the canvas centre walks its
    # bounds off it; put them back so the mark stays optically centred.
    b = im.getchannel("A").getbbox()
    offx = round(size * SS / 2 - (b[0] + b[2]) / 2)
    offy = round(size * SS / 2 - (b[1] + b[3]) / 2)
    im = ImageChops.offset(im, offx, offy)

    im = im.resize((size, size), Image.LANCZOS)
    im.save(OUT)

    # Hand the animated half the exact placement this PNG used, so the
    # <Path> lands on the same pixels the native splash ends on.
    # The animated half needs two more things the still one does not: how long
    # the stroke is, so it can be drawn on with a dash offset, and where it
    # runs, so a swell can ride along it.
    poly = sample(g["points"], steps=32)
    length = sum(
        ((poly[i + 1][0] - poly[i][0]) ** 2 + (poly[i + 1][1] - poly[i][1]) ** 2) ** 0.5
        for i in range(len(poly) - 1)
    )
    g["derived"] = {
        "_": "Written by render-splash-mark.py. Do not hand-edit.",
        "scale": round(s, 6),
        "translate": [round(tx, 4), round(ty, 4)],
        "recentre": [round(offx / SS, 4), round(offy / SS, 4)],
        "pathLength": round(length, 4),
        "polyline": [[round(x, 3), round(y, 3)] for x, y in poly],
    }
    GEOM.write_text(json.dumps(g, indent=2) + "\n", encoding="utf-8")

    b = im.getchannel("A").getbbox()
    print(f"wrote {OUT.relative_to(ROOT)}  ink {b[2]-b[0]}x{b[3]-b[1]} at {b}")


if __name__ == "__main__":
    main()
