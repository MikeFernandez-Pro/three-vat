# The swarm, a silent horde: hundreds of rats running round her and not one calling, only their thousands of small
# steps, each from its own place, near and clear or far and dull, panned round the listener; knots of them running
# past, sweeping from side to side; under them the bodies, low noise in short swells. The steps and runs are cut from
# small animals scurrying through leaves and grass and a rat crunching a rusk (freesound CC0, fs_wav/).
# Outdoors: no room, the far rats only quieter and duller. Writes the game's three rings of it, each a seamless 20 s
# loop at one shared level (../public/sounds/goose/swarm_{far,near,edge}.ogg, their masters in swarm/): far, 14 to
# 32 m off; near, 5 to 15 m; and the edge, the rats at the light's edge, 2.5 to 5.5 m and running hardest. With
# --approach, also swarm/approach.wav, the three as one swarm heard far off, coming, then at the light's edge, to
# listen to. Run from _sfx/, where the takes are kept out of git: python ../tools/sfx/swarm.py
import os
import subprocess
import sys
import wave
import numpy as np
from lib import SR, load, db, rms_frames, active_region, cut

rng = np.random.default_rng(7)
OUT = 'swarm'
os.makedirs(OUT, exist_ok=True)


def save2(path, lr):
    peak = np.abs(lr).max()
    lr = lr * (10 ** (-1 / 20) / peak) if peak > 10 ** (-1 / 20) else lr
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(lr.T, -1, 1) * 32767).round().astype(np.int16).tobytes())
    r = np.sqrt((lr ** 2).mean())
    print(f'{path}: {lr.shape[1] / SR:.1f}s rms {db(r):.1f} dB')


def band(a, lo=None, hi=None):
    """Second-order high- and low-pass shapes, in the spectrum."""
    f = np.fft.rfftfreq(len(a), 1 / SR)
    g = np.ones_like(f)
    if lo:
        g /= np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        g /= np.sqrt(1 + (f / hi) ** 4)
    return np.fft.irfft(np.fft.rfft(a) * g, len(a))


def fades(e, fin, fout):
    fi, fo = max(1, int(fin * SR)), max(1, int(fout * SR))
    e[:fi] *= np.linspace(0, 1, fi) ** 2
    e[-fo:] *= np.linspace(1, 0, fo) ** 2
    return e


def bed(path, lo, part=50):
    """A long take grains are cut from: only its busier frames kept, at one loudness."""
    a = band(load(path), lo=lo)
    r, hop = rms_frames(a)
    busy = np.repeat(r > np.percentile(r, part), hop)
    a = a[: len(busy)][busy]
    r, _ = rms_frames(a)
    return a / np.sqrt((r ** 2).mean()) * 0.1


# The scurry: small animals running through leaves and grass, a creature's rustle for the bigger bodies. (A racoon's,
# 637444, whistles at 1 kHz through most of it: left out; and every rat's voice, the squeaks grating and the horde
# silent.) The steps are cut from these and from a rat crunching a rusk.
scurries = [bed(p, lo) for p, lo in (('fs_wav/fs_415203.wav', 150), ('fs_wav/fs_364712.wav', 200), ('fs_wav/fs_872940.wav', 80))]
steps = scurries + [bed('fs_wav/fs_143250.wav', 300)]


def shift(e, semis):
    ratio = 2 ** (semis / 12)
    return np.interp(np.arange(0, len(e) - 1, ratio), np.arange(len(e)), e)


