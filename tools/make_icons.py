"""Wizard app icons in the Wizard UX launcher style: rounded gradient tile, soft inner glow, white line glyph.
Palette from wizard-ux core/base.css. Renders 512px PNG (icon.png) and a 512px JPEG (runtipi/metadata/logo.jpg)."""
import io
import sys
from pathlib import Path

import resvg_py
from PIL import Image

ROOT = Path("/home/oscar/github_repos")

def stroke(w=22):
    return f'fill="none" stroke="#fff" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"'


STROKE = stroke()

GLYPHS = {
    # Agent: a four-point spark (Wizard's ✦) with a small orbiting star
    "hermes-agent": (["#7a5cff", "#3b1fd1"], f'''
      <path d="M256 128 C268 214 298 244 384 256 C298 268 268 298 256 384 C244 298 214 268 128 256 C214 244 244 214 256 128 Z" fill="#fff"/>
      <path d="M364 138 C368 160 376 168 398 172 C376 176 368 184 364 206 C360 184 352 176 330 172 C352 168 360 160 364 138 Z" fill="#fff" opacity=".85"/>'''),
    # Interface: a window with a chat bubble
    "hermes-frontend-3": (["#3fe0ff", "#3f6bff"], f'''
      <rect x="120" y="140" width="272" height="232" rx="34" {STROKE}/>
      <path d="M120 196 H392" {STROKE}/>
      <circle cx="156" cy="168" r="9" fill="#fff"/><circle cx="184" cy="168" r="9" fill="#fff"/>
      <path d="M176 248 H300 a20 20 0 0 1 20 20 V292 a20 20 0 0 1 -20 20 H226 L196 336 V312 H176 a20 20 0 0 1 -20 -20 V268 a20 20 0 0 1 20 -20 Z" fill="#fff"/>'''),
    # App: vertical video frame with play triangle and caption bars
    "defleur-video": (["#ff6b86", "#d6246e"], f'''
      <rect x="164" y="96" width="184" height="320" rx="34" {STROKE}/>
      <path d="M232 192 L306 236 L232 280 Z" fill="#fff"/>
      <path d="M206 336 H306 M222 368 H290" {stroke(18)}/>'''),
    # System: Files, a folder
    "files": (["#ffd166", "#f59e0b"], f'''
      <path d="M120 176 a28 28 0 0 1 28 -28 H214 L246 180 H364 a28 28 0 0 1 28 28 V336 a28 28 0 0 1 -28 28 H148 a28 28 0 0 1 -28 -28 Z" {STROKE}/>
      <path d="M120 220 H392" {STROKE}/>'''),
    # System: Transcriber, waveform turning into text lines
    "transcriber": (["#4ff0b0", "#0e9f8a"], f'''
      <path d="M120 256 V256 M160 214 V298 M200 168 V344 M240 208 V304" {stroke(26)}/>
      <path d="M290 192 H396 M290 256 H396 M290 320 H356" {stroke(26)}/>'''),
    # System: Browser, a globe
    "browser": (["#ff9a4d", "#e5542d"], f'''
      <circle cx="256" cy="256" r="126" {stroke(20)}/>
      <ellipse cx="256" cy="256" rx="54" ry="126" {stroke(18)}/>
      <path d="M130 256 H382 M150 194 H362 M150 318 H362" {stroke(14)}/>'''),
    # System: Secret Drop, a drop with a keyhole
    "secret-drop": (["#7c8db5", "#3c4a72"], f'''
      <path d="M256 108 C256 108 152 228 152 302 a104 104 0 0 0 208 0 C360 228 256 108 256 108 Z" fill="#fff"/>
      <circle cx="256" cy="290" r="24" fill="#4a5884"/>
      <path d="M246 300 L240 352 H272 L266 300 Z" fill="#4a5884"/>'''),
    # System: AI Accounts, a key with a connection link
    "ai-accounts": (["#ff5ccf", "#e0249a"], f'''
      <circle cx="186" cy="256" r="74" {stroke(26)}/>
      <circle cx="186" cy="256" r="20" fill="#fff"/>
      <path d="M260 256 H404 M364 256 V318 M318 256 V302" {stroke(26)}/>'''),
    # System: Claude connection, a plain "C" arc with a plug link (not Anthropic's mark), clay orange
    # System: Claude connection, a plain "C" arc wired to a two-prong plug (not Anthropic's mark), clay orange
    "claude-connection": (["#e08a64", "#9c3d22"], f'''
      <path d="M300 160 A112 112 0 1 0 300 352" {stroke(30)}/>
      <path d="M254 256 H316" {stroke(22)}/>
      <rect x="316" y="214" width="44" height="84" rx="12" fill="#fff"/>
      <path d="M360 234 H398 M360 278 H398" {stroke(18)}/>'''),
}


def svg(colors, glyph):
    a, b = colors
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>
    <radialGradient id="glow" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <rect width="512" height="512" rx="112" fill="url(#glow)"/>
  <rect x="3" y="3" width="506" height="506" rx="109" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="6"/>
  {glyph}
</svg>'''


def render(app, repo_dir):
    colors, glyph = GLYPHS[app]
    png = bytes(resvg_py.svg_to_bytes(svg_string=svg(colors, glyph), width=512, height=512))
    repo = Path(repo_dir)
    (repo / "icon.png").write_bytes(png)
    (repo / "icon.svg").write_text(svg(colors, glyph))
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    bg = Image.new("RGB", img.size, "#05030c")  # Wizard UX background behind the rounded corners
    bg.paste(img, mask=img.split()[3])
    logo = repo / "runtipi" / "metadata" / "logo.jpg"
    bg.save(logo, "JPEG", quality=92)
    print(app, "->", repo, len(png), "bytes")


if __name__ == "__main__":
    targets = dict(arg.split("=", 1) for arg in sys.argv[1:])
    for app, d in targets.items():
        render(app, d)
