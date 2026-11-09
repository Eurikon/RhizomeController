#!/usr/bin/env python3
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = (
    'index.html', 'projects/zynthian-edition/index.html', 'sitemap.xml', 'site.css', 'site.js', 'discussions.js', 'giscus-theme.css', 'assets/favicon.svg',
    'assets/rhizome-interface.webp', 'assets/rhizome-interface-full.png',
    'assets/rhizome-panel-wireframe.png',
    'assets/inside/display-board.webp',
    'assets/inside/display-board-thumb.webp',
    'assets/inside/display-chip.webp',
    'assets/inside/display-chip-thumb.webp',
    'assets/inside/usb-hub-power.webp',
    'assets/inside/usb-hub-power-thumb.webp',
    'assets/inside/power-regulators.webp',
    'assets/inside/power-regulators-thumb.webp',
    'assets/inside/usb-hub-board.webp',
    'assets/inside/usb-hub-board-thumb.webp',
    'assets/inside/panel-label.webp',
    'assets/inside/panel-label-thumb.webp',
    'assets/inside/panel-model.webp',
    'assets/inside/panel-model-thumb.webp',
)


def build():
    destination = ROOT / 'dist/website'
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in PUBLIC_FILES:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'website' / name, target)
    (destination / '.nojekyll').touch()
    print('Built public-only website in dist/website')


if __name__ == '__main__':
    build()