class Bus:
    """Dry and reverb-sent stereo, `n` samples, wrapping round if `wrap` (a loop)."""

    def __init__(self, n, wrap):
        self.dry = np.zeros((2, n))
        self.wet = np.zeros((2, n))
        self.n, self.wrap = n, wrap

    def put(self, e, t, d, width, send, pan=None):
        """`e` at `t` s, `d` m off: as loud and as dull as so far, panned at `pan`, else somewhere within `width`."""
        e = band(np.pad(e, (0, 256)), hi=float(np.clip(7000 * (2 / d) ** 0.6, 1800, 7000))) * min(1.0, 2 / d)
        p = rng.uniform(-1, 1) * width if pan is None else pan
        lag = int(abs(p) * 0.0006 * SR)
        ear = [np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)]
        far = 0 if p > 0 else 1
        at = int(t * SR)
        for c in (0, 1):
            s = np.pad(e, (lag if c == far else 0, 0)) * ear[c]
            for into, amount in ((self.dry, 1 - send), (self.wet, send)):
                idx = at + np.arange(len(s))
                if self.wrap:
                    np.add.at(into[c], idx % self.n, s * amount)
                else:
                    keep = idx < self.n
                    into[c, idx[keep]] += s[keep] * amount

    def mix(self):
        """Outdoors: no room, only the ground's bounce and the trees' faint scatter, gone in a tenth of a second."""
        ir_n = int(0.3 * SR)
        t = np.arange(ir_n) / SR
        out = self.dry.copy()
        for c in (0, 1):
            ir = band(rng.standard_normal(ir_n), hi=3500) * np.exp(-t / 0.05) * (rng.uniform(size=ir_n) < 0.08)
            ir[: int(0.004 * SR)] = 0
            ir /= np.sqrt((ir ** 2).sum())
            ir[int(0.004 * SR)] += 0.5
            n = self.n if self.wrap else self.n + ir_n
            wet = np.fft.irfft(np.fft.rfft(self.wet[c], n) * np.fft.rfft(ir, n), n)
            out[c] += wet[: self.n] * 0.6
        return out


def swarm(length, wrap, front, many, boil, depth=18):
    """The swarm over `length` s: its nearest rats `front(t)` m off, the rats spread `depth` m back from there; `many(t)` of
    its fullest heard; `boil(t)` 0 calm to 1 running hardest, its steps and runs the thicker. Nothing near is brighter
    than 7 kHz. The mass moves in surges, a few slow waves a loop (whole cycles, so a loop wraps)."""
    n = int(length * SR)
    step_bus, scurry_bus, body_bus = (Bus(n, wrap) for _ in range(3))
    waves = [(max(1, round(rng.uniform(0.25, 0.7) * length)) / length, rng.uniform(0, 2 * np.pi)) for _ in range(3)]

    def surge(t):
        return 0.7 + 0.3 * float(np.mean([np.sin(2 * np.pi * f * t + ph) for f, ph in waves]))

    def where(t):
        f = front(t)
        return float(np.sqrt(f * f + rng.uniform() * ((f + depth) ** 2 - f * f)))

    def width(d):
        return float(np.clip(6 / d, 0.3, 1))

    def send(d):
        return 0.03 + 0.15 * min(1, d / 30)

    def stream(rate, make):
        t = 0.0
        while True:
            t += rng.exponential(1 / rate)
            if t >= length:
                return
            make(t)

    def step(t):
        """One small foot coming down: the sharpest moment of a 60 ms stretch of a scurry, 15 to 45 ms of it."""
        if rng.uniform() > many(t) * surge(t) * (1 + boil(t)) / 2:
            return
        d = where(t)
        src = steps[rng.integers(len(steps))]
        look = int(0.06 * SR)
        at = rng.integers(len(src) - look - int(0.05 * SR))
        at += max(0, int(np.abs(src[at:at + look]).argmax()) - int(0.003 * SR))
        k = int(rng.uniform(0.015, 0.045) * SR)
        e = fades(src[at:at + k].copy(), 0.001, k / SR * 0.6)
        step_bus.put(shift(e, float(rng.normal(0, 2))), t, d, width(d), send(d))

    def run(t):
        """A knot of rats running past: their rustle sweeping from one side to the other, nearest midway."""
        if rng.uniform() > many(t) * surge(t) * (1 + boil(t)) / 2:
            return
        d = where(t)
        w = width(d)
        lasts = rng.uniform(0.6, 2.0)
        p0 = rng.uniform(-1, 1) * w
        p1 = float(np.clip(p0 + rng.choice((-1, 1)) * rng.uniform(0.6, 1.4) * w, -1, 1))
        src = scurries[rng.integers(len(scurries))]
        tg = t
        while tg < t + lasts:
            x = (tg - t) / lasts
            k = int(rng.uniform(0.04, 0.14) * SR)
            at = rng.integers(len(src) - k)
            e = fades(src[at:at + k].copy(), k / SR * 0.3, k / SR * 0.4) * np.sin(np.pi * x) * rng.uniform(0.6, 1)
            dg = d * (1 - 0.3 * np.sin(np.pi * x))
            scurry_bus.put(shift(e, float(rng.normal(0, 1.5))), tg, dg, w, send(dg), pan=p0 + (p1 - p0) * x)
            tg += rng.exponential(1 / 35)

    def body(t):
        if rng.uniform() > many(t) * surge(t):
            return
        d = where(t)
        k = int(rng.uniform(0.1, 0.3) * SR)
        # The low end carries: it fades as the root of how near, not as how near.
        e = band(rng.standard_normal(k), lo=60, hi=350) * np.hanning(k) * 0.3 / np.sqrt(min(1.0, 2 / d))
        body_bus.put(e, t, d, width(d), send(d))

    # At their thickest, boiling: 1400 steps a second, 24 knots running past; calm, half.
    stream(1400, step)
    stream(24, run)
    stream(90, body)
    return {'steps': step_bus.mix(), 'scurry': scurry_bus.mix(), 'body': body_bus.mix()}


