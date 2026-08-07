import os
from PIL import Image, ImageDraw

def create_fullbleed_logo(size=1024):
    # Full-bleed solid dark obsidian slate background (NO transparent margins)
    # This prevents Windows Explorer from applying system accent coloring (orange square block)
    img = Image.new("RGBA", (size, size), (14, 17, 22, 255))
    draw = ImageDraw.Draw(img)

    def s(v):
        return (v / 1024.0) * size

    # Main dark panel frame
    margin = s(36)
    radius = s(140)

    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill=(20, 24, 30, 255),
        outline=(58, 68, 82, 255),
        width=int(s(18))
    )

    # Inner metallic rim
    draw.rounded_rectangle(
        [margin + s(20), margin + s(20), size - margin - s(20), size - margin - s(20)],
        radius=radius - s(10),
        outline=(255, 255, 255, 22),
        width=int(s(5))
    )

    # 3 Fader Slots
    slot_w = s(38)
    slot_r = s(19)
    
    # Slot 1 (Left - Silver)
    x1 = s(340)
    draw.rounded_rectangle([x1 - slot_w/2, s(260), x1 + slot_w/2, s(760)], radius=slot_r, fill=(28, 34, 44, 255))
    draw.rounded_rectangle([x1 - slot_w/2 + s(4), s(450), x1 + slot_w/2 - s(4), s(754)], radius=s(14), fill=(220, 228, 238, 255))
    draw.rounded_rectangle([x1 - s(54), s(420), x1 + s(54), s(486)], radius=s(18), fill=(240, 245, 252, 255), outline=(14, 18, 24, 255), width=int(s(6)))
    draw.line([x1 - s(38), s(453), x1 + s(38), s(453)], fill=(30, 36, 46, 255), width=int(s(8)))

    # Slot 2 (Center - Signal Orange)
    x2 = s(512)
    draw.rounded_rectangle([x2 - slot_w/2, s(200), x2 + slot_w/2, s(760)], radius=slot_r, fill=(42, 28, 22, 255))
    draw.rounded_rectangle([x2 - slot_w/2 + s(4), s(310), x2 + slot_w/2 - s(4), s(754)], radius=s(14), fill=(255, 121, 64, 255))
    draw.rounded_rectangle([x2 - s(60), s(280), x2 + s(60), s(350)], radius=s(20), fill=(255, 121, 64, 255), outline=(255, 255, 255, 230), width=int(s(8)))
    draw.line([x2 - s(42), s(315), x2 + s(42), s(315)], fill=(255, 255, 255, 255), width=int(s(10)))

    # Slot 3 (Right - Cyan Teal)
    x3 = s(684)
    draw.rounded_rectangle([x3 - slot_w/2, s(290), x3 + slot_w/2, s(760)], radius=slot_r, fill=(22, 38, 38, 255))
    draw.rounded_rectangle([x3 - slot_w/2 + s(4), s(520), x3 + slot_w/2 - s(4), s(754)], radius=s(14), fill=(51, 209, 184, 255))
    draw.rounded_rectangle([x3 - s(54), s(490), x3 + s(54), s(556)], radius=s(18), fill=(51, 209, 184, 255), outline=(14, 18, 24, 255), width=int(s(6)))
    draw.line([x3 - s(38), s(523), x3 + s(38), s(523)], fill=(12, 34, 32, 255), width=int(s(8)))

    # Top Right LED Indicator (Green)
    led_cx, led_cy, led_r = s(770), s(200), s(34)
    draw.ellipse([led_cx - led_r - s(12), led_cy - led_r - s(12), led_cx + led_r + s(12), led_cy + led_r + s(12)], fill=(63, 224, 130, 70))
    draw.ellipse([led_cx - led_r, led_cy - led_r, led_cx + led_r, led_cy + led_r], fill=(63, 224, 130, 255), outline=(255, 255, 255, 200), width=int(s(6)))

    return img

master_path = r"app-icon-master.png"
master = create_fullbleed_logo(1024)
master.save(master_path)

out_dir = r"src-tauri\icons"
public_dir = r"public"
os.makedirs(out_dir, exist_ok=True)
os.makedirs(public_dir, exist_ok=True)

# Export all Windows Appx Square Logos with solid full-bleed background
appx_sizes = {
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}

for name, sz in appx_sizes.items():
    resized = master.resize((sz, sz), Image.Resampling.LANCZOS)
    resized.save(os.path.join(out_dir, name))

master.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(public_dir, "favicon.png"))
master.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(public_dir, "icon.png"))

# Create full-bleed multi-resolution Windows ICO
ico_resolutions = [256, 128, 64, 48, 32, 24, 16]
ico_imgs = [master.resize((sz, sz), Image.Resampling.LANCZOS) for sz in ico_resolutions]

ico_imgs[0].save(
    os.path.join(out_dir, "icon.ico"),
    format="ICO",
    sizes=[(sz, sz) for sz in ico_resolutions],
    append_images=ico_imgs[1:]
)

print(f"Full-bleed solid dark ICO and PNG suite generated successfully!")
