"""Builds the short silent GIF shown in the README from the finished landscape video."""
import os
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FFMPEG = os.path.join(ROOT, "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe")
VIDEO = os.path.join(ROOT, "out", "Fieldnote-16x9.mp4")
OUTPUT = sys.argv[1]
WIDTH, FPS = 720, 10
# Beat ranges from the film: the hook, the logo, recording, one click, the hand-off, the loop, and the end card.
SEGMENTS = [(4, 8), (16, 18), (21, 25), (40, 43), (48, 50), (58, 62), (69, 72)]

frames = []
with tempfile.TemporaryDirectory() as folder:
    for start, end in SEGMENTS:
        moment = start * 0.5 + 0.05  # Just after the cut, once the text has appeared.
        while moment < end * 0.5:
            path = os.path.join(folder, f"{len(frames):04d}.png")
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{moment:.3f}", "-i", VIDEO, "-frames:v", "1", path], check=True)
            image = Image.open(path).convert("RGB")
            image = image.resize((WIDTH, round(image.height * WIDTH / image.width)), Image.LANCZOS)
            frames.append(image.quantize(colors=64, method=Image.MEDIANCUT, dither=Image.NONE))
            moment += 1 / FPS

durations = [1000 // FPS] * len(frames)
durations[-1] = 1800  # Hold the end card, so the link can be read before the loop restarts.
frames[0].save(OUTPUT, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f"{len(frames)} frames, {os.path.getsize(OUTPUT) / 1e6:.1f} MB")
