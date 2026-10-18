from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
size = 512
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=112, fill="#142138")
draw.line((132, 142, 132, 370), fill="#7DE2CF", width=32)
draw.arc((132, 142, 390, 345), 180, 280, fill="#7DE2CF", width=32)
for x, y, color in ((132, 140, "#7DE2CF"), (132, 370, "#7DE2CF"), (382, 254, "#8CB8FF")):
    draw.ellipse((x - 35, y - 35, x + 35, y + 35), fill=color)
draw.line((268, 370, 308, 408, 390, 320), fill="#8CB8FF", width=24, joint="curve")
image.resize((128, 128), Image.Resampling.LANCZOS).save(root / "resources" / "extension-icon.png")
