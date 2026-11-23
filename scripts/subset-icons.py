"""Cuts Material Symbols Rounded down to the icons the app uses.

The full variable font is about 15 MB; the app draws a handful of icons, always at the default
style (WinUI can't set a variable font's axes). So this pins the axes to that default
(outlined, weight 400, grade 0, optical size 24) and keeps only the code points named in
app/src/overlays/glyphs.ts (the overlays' icons) and pill/src/ui/glyph/glyphs.ts (the pill's).
A glyph is written either as the character itself or as a "\\uXXXX" escape.
Re-run it after adding a glyph to either:

    python scripts/subset-icons.py <path to MaterialSymbolsRounded[FILL,GRAD,opsz,wght].ttf>

The upstream font is in github.com/google/material-design-icons, variablefont/.
"""

import pathlib
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
GLYPH_SOURCES = [
    ROOT / "app" / "src" / "overlays" / "glyphs.ts",
    ROOT / "pill" / "src" / "ui" / "glyph" / "glyphs.ts",
]
OUT = ROOT / "pill" / "fonts" / "MaterialSymbolsRounded.ttf"
DEFAULT_STYLE = {"FILL": 0, "GRAD": 0, "opsz": 24, "wght": 400}
PRIVATE_USE_AREA = range(0xE000, 0xF900)
ESCAPE = re.compile(r'"\\u([0-9A-Fa-f]{4})"')
LITERAL = re.compile('"([-])"')


def code_points() -> list[int]:
    found = set()
    for source in GLYPH_SOURCES:
        text = source.read_text(encoding="utf-8")
        found.update(ord(glyph) for glyph in LITERAL.findall(text))
        found.update(int(digits, 16) for digits in ESCAPE.findall(text))
    points = sorted(point for point in found if point in PRIVATE_USE_AREA)
    if not points:
        sys.exit(f"no icon glyphs found in {GLYPH_SOURCES}")
    return points


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    font = instancer.instantiateVariableFont(TTFont(sys.argv[1]), DEFAULT_STYLE)
    points = code_points()
    options = subset.Options()
    options.layout_features = []  # icons are reached by code point, never by ligature name
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    font.save(OUT)
    print(f"{len(points)} icons -> {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
