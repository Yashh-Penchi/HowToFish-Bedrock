
"""Build only the included Crab Boss + Mussels packs into a .mcaddon."""
from pathlib import Path
import zipfile
import sys

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "HowToFish_CrabBoss_Mussels.mcaddon"
PACKS = ("BP", "RP")

def main():
    missing = [name for name in PACKS if not (ROOT / name / "manifest.json").is_file()]
    if missing:
        print("Missing pack manifest(s): " + ", ".join(missing), file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for pack in PACKS:
            folder = ROOT / pack
            for path in sorted(folder.rglob("*")):
                if path.is_file():
                    zf.write(path, path.relative_to(ROOT).as_posix())
    print(f"Built: {OUT}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
