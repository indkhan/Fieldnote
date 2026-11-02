"""Generates the film's original music and sound effects from src/timeline.json.

Everything here is synthesized, so there is nothing to license. It also writes src/energy.json,
the track's loudness at each video frame, which drives the sound bars on screen.
"""
import json
import os
import wave

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
timeline = json.load(open(os.path.join(ROOT, "src", "timeline.json"), encoding="utf-8"))
SR = 48000
BEAT = 60 / timeline["bpm"]
BEATS = timeline["beats"]
N = int(BEATS * BEAT * SR)
rng = np.random.default_rng(7)


def at(beat):
    return int(round(beat * BEAT * SR))


def bus():
    return np.zeros((N, 2))


def add(target, sound, beat, gain=1.0, pan=0.0):
    start = at(beat)
    if start >= N:
        return
    sound = sound[: N - start]
    if sound.ndim == 1:
        left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        target[start : start + len(sound), 0] += sound * left * gain * 1.414
        target[start : start + len(sound), 1] += sound * right * gain * 1.414
    else:
        target[start : start + len(sound)] += sound * gain


def seconds(duration):
    return np.arange(int(duration * SR)) / SR


def spectral(signal, curve):
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1 / SR)
    return np.fft.irfft(spectrum * curve(freqs), len(signal))


def lowpass(signal, cutoff, order=2):
    return spectral(signal, lambda f: 1 / np.sqrt(1 + (f / cutoff) ** (2 * order)))


def highpass(signal, cutoff, order=2):
    return spectral(signal, lambda f: 1 / np.sqrt(1 + (cutoff / np.maximum(f, 1)) ** (2 * order)))


def bandpass(signal, center, width):
    return spectral(signal, lambda f: np.exp(-0.5 * ((f - center) / width) ** 2))


def saw(freq, t, phase=0.0):
    return 2 * ((freq * t + phase) % 1) - 1


def note(name):
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    return 440 * 2 ** ((names[name[0]] + (int(name[-1]) + 1) * 12 - 69) / 12)


# ---- Drums and effects
def kick(punch=1.0):
    t = seconds(0.34)
    phase = 2 * np.pi * np.cumsum(46 + 135 * np.exp(-t * 34)) / SR
    body = np.sin(phase) * np.exp(-t * 8.5)
    click = highpass(rng.normal(size=len(t)), 2200) * np.exp(-t * 420) * 0.25
    return np.tanh((body + click) * 1.5) * punch


def clap():
    t = seconds(0.26)
    noise = bandpass(rng.normal(size=len(t)), 1500, 800)
    bursts = sum(np.exp(-np.maximum(t - d, 0) * 95) * (t >= d) for d in (0, 0.011, 0.023))
    return noise * (bursts + 0.8 * np.exp(-t * 15)) * 0.34


def hat(length=0.045, gain=0.16):
    t = seconds(length)
    return highpass(rng.normal(size=len(t)), 7500) * np.exp(-t * 5 / length) * gain


def snare():
    t = seconds(0.15)
    return (
        np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.4
        + bandpass(rng.normal(size=len(t)), 2800, 1800) * np.exp(-t * 24) * 0.55
    ) * 0.75


def impact(length=2.6, gain=1.0):
    t = seconds(length)
    boom = np.sin(2 * np.pi * np.cumsum(30 + 72 * np.exp(-t * 7)) / SR) * np.exp(-t * 2.3)
    crack = lowpass(rng.normal(size=len(t)), 5200) * np.exp(-t * 9) * 0.55
    return np.tanh((boom + crack) * 1.5) * gain


def whoosh(length=0.3):
    t = seconds(length)
    noise = rng.normal(size=len(t))
    out = np.zeros(len(t))
    hop = 480
    window = np.hanning(hop * 2)
    for start in range(0, len(t) - hop * 2, hop):
        progress = start / len(t)
        out[start : start + hop * 2] += bandpass(noise[start : start + hop * 2], 500 + 7000 * progress**2, 900) * window
    return out * np.sin(np.pi * t / length) ** 2 * 0.42


def riser(length):
    t = seconds(length)
    noise = rng.normal(size=len(t))
    out = np.zeros(len(t))
    hop = 960
    window = np.hanning(hop * 2)
    for start in range(0, len(t) - hop * 2, hop):
        progress = start / len(t)
        out[start : start + hop * 2] += (
            bandpass(noise[start : start + hop * 2], 280 + 8500 * progress**2.2, 500 + 1300 * progress) * window
        )
    tone = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (t / length * 4)) / SR) * 0.08
    return (out * 0.42 + tone) * (t / length) ** 2


