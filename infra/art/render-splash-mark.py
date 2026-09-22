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

Second, it lays the launcher icons in the brand's colours. Those are cut from
a picture rather than from the geometry above — see `SOURCE` for why — so the
colour is the only thing about them that this changes.

    python infra/art/render-splash-mark.py

Writes the `derived` block of wave-mark.json and, into
apps/mobile/assets/images/: splash-mark-ink.png, icon.png, favicon.png,
android-icon-background.png and android-icon-foreground.png.
android-icon-monochrome.png is read but never written — Android tints that
layer itself, so it holds no brand colour to change.
"""

import json
import pathlib

from PIL import Image, ImageChops, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]
GEOM = ROOT / "apps/mobile/assets/brand/wave-mark.json"
IMAGES = ROOT / "apps/mobile/assets/images"
SPLASH_MARK = IMAGES / "splash-mark-ink.png"
ICON = IMAGES / "icon.png"
FAVICON = IMAGES / "favicon.png"
ANDROID_BG = IMAGES / "android-icon-background.png"
ANDROID_FG = IMAGES / "android-icon-foreground.png"
ANDROID_MONO = IMAGES / "android-icon-monochrome.png"

# The mark's colour: white, which is what reads on the brand purple. In the
# splash PNG the background is transparent instead, so that one raster has to
# be looked at on something dark to be seen at all.
INK = (0xFF, 0xFF, 0xFF)
# The purple it sits on: `brand600` in packages/ui/src/tokens.ts. Everything
# that paints the launch carries it — `adaptiveIcon.backgroundColor` and the
# splash plugin in app.json, `SPLASH_BG` in AnimatedSplash.tsx — and they have
# to agree exactly, or the handoff from the native splash to the JS one shows
# as a flash of a different colour.
FIELD = (0x6C, 0x4E, 0xE3)
# Drawn this many times over and downsampled, so the round caps and the tilt
# come out smooth without leaning on a vector rasteriser.
SS = 4

# The launcher icons come from here, not from the geometry above. This 1024
# square is the supplied original drawing of the mark, on the old yellow;
# wave-mark.json is a rebuild of the same shape for the animated splash, and
# the two are not the same curve — the rebuilt one is a good deal taller for
# its width, with its dot further off the end of the stroke. Recolouring the
# square is therefore the only way to move the icons onto the new brand
# without the mark also changing proportion, size and position inside the
# icon, which is not what a recolour is for.
SOURCE = ROOT / "infra/art/brand/waves-icon-1024.png"
SOURCE_FIELD = (0xF5, 0xD8, 0x00)
SOURCE_INK = (0x2B, 0x2B, 0x20)


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


def render_mark():
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
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=INK + (255,))

    dr = dot["r"] * s * SS
    dx, dy = place((dot["cx"], dot["cy"]))
    d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=INK + (255,))

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
    im.save(SPLASH_MARK)

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
    # `newline=""` so the line endings are the ones written here and not the
    # platform's: on Windows the default would turn every one into CRLF and
    # re-running this would rewrite the whole file for nothing.
    GEOM.write_text(json.dumps(g, indent=2) + "\n", encoding="utf-8", newline="")

    report(SPLASH_MARK, im.getchannel("A"))


def coverage(im):
    """Read back how much ink covers each pixel of the supplied square.

    The original is two flat colours with an anti-aliased boundary between
    them, so every pixel sits somewhere on the line from the field to the ink,
    and the red channel — the widest-ranging of the three between those two
    colours — says how far along. Recovering the coverage is what lets the mark
    be laid down again in another pair of colours with its edge intact. Simply
    swapping one colour for another would leave the old yellow smeared around
    every curve, because the rim pixels are neither of the two colours.
    """
    span = SOURCE_FIELD[0] - SOURCE_INK[0]
    return (
        im.convert("RGB")
        .getchannel("R")
        .point(lambda v: max(0, min(255, round((SOURCE_FIELD[0] - v) * 255 / span))))
    )


def paint(cov, field, ink):
    """Lay `ink` on `field` at the coverage `cov` describes."""
    return Image.merge(
        "RGB",
        [
            cov.point(lambda t, f=f, i=i: round(f + (i - f) * t / 255))
            for f, i in zip(field, ink)
        ],
    )


def render_icons():
    cov = coverage(Image.open(SOURCE))
    icon = paint(cov, FIELD, INK)

    # Written as RGB rather than RGBA: iOS rejects an app icon that carries an
    # alpha channel at all, even one that is opaque in every pixel, and a mode
    # without an alpha channel has nowhere to keep one.
    icon.save(ICON)
    # The favicon is that same square, small. Nothing about it is drawn
    # separately, so it is resampled from the icon rather than cut again.
    icon.resize((48, 48), Image.LANCZOS).save(FAVICON)
    # The Android background layer is the field alone, and a whole flat square
    # of it: the launcher slides the two layers against each other for
    # parallax, and must never pull a corner off the paint.
    Image.new("RGB", (432, 432), FIELD).save(ANDROID_BG)

    # The foreground and the monochrome layer are one silhouette in two
    # colours — a launcher draws whichever it asks for — so they have to agree
    # to the pixel. The monochrome one needs no recolour, since Android tints
    # it; the foreground therefore borrows its shape from that file instead of
    # being cut from the 1024 square again, which would land a fraction of a
    # pixel off it and split the pair apart. Borrowing also keeps, for free,
    # the 60%-of-canvas sizing that holds the mark inside the 66% the launcher
    # promises not to crop.
    alpha = Image.open(ANDROID_MONO).convert("RGBA").getchannel("A")
    foreground = Image.new("RGBA", alpha.size, INK + (0,))
    foreground.putalpha(alpha)
    foreground.save(ANDROID_FG)

    # Measured off the files as written, not off what went into them, so the
    # numbers printed are the ones a re-run can be held to.
    report(ICON, written_ink(ICON))
    report(FAVICON, written_ink(FAVICON))
    report(ANDROID_FG, alpha)
    print(f"wrote {ANDROID_BG.relative_to(ROOT)}  flat {'#%02X%02X%02X' % FIELD}")


def written_ink(path):
    """Read an opaque icon's ink back out of it, in the colours it now wears."""
    span = INK[0] - FIELD[0]
    return (
        Image.open(path)
        .convert("RGB")
        .getchannel("R")
        .point(lambda v: max(0, min(255, round((v - FIELD[0]) * 255 / span))))
    )


def report(path, mask):
    """Say where the ink landed, so a re-run can be checked against the last."""
    b = mask.point(lambda v: 255 if v > 8 else 0).getbbox()
    print(f"wrote {path.relative_to(ROOT)}  ink {b[2] - b[0]}x{b[3] - b[1]} at {b}")


def main():
    render_mark()
    render_icons()


if __name__ == "__main__":
    main()
