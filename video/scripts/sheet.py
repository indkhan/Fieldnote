"""Builds contact sheets from a draft video: python scripts/sheet.py <video> <prefix> [start] [end] [step]."""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FFMPEG = os.path.join(ROOT, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe")
video, prefix = sys.argv[1], sys.argv[2]
start = float(sys.argv[3]) if len(sys.argv) > 3 else 0
end = float(sys.argv[4]) if len(sys.argv) > 4 else 72
step = float(sys.argv[5]) if len(sys.argv) > 5 else 1
COLUMNS, ROWS, WIDTH = 6, 6, 400

with tempfile.TemporaryDirectory() as folder:
    frames = []
    beat = start
    while beat < end:
        path = os.path.join(folder, f"{beat:07.2f}.png")
        moment = beat * 0.5 + step * 0.5 * 0.8
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{moment:.3f}", "-i", video, "-frames:v", "1", path], check=True)
        frames.append((beat, Image.open(path).convert("RGB")))
        beat += step
    height = int(frames[0][1].height * WIDTH / frames[0][1].width)
    for sheet in range(0, len(frames), COLUMNS * ROWS):
        chunk = frames[sheet : sheet + COLUMNS * ROWS]
        canvas = Image.new("RGB", (COLUMNS * (WIDTH + 4), ((len(chunk) - 1) // COLUMNS + 1) * (height + 4)), (45, 45, 50))
        for i, (beat, image) in enumerate(chunk):
            x, y = (i % COLUMNS) * (WIDTH + 4), (i // COLUMNS) * (height + 4)
            canvas.paste(image.resize((WIDTH, height)), (x, y))
            ImageDraw.Draw(canvas).text((x + 5, y + 4), f"b{beat:g}", fill=(255, 220, 90))
        canvas.save(f"{prefix}-{sheet // (COLUMNS * ROWS)}.jpg", quality=88)
print("sheets written")
