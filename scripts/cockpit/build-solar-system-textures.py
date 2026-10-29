"""Builds the /cockpit solar-system textures (apps/web/public/cockpit/solar-system).

Sources: Solar System Scope texture library (CC BY 4.0,
https://www.solarsystemscope.com/textures/), taken from the copies shipped
with Qt 3D's planets-qml example (qt/qt3d, branch 5.15,
examples/qt3d/planets-qml/images/solarsystemscope/) plus stars_milky_way.jpg.
Download them into one folder, then:

    python3 scripts/cockpit/build-solar-system-textures.py <src-dir> apps/web/public/cockpit/solar-system

Outputs 1024x512 colour maps, bump maps for the rocky bodies (height
integrated from the source normal maps, Frankot-Chellappa), Earth clouds and
roughness, Venus' cloud deck, and Saturn's ring as a radial strip.
Needs numpy and Pillow.
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
W, H = 1024, 512

def load(name, mode="RGB", size=(W, H)):
    return Image.open(os.path.join(SRC, name)).convert(mode).resize(size, Image.LANCZOS)

def save_jpg(img, name, q=84):
    img.save(os.path.join(OUT, name), "JPEG", quality=q, optimize=True, progressive=True)

def height_from_normal(name):
    """Frankot-Chellappa: integrate a tangent-space normal map into a height field."""
    n = np.asarray(load(name)).astype(np.float64) / 255.0 * 2.0 - 1.0
    nz = np.clip(n[..., 2], 0.2, 1.0)
    p = -n[..., 0] / nz            # dz/dx
    q = n[..., 1] / nz             # dz/dy (image y points down, normal map y up)
    h, w = p.shape
    wx = np.fft.fftfreq(w) * 2 * np.pi
    wy = np.fft.fftfreq(h) * 2 * np.pi
    WX, WY = np.meshgrid(wx, wy)
    denom = WX**2 + WY**2
    denom[0, 0] = 1.0
    Z = (-1j * WX * np.fft.fft2(p) - 1j * WY * np.fft.fft2(q)) / denom
    Z[0, 0] = 0
    # Drop the very low frequencies (integration drift), keep relief.
    sigma = 2 * np.pi / 80.0
    Z *= 1.0 - np.exp(-denom / (2 * sigma**2))
    z = np.real(np.fft.ifft2(Z))
    lo, hi = np.percentile(z, [1, 99])
    z = np.clip((z - lo) / (hi - lo), 0, 1)
    return Image.fromarray((z * 255).astype(np.uint8), "L")

def height_from_luma(img, radius=24, gain=1.0):
    """High-passed luminance: soft relief for cloud decks and band structure."""
    l = np.asarray(img.convert("L")).astype(np.float64)
    blur = np.asarray(img.convert("L").filter(ImageFilter.GaussianBlur(radius))).astype(np.float64)
    z = (l - blur) * gain
    lo, hi = np.percentile(z, [1, 99])
    z = np.clip((z - lo) / (hi - lo), 0, 1)
    return Image.fromarray((z * 255).astype(np.uint8), "L")

# Colour maps.
for src, dst in [
    ("mercurymap.jpg", "mercury.jpg"),
    ("earthmap2k.jpg", "earth.jpg"),
    ("moonmap2k.jpg", "moon.jpg"),
    ("marsmap2k.jpg", "mars.jpg"),
    ("jupitermap.jpg", "jupiter.jpg"),
    ("saturnmap.jpg", "saturn.jpg"),
    ("uranusmap.jpg", "uranus.jpg"),
    ("neptunemap.jpg", "neptune.jpg"),
    ("sunmap.jpg", "sun.jpg"),
]:
    save_jpg(load(src), dst)

# Venus as seen from space: the sulphuric-acid cloud deck, not the radar surface.
# Map the surface map's luminance to a pale cream ramp with low contrast.
v = np.asarray(load("venusmap.jpg").convert("L").filter(ImageFilter.GaussianBlur(6))).astype(np.float64) / 255.0
v = 0.55 + (v - v.mean()) * 0.35
dark, light = np.array([176, 140, 92]), np.array([246, 226, 182])
venus = dark + (light - dark) * np.clip(v, 0, 1)[..., None]
save_jpg(Image.fromarray(venus.astype(np.uint8)), "venus.jpg")

# Bump maps: real relief for rocky bodies, soft cloud relief for the rest.
for src, dst in [
    ("mercurynormal.jpg", "mercury-bump.jpg"),
    ("earthnormal2k.jpg", "earth-bump.jpg"),
    ("moonnormal2k.jpg", "moon-bump.jpg"),
    ("marsnormal2k.jpg", "mars-bump.jpg"),
]:
    save_jpg(height_from_normal(src), dst, q=80)

# Earth: cloud coverage (grey = alpha) and ocean specular mask.
clouds = Image.open(os.path.join(SRC, "earthcloudmapcolortrans.png")).convert("RGBA").resize((W, H), Image.LANCZOS)
save_jpg(clouds.getchannel("A"), "earth-clouds.jpg", q=80)
e = np.asarray(load("earthmap2k.jpg")).astype(np.float64)
ocean = np.clip((e[..., 2] - np.maximum(e[..., 0], e[..., 1]) - 10) / 40, 0, 1)
# Roughness (green channel is read): glossy oceans give a real sun glint.
rough = 1.0 - 0.62 * ocean
save_jpg(Image.fromarray((rough * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(1)).convert("RGB"), "earth-roughness.jpg", q=80)

# Milky Way backdrop (galactic coordinates, band along the equator).
save_jpg(Image.open(os.path.join(SRC, "stars_milky_way.jpg")).convert("RGB"), "milky-way.jpg", q=86)

# Saturn's rings: unwrap the radial profile into a 1D strip (inner -> outer edge).
ring = np.asarray(Image.open(os.path.join(SRC, "saturnringcolortrans.png")).convert("RGBA")).astype(np.float64)
cx, cy, R = 256, 256, 256
alpha = ring[cy, cx:cx + R, 3]
inner = int(np.argmax(alpha > 4))
outer = R - int(np.argmax(alpha[::-1] > 4))
samples = 1024
strip = np.zeros((1, samples, 4))
for i in range(samples):
    r = inner + (outer - inner) * i / (samples - 1)
    acc = np.zeros(4)
    for k in range(64):  # average around the disc to remove compression noise
        a = k / 64 * 2 * np.pi
        x, y = cx + r * np.cos(a), cy + r * np.sin(a)
        acc += ring[int(round(min(511, max(0, y)))), int(round(min(511, max(0, x))))]
    strip[0, i] = acc / 64
Image.fromarray(np.repeat(strip, 4, axis=0).astype(np.uint8), "RGBA").save(os.path.join(OUT, "saturn-ring.png"), optimize=True)
print("ring inner/outer ratio", inner / outer, inner, outer)
