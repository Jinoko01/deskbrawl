"""Regenerate the landing font with FontTools and its WOFF2 (Brotli) support."""

from pathlib import Path
from shutil import copyfile

from fontTools import subset
from fontTools.ttLib import TTFont


def main() -> None:
    landing = Path(__file__).resolve().parents[1]
    original = landing.parent / "desktop" / "src" / "assets" / "fonts"
    sources = [landing / "index.html", landing / "updates" / "index.html"]
    sources.extend(
        path for path in sorted((landing / "src").rglob("*.ts"))
        if not path.name.endswith(".test.ts")
    )
    text = "".join(path.read_text(encoding="utf-8-sig") for path in sources)
    # The Korean clock's day periods come from Intl, outside the source text.
    codepoints = set(range(0x20, 0x7F)) | {ord(char) for char in text + "오전오후"}
    options = subset.Options()
    options.name_IDs = ["*"]
    options.layout_features = ["*"]
    font = TTFont(original / "PretendardVariable.woff2", recalcTimestamp=False)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)

    # Preserve attribution records and give the modified font its own name.
    for record in font["name"].names:
        if record.nameID in {1, 3, 4, 6, 16, 25} or record.nameID >= 256:
            name = record.toUnicode().replace("Pretendard Variable", "DeskBrawl UI")
            record.string = name.replace("PretendardVariable", "DeskBrawlUI")

    output = landing / "src" / "fonts" / "deskbrawl-ui.woff2"
    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output)
    license_file = landing / "public" / "fonts" / "OFL.txt"
    license_file.parent.mkdir(parents=True, exist_ok=True)
    copyfile(original / "OFL.txt", license_file)


if __name__ == "__main__":
    main()