def pop():
    t = seconds(0.1)
    return np.sin(2 * np.pi * np.cumsum(540 + 660 * t / 0.1) / SR) * np.exp(-t * 42) * 0.3


def tick():
    t = seconds(0.03)
    return np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 200) * 0.17


def click():
    t = seconds(0.05)
    return (highpass(rng.normal(size=len(t)), 2500) * np.exp(-t * 260) * 0.45) + np.sin(2 * np.pi * 1100 * t) * np.exp(-t * 130) * 0.25


def slam():
    t = seconds(0.32)
    return (
        np.sin(2 * np.pi * np.cumsum(60 + 200 * np.exp(-t * 30)) / SR) * np.exp(-t * 15) * 0.8
        + lowpass(rng.normal(size=len(t)), 4200) * np.exp(-t * 30) * 0.38
    )


def paper():
    t = seconds(0.11)
    return bandpass(rng.normal(size=len(t)), 3300, 1600) * np.exp(-t * 32) * 0.36


def key():
    t = seconds(0.025)
    return bandpass(rng.normal(size=len(t)), 3800, 1500) * np.exp(-t * 230) * 0.26


# ---- Instruments
def supersaw(freqs, length, cutoff, gain=1.0):
    t = seconds(length)
    left, right = np.zeros(len(t)), np.zeros(len(t))
    for freq in freqs:
        for detune, pan in zip((-0.14, -0.06, 0.0, 0.07, 0.15), (-0.8, 0.5, 0.0, -0.45, 0.8)):
            voice = saw(freq * 2 ** (detune / 12), t, rng.random())
            left += voice * (1 - pan) / 2
            right += voice * (1 + pan) / 2
    fade = np.minimum(t / 0.012, 1) * np.minimum((length - t) / 0.03, 1)
    return np.stack([lowpass(left, cutoff) * fade, lowpass(right, cutoff) * fade], axis=1) * gain / (len(freqs) * 2.2)


def pluck(freq, length=0.32, brightness=3200, gain=1.0):
    t = seconds(length)
    tone = saw(freq, t) + 0.5 * saw(freq * 1.004, t, 0.3)
    return lowpass(tone, brightness) * np.exp(-t * 11) * np.minimum(t / 0.002, 1) * gain * 0.42


def bass(freq, length):
    t = seconds(length)
    tone = saw(freq, t) * 0.65 + np.sin(2 * np.pi * freq * t) * 0.9
    fade = np.minimum(t / 0.006, 1) * np.minimum((length - t) / 0.02, 1)
    return np.tanh(lowpass(tone, 520) * 1.5) * fade * 0.62


def lead(freq, length):
    t = seconds(length)
    vibrato = 1 + 0.003 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(t / 0.2, 1)
    tone = saw(np.mean(freq * vibrato), t) + saw(freq * 1.006, t, 0.2) * 0.8 + saw(freq * 2.002, t, 0.4) * 0.22
    envelope = np.minimum(t / 0.008, 1) * np.exp(-t * 2.2) * np.minimum((length - t) / 0.02, 1)
    return lowpass(tone, 4300) * envelope * 0.25


CHORDS = [
    ("A2", ["A3", "C4", "E4", "A4"]),
    ("F2", ["F3", "A3", "C4", "F4"]),
    ("C3", ["G3", "C4", "E4", "G4"]),
    ("G2", ["G3", "B3", "D4", "G4"]),
]
ARP = [0, 2, 1, 3, 2, 1, 3, 2]
HOOK = [
    (0, "E5", 0.75), (0.75, "C5", 0.75), (1.5, "A4", 0.5), (2, "C5", 0.5), (2.5, "E5", 0.75), (3.25, "D5", 0.75),
    (4, "C5", 0.75), (4.75, "A4", 0.75), (5.5, "C5", 0.5), (6, "G5", 1.0), (7, "E5", 1.0),
]


