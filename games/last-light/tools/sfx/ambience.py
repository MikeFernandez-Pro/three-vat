# The long ambiences (fire_crackling, fire_calm, river_calm, ~20 min each) cut to 20 s seamless loops, as the tree
# page's wind and leaves are: the steadiest stretch of each, its tail crossfaded into its head.
#   python ../tools/sfx/ambience.py scan    the candidate stretches, steadiest first
#   python ../tools/sfx/ambience.py build   the loops, to ../public/sounds/goose as ogg
# Run from _sfx/, where the takes are kept out of git.
import os
import subprocess
import sys
import wave
import numpy as np

SR = 48000
LOOP = 20.0
XFADE = 2.0
GAME = os.path.join('..', 'public', 'sounds', 'goose')
# Which stretch each loop is cut from, s, picked from the scan; mono for the ones heard from a place.
PICKS = {
# The fires carry a deep rumble under 60 Hz no laptop plays: cut, so their level is the crackle's.
    'fire_crackling': {'at': 345.0, 'mono': True, 'rms': -20, 'low': 90},
    'fire_calm': {'at': 130.0, 'mono': True, 'rms': -22, 'low': 90},
    'river_calm': {'at': 392.5, 'mono': False, 'rms': -22, 'low': 150},
}


def decoded(name):
    """The long recording as 48 kHz wav, decoded from the Downloads ogg the first time (~240 MB each)."""
    path = os.path.join('long', name + '.wav')
    if not os.path.exists(path):
        os.makedirs('long', exist_ok=True)
        src = os.path.join(os.path.expanduser('~'), 'Downloads', name + '.ogg')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ar', str(SR), '-ac', '2', '-c:a', 'pcm_s16le', path], check=True)
    return path


def load(name):
    decoded(name)
    with wave.open(os.path.join('long', name + '.wav'), 'rb') as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, 2)
    return a


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-9))


def scan(name):
    a = load(name)
    mono = a.astype(np.float32).mean(axis=1) / 32768
    hop = SR // 10
    frames = mono[: len(mono) // hop * hop].reshape(-1, hop)
    r = db(np.sqrt((frames ** 2).mean(axis=1)))
    win = int((LOOP + XFADE) * 10)
    out = []
    for i in range(0, len(r) - win, 25):
        seg = r[i:i + win]
        med = np.median(seg)
        # Steady: little drift between its halves, few jumps, and no event far over its median.
        drift = abs(seg[: win // 2].mean() - seg[win // 2:].mean())
        spread = seg.std()
        spike = seg.max() - med
        out.append((drift * 2 + spread + max(0, spike - 8), i / 10, med, spread, spike, drift))
    out.sort()
    print(name, f'{len(mono) / SR:.0f}s, median level {np.median(r):.1f} dB')
    for score, t, med, spread, spike, drift in out[:6]:
        print(f'  at {t:7.1f}s  score {score:5.2f}  level {med:6.1f}  spread {spread:4.2f}  spike {spike:5.2f}  drift {drift:4.2f}')
    return out[0][1]


def build(name, at, mono, rms, low):
    piece = os.path.join('long', name + '_piece.wav')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(at), '-t', str(LOOP + XFADE + 0.1), '-i', decoded(name),
                    '-af', f'highpass=f={low},highpass=f={low}', '-ac', '1' if mono else '2', '-c:a', 'pcm_s16le', piece], check=True)
    with wave.open(piece, 'rb') as w:
        ch = w.getnchannels()
        s = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, ch).astype(np.float64) / 32768
    n, x = int(LOOP * SR), int(XFADE * SR)
    t = np.linspace(0, 1, x)[:, None]
    out = s[:n].copy()
    out[:x] = s[:x] * np.sqrt(t) + s[n:n + x] * np.sqrt(1 - t)
    out *= 10 ** (rms / 20) / np.sqrt((out ** 2).mean())
    out *= min(1, 10 ** (-1 / 20) / np.abs(out).max())
    master = os.path.join('master', name + '.wav')
    with wave.open(master, 'wb') as w:
        w.setnchannels(out.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(out, -1, 1) * 32767).round().astype(np.int16).tobytes())
    # Vorbis as the tree page's loops: it wraps without a gap; mono ones at a lower rate.
    q = '3' if mono else '4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', master, '-c:a', 'libvorbis', '-q:a', q, os.path.join(GAME, name + '.ogg')], check=True)
    size = os.path.getsize(os.path.join(GAME, name + '.ogg'))
    print(f'{name}: {at}s on, {"mono" if mono else "stereo"}, peak {db(np.abs(out).max()):.1f}, {size // 1024} KB')


if sys.argv[1] == 'scan':
    for name in PICKS:
        scan(name)
else:
    for name, pick in PICKS.items():
        build(name, pick['at'], pick['mono'], pick['rms'], pick['low'])
