"""
Makes a small thumbnail (`<id>.s.webp`, 240 px wide) next to every full card illustration.
Cards shown at hand/seat/table size load the thumbnail (~10 KB instead of ~100 KB); the large preview shows the
thumbnail instantly and swaps in the full picture when it has arrived — so slow connections get something at once.

  pip install pillow
  python tools/art/thumbs.py            # only missing / outdated thumbnails
  python tools/art/thumbs.py --force
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CARDS = ROOT / 'packages/client/public/art/cards'
WIDTH = 240


def main() -> None:
    force = '--force' in sys.argv
    made = saved = 0
    for full in sorted(CARDS.glob('*.webp')):
        if full.name.endswith('.s.webp'):
            continue
        thumb = full.with_name(full.stem + '.s.webp')
        if thumb.exists() and not force and thumb.stat().st_mtime >= full.stat().st_mtime:
            continue
        with Image.open(full) as im:
            h = round(im.height * WIDTH / im.width)
            im.convert('RGB').resize((WIDTH, h), Image.LANCZOS).save(thumb, 'WEBP', quality=68, method=6)
        made += 1
        saved += full.stat().st_size - thumb.stat().st_size
    total = sum(p.stat().st_size for p in CARDS.glob('*.s.webp'))
    print(f'{made} thumbnails written; all thumbnails together: {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()

