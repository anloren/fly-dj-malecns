#!/usr/bin/env python3
"""Write two short loopable DJ beds (CC0 / original synthesis)."""

from __future__ import annotations

import struct
import wave
from pathlib import Path

import numpy as np


def write_wav(path: Path, stereo: np.ndarray, sr: int) -> None:
    stereo = np.clip(stereo, -1, 1)
    pcm = (stereo * 32767.0).astype(np.int16)
    with wave.open(str(path), "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def env_exp(n: int, tau: float) -> np.ndarray:
    t = np.arange(n, dtype=np.float32)
    return np.exp(-t / tau)


def kick(n: int, sr: int, f0: float = 52.0) -> np.ndarray:
    t = np.arange(n, dtype=np.float32) / sr
    freq = f0 * np.exp(-t * 12)
    body = np.sin(2 * np.pi * freq * t) * env_exp(n, sr * 0.18)
    click = np.sin(2 * np.pi * 1800 * t) * env_exp(n, sr * 0.004) * 0.25
    return (body + click).astype(np.float32)


def hat(n: int, sr: int, open_hat: bool) -> np.ndarray:
    rng = np.random.default_rng(3)
    noise = rng.standard_normal(n).astype(np.float32)
    # cheap highpass
    y = np.zeros(n, dtype=np.float32)
    a = 0.45
    for i in range(1, n):
        y[i] = a * (y[i - 1] + noise[i] - noise[i - 1])
    tau = sr * (0.12 if open_hat else 0.028)
    return y * env_exp(n, tau) * (0.35 if open_hat else 0.22)


def snare(n: int, sr: int) -> np.ndarray:
    rng = np.random.default_rng(9)
    t = np.arange(n, dtype=np.float32) / sr
    tone = np.sin(2 * np.pi * 190 * t) * env_exp(n, sr * 0.06)
    noise = rng.standard_normal(n).astype(np.float32) * env_exp(n, sr * 0.08)
    return (0.35 * tone + 0.55 * noise).astype(np.float32)


def bass_note(n: int, sr: int, freq: float, wobble: float) -> np.ndarray:
    t = np.arange(n, dtype=np.float32) / sr
    wob = 1 + 0.12 * np.sin(2 * np.pi * wobble * t)
    s = np.sin(2 * np.pi * freq * t * wob)
    s += 0.35 * np.sin(2 * np.pi * freq * 2 * t)
    att = np.minimum(1.0, np.linspace(0, 8, n, dtype=np.float32))
    rel = env_exp(n, sr * 0.42)
    return (s * att * rel * 0.28).astype(np.float32)


def pad(n: int, sr: int, freqs: list[float], detune: float) -> np.ndarray:
    t = np.arange(n, dtype=np.float32) / sr
    out = np.zeros(n, dtype=np.float32)
    for i, f in enumerate(freqs):
        out += np.sin(2 * np.pi * (f + detune * i) * t) * (0.08 / len(freqs))
        out += np.sin(2 * np.pi * (f * 1.01) * t) * (0.04 / len(freqs))
    out *= 0.5 + 0.5 * np.sin(2 * np.pi * 0.25 * t)
    return out.astype(np.float32)


def place(buf: np.ndarray, sound: np.ndarray, at: int) -> None:
    end = min(len(buf), at + len(sound))
    buf[at:end] += sound[: end - at]


def bed_a(sr: int, seconds: float) -> np.ndarray:
    n = int(sr * seconds)
    L = np.zeros(n, dtype=np.float32)
    R = np.zeros(n, dtype=np.float32)
    step = int(sr * 0.5)  # 120 BPM
    k = kick(int(sr * 0.45), sr, 50)
    h = hat(int(sr * 0.12), sr, False)
    ho = hat(int(sr * 0.22), sr, True)
    notes = [55.0, 55.0, 65.41, 49.0]  # A1 A1 C2 G1
    for i, t0 in enumerate(range(0, n, step)):
        place(L, k * 0.95, t0)
        place(R, k * 0.9, t0)
        if i % 2 == 1:
            place(L, h * 0.7, t0 + step // 2)
            place(R, h, t0 + step // 2)
        if i % 4 == 3:
            place(L, ho * 0.8, t0 + step // 2)
            place(R, ho * 0.6, t0 + step // 2)
        bn = bass_note(step, sr, notes[i % 4], 1.5 + (i % 3) * 0.2)
        place(L, bn * 0.9, t0)
        place(R, bn * 1.05, t0)
    p = pad(n, sr, [220, 277.2, 329.6], 0.4)
    L += p * 0.7
    R += np.roll(p, 80) * 0.8
    return np.stack([L, R], axis=1)


def bed_b(sr: int, seconds: float) -> np.ndarray:
    n = int(sr * seconds)
    L = np.zeros(n, dtype=np.float32)
    R = np.zeros(n, dtype=np.float32)
    step = int(sr * 0.5)
    k = kick(int(sr * 0.38), sr, 46)
    s = snare(int(sr * 0.28), sr)
    h = hat(int(sr * 0.1), sr, False)
    ho = hat(int(sr * 0.3), sr, True)
    notes = [73.42, 65.41, 82.41, 61.74]  # D2 C2 E2 B1
    for i, t0 in enumerate(range(0, n, step)):
        if i % 4 in (0, 3):
            place(L, k * 0.75, t0)
            place(R, k * 0.85, t0)
        if i % 4 == 2:
            place(L, s * 0.85, t0)
            place(R, s * 0.7, t0)
        place(L, h * (0.5 + 0.2 * (i % 2)), t0 + step // 2)
        place(R, h * 0.7, t0 + step // 4)
        if i % 8 == 6:
            place(L, ho, t0)
            place(R, ho * 0.8, t0 + 200)
        bn = bass_note(int(step * 1.1), sr, notes[i % 4], 3.2)
        place(L, bn, t0)
        place(R, bn * 0.85, t0)
    p = pad(n, sr, [196, 247, 311, 392], -0.6)
    L += np.roll(p, 40) * 0.85
    R += p * 0.65
    return np.stack([L, R], axis=1)


def main() -> None:
    out = Path("/workspace/public/audio")
    out.mkdir(parents=True, exist_ok=True)
    sr = 22050
    seconds = 8.0
    a = bed_a(sr, seconds)
    b = bed_b(sr, seconds)
    # soft limiter
    for stereo in (a, b):
        peak = np.max(np.abs(stereo)) + 1e-6
        stereo *= 0.89 / peak
    write_wav(out / "deck-a.wav", a, sr)
    write_wav(out / "deck-b.wav", b, sr)
    print("wrote", out / "deck-a.wav", (out / "deck-a.wav").stat().st_size)
    print("wrote", out / "deck-b.wav", (out / "deck-b.wav").stat().st_size)


if __name__ == "__main__":
    main()
