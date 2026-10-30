# The sound tools' shared wave reading and writing, levels, and cuts.
import wave
import numpy as np

SR = 48000


def load(path):
    with wave.open(path, 'rb') as w:
        assert w.getframerate() == SR and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768


def save(path, a):
    a = np.clip(a, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((a * 32767).round().astype(np.int16).tobytes())


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-9))


def rms_frames(a, hop_s=0.01):
    hop = int(SR * hop_s)
    f = a[: len(a) // hop * hop].reshape(-1, hop)
    return np.sqrt((f ** 2).mean(axis=1)), hop


def onsets(a, rise_db=9, gap_s=0.12):
    """Times, s, where the 10 ms level jumps rise_db over the 30 ms before it."""
    r, hop = rms_frames(a)
    d = db(r)
    out = []
    for i in range(3, len(d)):
        if d[i] - d[i - 3:i].mean() > rise_db and d[i] > d.max() - 30:
            if not out or (i * hop / SR) - out[-1] > gap_s:
                out.append(i * hop / SR)
    return out


def cut(a, t0, t1, fade_in=0.004, fade_out=0.05):
    s = a[int(t0 * SR): int(t1 * SR)].copy()
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    if fi:
        s[:fi] *= np.linspace(0, 1, fi) ** 2
    if fo:
        s[-fo:] *= np.linspace(1, 0, fo) ** 2
    return s


def active_region(a, below_peak_db=35, pre=0.02, post=0.12):
    """The span round the loudest 10 ms frame, out to where the level falls below_peak_db under it."""
    r, hop = rms_frames(a)
    d = db(r)
    top = int(d.argmax())
    lo = top
    while lo > 0 and d[lo - 1] > d[top] - below_peak_db:
        lo -= 1
    hi = top
    while hi < len(d) - 1 and d[hi + 1] > d[top] - below_peak_db:
        hi += 1
    return max(0, lo * hop / SR - pre), min(len(a) / SR, (hi + 1) * hop / SR + post)


def active_rms(a):
    r, _ = rms_frames(a)
    loud = r[r > r.max() * 0.25]
    return np.sqrt((loud ** 2).mean())


def loop(a, t0, length, xfade):
    """A seamless loop of `length` s from t0: the material just past the end crossfades into the head."""
    n, x = int(length * SR), int(xfade * SR)
    s = a[int(t0 * SR): int(t0 * SR) + n + x]
    assert len(s) == n + x, 'loop runs past the take'
    t = np.linspace(0, 1, x)
    out = s[:n].copy()
    out[:x] = s[:x] * np.sqrt(t) + s[n:n + x] * np.sqrt(1 - t)
    return out


def gate(a, below_peak_db=28, depth_db=-14, release_s=0.06):
    """The room between sounds pulled down by depth_db: frames more than below_peak_db under the loudest, eased."""
    r, hop = rms_frames(a)
    d = db(r)
    want = np.where(d > d.max() - below_peak_db, 0.0, depth_db)
    # Opens at once, closes over release_s, and opens a frame early so no onset is clipped.
    want = np.maximum(want, np.roll(want, -1))
    k = np.exp(-hop / SR / release_s)
    g = np.empty_like(want)
    g[0] = want[0]
    for i in range(1, len(want)):
        g[i] = want[i] if want[i] > g[i - 1] else g[i - 1] * k + want[i] * (1 - k)
    per = np.interp(np.arange(len(a)), np.arange(len(g)) * hop + hop / 2, g)
    return a * 10 ** (per / 20)