def chord_for(beat):
    return CHORDS[int(beat // 4) % 4]


drums, music, delay_send, reverb_send, effects = bus(), bus(), bus(), bus(), bus()

# Intro: tense, filtered, and building towards the drop at beat 16.
for beat in np.arange(0, 15.5, 0.25):
    root, tones = chord_for(beat)
    step = int(round(beat * 4))
    cutoff = 700 + 2300 * (beat / 16) ** 1.6
    add(music, pluck(note(tones[ARP[step % 8]]), brightness=cutoff, gain=0.6 + 0.3 * beat / 16), beat, pan=0.3 * np.sin(step * 0.9))
    add(delay_send, pluck(note(tones[ARP[step % 8]]), brightness=cutoff, gain=0.3), beat)
for beat in range(0, 16):
    root, _ = chord_for(beat)
    add(drums, bass(note(root) / 1, 0.22), beat, gain=0.55)
    add(drums, kick(0.45 + 0.25 * beat / 16), beat, gain=0.7)
for beat in np.arange(8, 15.5, 0.5):
    add(drums, hat(), beat + 0.25 if False else beat, gain=0.8)
for start in range(0, 16, 4):
    add(music, supersaw([note(n) for n in chord_for(start)[1]], 4 * BEAT - 0.02, 500 + 180 * start), start, gain=0.5)
# A snare roll that accelerates into half a beat of silence.
beat = 12.0
step = 0.5
while beat < 15.5:
    add(drums, snare(), beat, gain=0.34 + 0.5 * (beat - 12) / 3.5)
    if beat >= 14:
        step = 0.125
    elif beat >= 13:
        step = 0.25
    beat += step
add(effects, riser(7.5 * BEAT), 8, gain=0.8)

# Full section: beats 16 to 64.
for beat in range(16, 64):
    add(drums, kick(), beat)
    if beat % 2 == 1:
        add(drums, clap(), beat, gain=0.8)
    add(drums, hat(0.09, 0.2), beat + 0.5, pan=0.15)
    add(drums, hat(0.035, 0.1), beat + 0.25, pan=-0.2)
    add(drums, hat(0.035, 0.09), beat + 0.75, pan=0.2)
    root, _ = chord_for(beat)
    for off in (0.25, 0.5, 0.75):
        add(music, bass(note(root) / (1 if root != "C3" else 2), 0.115), beat + off, gain=0.75)

for start in range(16, 64, 4):
    _, tones = chord_for(start)
    lift = min(1, (start - 16) / 44)
    pad = supersaw([note(n) for n in tones], 4 * BEAT - 0.02, 1500 + 3600 * lift, gain=0.82)
    add(music, pad, start)
    add(reverb_send, pad, start, gain=0.2)

for beat in np.arange(16, 64, 0.25):
    _, tones = chord_for(beat)
    step = int(round(beat * 4))
    octave = 2 if 28 <= beat < 40 or beat >= 48 else 1
    sound = pluck(note(tones[ARP[step % 8]]) * octave, brightness=3600, gain=0.55)
    add(music, sound, beat, pan=0.45 * np.sin(step * 0.8))
    add(delay_send, sound, beat, gain=0.32)

# The hook arrives on the drop, then returns higher for the hand-off.
for origin, transpose, gain in ((16, 1, 1.0), (40, 1, 1.0), (48, 2, 0.8), (56, 2, 0.95)):
    for offset, name, length in HOOK:
        sound = lead(note(name) * transpose, length * BEAT)
        add(music, sound, origin + offset, gain=gain)
        add(delay_send, sound, origin + offset, gain=gain * 0.4)
        add(reverb_send, sound, origin + offset, gain=gain * 0.35)

# The loop section gets faster, with a roll and a riser into the last hit.
for beat in np.arange(56, 64, 0.125):
    add(drums, hat(0.025, 0.1), beat, pan=0.3 * np.sin(beat * 7))
beat = 60.0
while beat < 63.75:
    add(drums, snare(), beat, gain=0.28 + 0.5 * (beat - 60) / 3.75)
    beat += 0.5 if beat < 62 else (0.25 if beat < 63 else 0.125)
add(effects, riser(4 * BEAT), 60, gain=0.75)

# Ending: one big chord that rings out behind the end card.
ending = supersaw([note(n) for n in ("A2", "E3", "A3", "C4", "E4", "A4")], 8 * BEAT, 3600, gain=1.2)
ending_fade = np.exp(-seconds(8 * BEAT) * 0.42)[:, None]
add(music, ending * ending_fade, 64)
add(reverb_send, ending * ending_fade, 64, gain=0.42)
add(drums, kick(1.1), 64)
for offset, name in ((2, "E5"), (3, "C5"), (3.5, "A4"), (4, "C5"), (5, "E5")):
    sound = pluck(note(name), length=0.7, brightness=2800, gain=0.42)
    add(music, sound, 64 + offset)
    add(delay_send, sound, 64 + offset, gain=0.5)

# Sidechain: the music ducks on every kick, which gives the track its pump.
pump = np.ones(N)
for beat in range(16, 64):
    start = at(beat)
    length = int(0.42 * SR)
    t = np.arange(length) / length
    end = min(N, start + length)
    pump[start:end] = np.minimum(pump[start:end], (0.26 + 0.74 * t**0.55)[: end - start])
music *= pump[:, None]

# Sound effects come directly from the shared timeline, so they land exactly on the picture.
sounds = {
    "pop": pop, "tick": tick, "click": click, "slam": slam, "paper": paper, "whoosh": whoosh,
    "impact": lambda: impact(2.8, 0.95), "impact-small": lambda: impact(1.0, 0.45),
}
for cue in timeline["cues"]:
    if cue["sound"] == "type":
        typed = cue["beat"]
        while typed < cue["until"]:
            add(effects, key(), typed, gain=0.8 + 0.3 * rng.random(), pan=0.2 * rng.random() - 0.1)
            typed += 0.125 + 0.0625 * rng.integers(0, 2)
    else:
        add(effects, sounds[cue["sound"]](), cue["beat"], gain=0.85, pan=0.15 * np.sin(cue["beat"] * 5))
add(effects, whoosh(0.5), 15.0, gain=0.8)


def ping_pong(signal, time=0.75 * BEAT, feedback=0.42, repeats=5):
    out = np.zeros_like(signal)
    delay = int(time * SR)
    for i in range(1, repeats + 1):
        shift = delay * i
        if shift >= N:
            break
        channel = 0 if i % 2 else 1
        out[shift:, channel] += signal[: N - shift].mean(axis=1) * feedback**i
    return out


def reverb(signal, length=1.9):
    t = seconds(length)
    result = np.zeros_like(signal)
    for channel in range(2):
        impulse = lowpass(rng.normal(size=len(t)), 6000) * np.exp(-t * 3.3)
        impulse /= np.sqrt(np.sum(impulse**2))
        size = N + len(t)
        wet = np.fft.irfft(np.fft.rfft(signal[:, channel], size) * np.fft.rfft(impulse, size), size)
        result[:, channel] = wet[:N]
    return result


mix = drums * 0.86 + music * 0.74 + ping_pong(delay_send) * 0.6 + reverb(reverb_send) * 0.9 + effects * 0.82
# The single silent moment before the drop, which is what makes the drop hit.
gap_start, gap_end = at(15.5), at(16)
mix[gap_start:gap_end] *= np.linspace(1, 0, gap_end - gap_start)[:, None] ** 3

mix[:, 0] = highpass(mix[:, 0], 28)
mix[:, 1] = highpass(mix[:, 1], 28)
mix = np.tanh(mix / np.percentile(np.abs(mix), 99.7) * 1.15)
fade = np.ones(N)
tail = int(1.2 * SR)
fade[-tail:] = np.linspace(1, 0, tail) ** 1.5
mix *= fade[:, None]
mix *= 0.89 / np.max(np.abs(mix))

with wave.open(os.path.join(ROOT, "public", "music.wav"), "wb") as out:
    out.setnchannels(2)
    out.setsampwidth(2)
    out.setframerate(SR)
    out.writeframes((mix * 32767).astype("<i2").tobytes())

fps = timeline["fps"]
frames = int(BEATS * BEAT * fps)
window = SR // fps
energy = [
    float(np.sqrt(np.mean(mix[max(0, i * window - window // 2) : (i + 1) * window + window // 2] ** 2)))
    for i in range(frames)
]
peak = max(energy)
json.dump([round(value / peak, 3) for value in energy], open(os.path.join(ROOT, "src", "energy.json"), "w"), separators=(",", ":"))


def rms_db(section):
    return 20 * np.log10(np.sqrt(np.mean(section**2)) + 1e-9)


print(f"music.wav {N / SR:.1f}s, peak {np.max(np.abs(mix)):.2f}")
for label, a, b in (("hook", 0, 15.5), ("gap", 15.5, 16), ("drop", 16, 28), ("mid", 28, 40), ("hand-off", 40, 56), ("loop", 56, 64), ("end", 64, 72)):
    print(f"  {label:9} {rms_db(mix[at(a):at(b)]):6.1f} dB RMS")
