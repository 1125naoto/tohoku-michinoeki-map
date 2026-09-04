"""
道の駅ナビ アプリアイコン／OGP画像 生成スクリプト。

app-icon-source.png（採用元画像）から、PWA/ブラウザ/OGPで使う各種アイコン画像一式を
public/icons/ 以下に、OGP画像を public/og-image.png に生成する。

処理内容（画像の見た目・内容は変更しない、技術的な補正のみ）:
  1. 元画像の黒背景マージンを検出し、正方形にクロップ
  2. 角丸カットアウト部分に残る黒を近傍色でフラッドフィルして除去
  3. 通常アイコン一式（各サイズ）を書き出し
  4. maskableアイコン（中央80%セーフゾーンに主要要素を収めた版）を書き出し
  5. favicon.ico（16/32/48マルチサイズ）を書き出し
  6. OGP画像（1200x630）を書き出し

実行:
  py -3 scripts/gen-icons.py
  （sharp/ImageMagickがこの環境には無いため、Pillowを使用。`pip install pillow` が必要）
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app-icon-source.png"
ICONS_DIR = ROOT / "public" / "icons"
OG_OUT = ROOT / "public" / "og-image.png"

# 通常アイコン（favicon/PWA/Apple/Android各種）
ICON_SIZES = [48, 72, 96, 128, 144, 152, 180, 192, 384, 512]
MASKABLE_SIZE = 512
FAVICON_ICO_SIZES = [16, 32, 48]

FONT_DIR = Path("C:/WINDOWS/Fonts")
MEIRYO_B = FONT_DIR / "meiryob.ttc"
YUGOTH_B = FONT_DIR / "YuGothB.ttc"
YUGOTH_M = FONT_DIR / "YuGothM.ttc"


def is_black(p, thresh=12):
    return p[0] <= thresh and p[1] <= thresh and p[2] <= thresh


def find_bbox(im):
    """元画像の黒背景マージンを除いた、実際の絵柄の外接矩形を検出する。"""
    w, h = im.size
    px = im.load()
    left, right, top, bottom = w, 0, h, 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if not is_black(px[x, y]):
                left = min(left, x)
                right = max(right, x)
                top = min(top, y)
                bottom = max(bottom, y)
    return left, top, right, bottom


def make_square_crop(im, bbox):
    left, top, right, bottom = bbox
    bw, bh = right - left, bottom - top
    side = min(bw, bh)
    cx, cy = (left + right) // 2, (top + bottom) // 2
    half = side // 2
    box = (cx - half, cy - half, cx - half + side, cy - half + side)
    return im.crop(box)


def fill_corners(im):
    """角丸カットアウトの黒領域を、近傍の非黒色でフラッドフィルして除去する。"""
    im = im.copy()
    w, h = im.size
    px = im.load()
    inset = max(4, w // 40)
    corners = {
        "tl": (0, 0, (inset, inset)),
        "tr": (w - 1, 0, (w - 1 - inset, inset)),
        "bl": (0, h - 1, (inset, h - 1 - inset)),
        "br": (w - 1, h - 1, (w - 1 - inset, h - 1 - inset)),
    }
    for _name, (cx, cy, sample_xy) in corners.items():
        if not is_black(px[cx, cy]):
            continue
        sx, sy = sample_xy
        fill_color = px[sx, sy]
        tries = 0
        step_x = 1 if sx < w // 2 else -1
        step_y = 1 if sy < h // 2 else -1
        while is_black(fill_color) and tries < 400:
            sx = max(0, min(w - 1, sx + step_x))
            sy = max(0, min(h - 1, sy + step_y))
            fill_color = px[sx, sy]
            tries += 1
        ImageDraw.floodfill(im, (cx, cy), fill_color, thresh=30)
        px = im.load()
    return im


def make_maskable(base, scale=0.80, bg=None):
    """中央scale比率のセーフゾーンに主要要素を収めたmaskable版を作る。"""
    w, h = base.size
    if bg is None:
        px = base.load()
        bg = px[w // 2, 8]
    canvas = Image.new("RGB", (w, h), bg)
    inner_size = int(round(w * scale))
    resized = base.resize((inner_size, inner_size), Image.LANCZOS)
    offset = ((w - inner_size) // 2, (h - inner_size) // 2)
    canvas.paste(resized, offset)
    return canvas


def make_ogp(base, out_path):
    W, H = 1200, 630
    BG_TOP = (2, 20, 58)
    BG_BOTTOM = (4, 45, 110)

    canvas = Image.new("RGB", (W, H), BG_TOP)
    draw = ImageDraw.Draw(canvas)
    for y in range(H):
        t = y / H
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    icon_size = 420
    icon = base.convert("RGB").resize((icon_size, icon_size), Image.LANCZOS)
    mask = Image.new("L", (icon_size, icon_size), 0)
    mdraw = ImageDraw.Draw(mask)
    radius = int(icon_size * 0.22)
    mdraw.rounded_rectangle([0, 0, icon_size, icon_size], radius=radius, fill=255)
    icon_x, icon_y = 70, (H - icon_size) // 2
    canvas.paste(icon, (icon_x, icon_y), mask)
    draw.rounded_rectangle(
        [icon_x, icon_y, icon_x + icon_size, icon_y + icon_size],
        radius=radius,
        outline=(255, 255, 255),
        width=3,
    )

    text_x = icon_x + icon_size + 60
    title_font = ImageFont.truetype(str(MEIRYO_B), 92)
    sub_font = ImageFont.truetype(str(YUGOTH_B), 38)
    desc_font = ImageFont.truetype(str(YUGOTH_M), 30)

    title = "道の駅ナビ"
    sub = "東北スタンプラリー＆ルート検索"
    desc = "道の駅・グルメ・観光・温泉を\nまとめてドライブ"

    ty = 150
    draw.text((text_x, ty), title, font=title_font, fill=(255, 255, 255))
    ty += 118
    draw.text((text_x, ty), sub, font=sub_font, fill=(255, 210, 90))
    ty += 70
    for line in desc.split("\n"):
        draw.text((text_x, ty), line, font=desc_font, fill=(214, 226, 245))
        ty += 44

    canvas.save(out_path)
    return canvas.size


def main():
    if not SRC.exists():
        raise SystemExit(f"元画像が見つかりません: {SRC}")

    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    src = Image.open(SRC).convert("RGB")
    bbox = find_bbox(src)
    print("bbox:", bbox)
    cropped = make_square_crop(src, bbox)
    print("cropped size:", cropped.size)
    base = fill_corners(cropped)

    maskable = make_maskable(base, scale=0.80)

    for size in ICON_SIZES:
        out = ICONS_DIR / f"icon-{size}.png"
        base.resize((size, size), Image.LANCZOS).save(out)
        print("wrote", out)

    # 既存参照ファイル名は維持（内容だけ新デザインに差し替え、SW precacheのハッシュで自動更新）
    base.resize((192, 192), Image.LANCZOS).save(ICONS_DIR / "icon-192.png")
    base.resize((512, 512), Image.LANCZOS).save(ICONS_DIR / "icon-512.png")
    base.resize((180, 180), Image.LANCZOS).save(ICONS_DIR / "apple-touch-icon.png")

    maskable_out = ICONS_DIR / f"icon-{MASKABLE_SIZE}-maskable.png"
    maskable.resize((MASKABLE_SIZE, MASKABLE_SIZE), Image.LANCZOS).save(maskable_out)
    print("wrote", maskable_out)

    favicon_out = ICONS_DIR / "favicon.ico"
    favicon_imgs = [base.resize((s, s), Image.LANCZOS) for s in FAVICON_ICO_SIZES]
    favicon_imgs[0].save(
        favicon_out,
        format="ICO",
        sizes=[(s, s) for s in FAVICON_ICO_SIZES],
        append_images=favicon_imgs[1:],
    )
    print("wrote", favicon_out)

    base.resize((32, 32), Image.LANCZOS).save(ICONS_DIR / "favicon-32.png")

    size = make_ogp(base, OG_OUT)
    print("wrote", OG_OUT, size)


if __name__ == "__main__":
    main()
