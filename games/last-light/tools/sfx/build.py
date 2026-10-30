# The goose game's sounds, cut from the ElevenLabs takes in src/ (folded to mono in mono/) into
# ../public/sounds/goose, each file named by its take's number as ElevenLabs gave it (call_3 is call take #3), and the
# takes each sound has written to ../src/goosetakes.json for the game. A take banned in ../src/goosebans.json (the
# page's takes panel saves it) is left out. Run from _sfx/, where the takes are kept out of git: python ../tools/sfx/build.py
import glob
import json
import os
import subprocess
import numpy as np
from lib import SR, load, save, db, cut, active_region, active_rms, loop, gate, onsets, rms_frames

MONO = 'mono'
MASTER = 'master'
GAME = os.path.join('..', 'public', 'sounds', 'goose')
TAKES = os.path.join('..', 'src', 'goosetakes.json')
BANS = os.path.join('..', 'src', 'goosebans.json')
os.makedirs(MASTER, exist_ok=True)
os.makedirs(GAME, exist_ok=True)

PEAK_CAP = 10 ** (-1 / 20)
bans = json.load(open(BANS, encoding='utf-8')) if os.path.exists(BANS) else {}
takes = {}

# What this script makes is made again from nothing: the ambience loops (ambience.py), the swarm (swarm.py, from the
# rat takes and freesound's) and the tree page's wind and leaves are not its own.
OWN_NOT = {'fire_crackling.ogg', 'fire_calm.ogg', 'river_calm.ogg', 'wind.ogg', 'leaves.ogg', 'swarm_far.ogg', 'swarm_near.ogg', 'swarm_edge.ogg'}
for path in glob.glob(os.path.join(GAME, '*')):
    if os.path.basename(path) not in OWN_NOT:
        os.remove(path)


def kept(title, order=(1, 2, 3, 4)):
    """The title's takes there are (ElevenLabs numbers them 1 to 4; a take not downloaded is not wanted) and not banned, in the order given."""
    return [k for k in order if k not in bans.get(title, []) and os.path.exists(os.path.join(MONO, f'{title}_{k}.wav'))]


def take(name):
    return load(os.path.join(MONO, name + '.wav'))


def trimmed(name, fade_out=0.06, post=0.12):
    a = take(name)
    t0, t1 = active_region(a, post=post)
    return cut(a, t0, t1, fade_out=fade_out)


def level(group, target_db):
    """Every variant to the same loudness, the group pulled down together if any would clip."""
    g = [s * (10 ** (target_db / 20) / active_rms(s)) for s in group]
    over = max((np.abs(s).max() for s in g), default=0) / PEAK_CAP
    return [s / over for s in g] if over > 1 else g


def write(sound, label, a, kind='mp3'):
    """The sound's take `label` ('' for a sound of one file) to the game, as mp3 or wav, its master kept here."""
    name = f'{sound}_{label}' if label else sound
    master = os.path.join(MASTER, name + '.wav')
    save(master, a)
    if kind == 'mp3':
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', master, '-c:a', 'libmp3lame', '-q:a', '2', os.path.join(GAME, name + '.mp3')], check=True)
    else:
        save(os.path.join(GAME, name + '.wav'), a)
    takes.setdefault(sound, []).append(label)
    print(f'{name:14s} {len(a) / SR:5.2f}s peak {db(np.abs(a).max()):6.1f} active {db(active_rms(a)):6.1f}')


def each(title, sound, cutter, target_db):
    """Every take of the title not banned, cut, levelled together, and written as the sound's takes by number."""
    ks = kept(title)
    for k, s in zip(ks, level([cutter(k) for k in ks], target_db)):
        write(sound, str(k), s)


# A lost gosling: one peep each; the game strings them into bursts.
each('call', 'call', lambda k: trimmed(f'call_{k}'), -18)
# Her alarm honk; wings, the panicked burst; the hiss, faded off where the take was cut short.
each('honk', 'honk', lambda k: trimmed(f'honk_{k}'), -14)
each('wings', 'wings', lambda k: trimmed(f'wings_{k}'), -18)
each('hiss', 'hiss', lambda k: trimmed(f'hiss_{k}', fade_out=0.15), -20)