LEVELS = {'steps': 0.6, 'scurry': 1.0, 'body': 0.7}


def mixed(stems, name, at=None):
    """The stems as mixed, each layer's share of the whole printed, over `at` (s, s) if given."""
    out = sum(LEVELS[k] * s for k, s in stems.items())
    if at:
        a, b = int(at[0] * SR), int(at[1] * SR)
        whole = (out[:, a:b] ** 2).mean()
        print(name, at, '  '.join(f'{k} {100 * ((LEVELS[k] * s[:, a:b]) ** 2).mean() / whole:4.0f}%' for k, s in stems.items()))
    return out


def smooth(t, t0, t1):
    x = np.clip((t - t0) / (t1 - t0), 0, 1)
    return x * x * (3 - 2 * x)


GAME = os.path.join('..', 'public', 'sounds', 'goose')
RINGS = {
    'far': dict(front=lambda t: 14, boil=lambda t: 0, depth=18),
    'near': dict(front=lambda t: 5, boil=lambda t: 0.2, depth=10),
    'edge': dict(front=lambda t: 2.5, boil=lambda t: 1, depth=3),
}
rings = {k: mixed(swarm(20, True, many=lambda t: 1, **ring), k, (0, 20)) for k, ring in RINGS.items()}
# One level for the three, the near ring's at -24 dB, none of them past -1 dB.
scale = min(10 ** (-24 / 20) / np.sqrt((rings['near'] ** 2).mean()), 10 ** (-1 / 20) / max(np.abs(r).max() for r in rings.values()))
for k, r in rings.items():
    master = f'{OUT}/swarm_{k}.wav'
    save2(master, r * scale)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', master, '-c:a', 'libvorbis', '-q:a', '4', os.path.join(GAME, f'swarm_{k}.ogg')], check=True)

if '--approach' in sys.argv:
    # Far off and coming: silence, first heard at 2 s, 40 m off closing to the light's edge, 2.5 m, by 24 s; agitated from 22 s.
    stems = swarm(
        34, False,
        front=lambda t: 2.5 + 37.5 * (1 - smooth(t, 2, 24)),
        many=lambda t: smooth(t, 2, 7),
        boil=lambda t: smooth(t, 22, 28),
    )
    save2(f'{OUT}/approach.wav', mixed(stems, 'approach', (26, 34)))
