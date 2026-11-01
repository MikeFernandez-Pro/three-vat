# Each take of a sound side by side, by its loudness, noise floor and brightness. From _sfx/: python ../tools/sfx/analyse.py <folder> <sound>
import sys, wave, glob, os
import numpy as np

BARS = ' .:-=+*#%@'

def load(path):
    with wave.open(path, 'rb') as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        a = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    return a.reshape(-1, ch).mean(axis=1), sr

def db(x):
    return 20 * np.log10(max(x, 1e-9))

for path in sorted(glob.glob(os.path.join(sys.argv[1], sys.argv[2] + '_*.wav'))):
    a, sr = load(path)
    hop = int(sr * 0.05)
    frames = a[: len(a) // hop * hop].reshape(-1, hop)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    lv = np.clip((np.array([db(r) for r in rms]) + 60) / 60, 0, 0.999)
    env = ''.join(BARS[int(v * len(BARS))] for v in lv)
    # spectral centroid of the loud part, and the noise floor of the quietest tenth
    loud = frames[rms > rms.max() * 0.3]
    spec = np.abs(np.fft.rfft(loud * np.hanning(hop), axis=1)).mean(axis=0)
    f = np.fft.rfftfreq(hop, 1 / sr)
    centroid = (spec * f).sum() / spec.sum()
    floor = db(np.sort(rms)[max(1, len(rms) // 10)])
    print(f'{os.path.basename(path):14s} {len(a)/sr:4.1f}s peak {db(np.abs(a).max()):6.1f} rms {db(np.sqrt((a**2).mean())):6.1f} floor {floor:6.1f} cent {centroid:5.0f}Hz |{env}|')