# The intro's fright: her big honk, her wings bursting open just after it, from the takes liked best still kept.
honk, wings = kept('honk', (3, 4, 1, 2)), kept('wings', (3, 2, 4, 1))
if honk and wings:
    h = level([trimmed(f'honk_{honk[0]}')], -14)[0]
    w = level([trimmed(f'wings_{wings[0]}')], -18)[0] * 10 ** (-4 / 20)
    at = int(0.12 * SR)
    fright = np.zeros(max(len(h), at + len(w)))
    fright[:len(h)] += h
    fright[at:at + len(w)] += w
    write('fright', '', fright * min(1, PEAK_CAP / np.abs(fright).max()))

# Her own sounds as she walks: a soft questioning honk, and low muttered grunts, the quiet between them pulled down.
each('query', 'query', lambda k: trimmed(f'query_{k}'), -20)
MUTTERS = {1: (0.06, 1.25), 2: (0.04, 1.2), 3: (0.22, 1.2), 4: (0.4, 1.4)}
each('mutter', 'mutter', lambda k: gate(cut(take(f'mutter_{k}'), *MUTTERS[k]), below_peak_db=22), -22)

# The opening's strike: its crack and the thunder rolling away, the roll's tail faded off.
each('thunder', 'thunder', lambda k: cut(take(f'thunder_{k}'), max(0, active_region(take(f'thunder_{k}'), below_peak_db=45)[0] - 0.02), 5.0, fade_in=0.002, fade_out=1.2), -14)
# Her torch catching at a fire.
each('ignite', 'ignite', lambda k: cut(take(f'ignite_{k}'), max(0, active_region(take(f'ignite_{k}'), below_peak_db=45)[0] - 0.01), 1.45, fade_in=0.003, fade_out=0.4), -18)
# The cage's padlock: the take's last turn of the key, the lock giving and the door creaking open.
each('padlock', 'padlock', lambda k: cut(take(f'padlock_{k}'), 1.40, 3.05, fade_in=0.005, fade_out=0.5), -18)

# Footsteps, one a shot for the walk to fire: the four loudest steps of each take, named by take and order (1a, 1b..).
steps, labels = [], []
for k in kept('steps'):
    a = take(f'steps_{k}')
    r, hop = rms_frames(a)
    d = db(r)
    found = [(d[int(t * 100):int(t * 100) + 6].max(), t) for t in onsets(a, rise_db=5, gap_s=0.2)]
    for j, (_, t) in enumerate(sorted(sorted(f for f in found if f[0] >= -54)[-4:], key=lambda f: f[1])):
        steps.append(cut(a, max(0, t - 0.015), t + 0.26, fade_in=0.003, fade_out=0.12))
        labels.append(f'{k}{"abcd"[j]}')
for label, s in zip(labels, level(steps, -24)):
    write('step', label, s)

# Her paddling, a loop: wav, so it wraps without the mp3 gap, from the take liked best still kept.
paddle = kept('paddle', (3, 2, 1, 4))
if paddle:
    write('paddle_loop', '', level([loop(take(f'paddle_{paddle[0]}'), 0.05, 3.50, 0.30)], -28)[0], kind='wav')

# The well's winch, a loop as ElevenLabs made it, wrapping as it was: wav, so it wraps without the mp3 gap.
for k, s in zip(kept('winch'), level([take(f'winch_{k}') for k in kept('winch')], -22)):
    write('winch', str(k), s, kind='wav')

# A ghost's moan, its echo's tail kept and faded.
each('moan', 'moan', lambda k: cut(take(f'moan_{k}'), max(0, active_region(take(f'moan_{k}'), below_peak_db=40)[0] - 0.05), 3.05, fade_in=0.01, fade_out=0.6), -22)
# Her death: the torch choking out, the rats rushing in, a swirling whoosh closing to nothing, as the dark swirls in
# over the screen; whole, as the take was made, faded in from where it starts.
each('death', 'death', lambda k: cut(take(f'death_{k}'), max(0, active_region(take(f'death_{k}'), below_peak_db=45)[0] - 0.01), 1.68, fade_in=0.005, fade_out=0.2), -18)

# A sound every take of which is banned is still listed, with none, so the game asks for no file of it.
for sound in ('call', 'honk', 'wings', 'hiss', 'fright', 'query', 'mutter', 'thunder', 'ignite', 'padlock', 'step', 'paddle_loop', 'winch', 'moan', 'death'):
    takes.setdefault(sound, [])
with open(TAKES, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(takes, f, indent=2)
    f.write('\n')
print('takes:', ', '.join(f'{s} {len(t)}' for s, t in takes.items()))
