#!/usr/bin/env python3
"""tools/make-app-icons.py — gives every BoostPay app a real 192 + 512 PNG icon.

Android/Chrome only offers the native "Install app" sheet when the manifest
carries a 192px and a 512px icon; an SVG-only manifest silently loses the
install prompt on many phones. This renders each app's icon.svg into PNGs (or
upscales an existing 192 PNG) so `/app` can actually install everywhere.

Run:  LD_LIBRARY_PATH=/home/user/pwlibs/root/usr/lib/x86_64-linux-gnu python3 tools/make-app-icons.py
"""
import asyncio
import os
import pathlib
import re

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
APPS = ['.', 'admin-app', 'agent-app', 'management-app', 'support-app', 'promo-app', 'db-studio']
SIZES = (192, 512)


def upscale(src: pathlib.Path, dst: pathlib.Path, size: int) -> bool:
    try:
        with Image.open(src) as im:
            im = im.convert('RGBA')
            if im.size[0] != size:
                im = im.resize((size, size), Image.LANCZOS)
            im.save(dst, 'PNG')
        return True
    except Exception as exc:  # pragma: no cover - reported, never fatal
        print(f'  ! upscale failed {src}: {exc}')
        return False


async def render_svg(svg: pathlib.Path, dst: pathlib.Path, size: int) -> bool:
    from playwright.async_api import async_playwright
    html = (
        '<html><body style="margin:0;background:transparent">'
        f'<img src="{svg.as_uri()}" style="width:{size}px;height:{size}px;display:block">'
        '</body></html>'
    )
    tmp = dst.with_suffix('.render.html')
    tmp.write_text(html)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg = await b.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
            await pg.goto(tmp.as_uri())
            await pg.wait_for_timeout(350)
            await pg.screenshot(path=str(dst), omit_background=True)
            await b.close()
        return True
    finally:
        tmp.unlink(missing_ok=True)


async def main():
    for app in APPS:
        pub = ROOT / app / 'public' if app != '.' else ROOT / 'public'
        p192, p512 = pub / 'pwa-192x192.png', pub / 'pwa-512x512.png'
        svg = pub / 'icon.svg'
        print(f'[{app}]')
        if not p192.exists() and svg.exists():
            if await render_svg(svg, p192, 192):
                print('  + pwa-192x192.png from icon.svg')
        if not p512.exists():
            if svg.exists():
                if await render_svg(svg, p512, 512):
                    print('  + pwa-512x512.png from icon.svg')
            elif p192.exists() and upscale(p192, p512, 512):
                print('  + pwa-512x512.png upscaled from pwa-192x192.png')
        for f in (p192, p512):
            print(f'  {"ok " if f.exists() else "MISSING "}{f.name} {f.stat().st_size if f.exists() else 0} bytes')


if __name__ == '__main__':
    asyncio.run(main())
