"""Cuts Material Symbols Rounded down to the icons the app uses.

The full variable font is about 15 MB; the app draws a handful of icons, always at the default
style (WPF can't set a variable font's axes). So this pins the axes to that default
(outlined, weight 400, grade 0, optical size 24) and keeps only the code points named in
src/GeminiLive/Design/Glyphs.cs, the one list of icons. Re-run it after adding a glyph there:

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
GLYPHS = ROOT / "src" / "GeminiLive" / "Design" / "Glyphs.cs"
OUT = ROOT / "src" / "GeminiLive" / "Fonts" / "MaterialSymbolsRounded.ttf"
DEFAULT_STYLE = {"FILL": 0, "GRAD": 0, "opsz": 24, "wght": 400}


def code_points() -> list[int]:
    # Each constant is one Private Use Area character in a string literal.
    found = re.findall('"([-])"', GLYPHS.read_text(encoding="utf-8"))
    if not found:
        sys.exit(f"no icon glyphs found in {GLYPHS}")
    return sorted({ord(glyph) for glyph in found})


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
