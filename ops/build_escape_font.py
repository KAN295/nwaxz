"""Subset Noto Serif SC (SIL OFL 1.1) to the characters the escape-mode UI actually uses.

Usage (from the repo root, with fonttools + brotli installed):
    python ops/build_escape_font.py <dir containing NotoSerifSC-Bold.otf and NotoSerifSC-Black.otf>

Writes public/assets/fonts/escape/*.woff2. Characters outside the subset (e.g. player
nicknames) fall back to the next font in the CSS stack, so the subset only has to cover
text the game itself writes. Re-run whenever new UI copy is added.
"""
import pathlib
import re
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "fonts" / "escape"
SOURCES = [*(ROOT / "src" / "escape").glob("*.ts"), *(ROOT / "src" / "escape").glob("*.css"), *(ROOT / "server").glob("coop-*.mjs"), ROOT / "server" / "social-service.mjs"]
TITLE = "奶蛙下水道逃生"
# Printable ASCII plus the full-width punctuation and symbols used in the UI.
BASE = "".join(chr(c) for c in range(0x20, 0x7F)) + "，。、！？：；（）【】《》「」『』“”‘’…—～·×→←↑↓◇✦❄✉♥＋　"


def ui_characters() -> str:
    seen = set(BASE)
    for path in SOURCES:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        seen.update(ch for ch in text if re.match(r"[　-〿㐀-鿿＀-￯]", ch))
    return "".join(sorted(seen))


def build(source: pathlib.Path, target: pathlib.Path, text: str) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga", "palt", "vpal", "locl"]
    options.name_IDs = ["*"]  # keep copyright/licence names
    options.notdef_outline = True
    font = subset.load_font(str(source), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    target.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(target), options)
    print(f"{target.relative_to(ROOT)}: {len(text)} chars, {target.stat().st_size // 1024} KiB")


def main() -> None:
    src = pathlib.Path(sys.argv[1])
    text = ui_characters()
    build(src / "NotoSerifSC-Bold.otf", OUT / "noto-serif-sc-bold-escape.woff2", text)
    build(src / "NotoSerifSC-Black.otf", OUT / "noto-serif-sc-black-title.woff2", TITLE + BASE)


if __name__ == "__main__":
    main()
