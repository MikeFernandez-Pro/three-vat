"""Make the floor's painting and its normal map tile, with one cut for both.

    python tools/seamless.py <colour.png> <normal.png> [--band 0.2]

Writes public/textures/floor.png and floor-normal.png. The painting's edges do
not meet, so each edge is overlapped with the opposite one by `band` of the
width, and a seam is cut through the overlap where the two agree most (least
squared colour difference along a path one pixel a row), which runs along the
dark grout rather than across a stone. Pixels are chosen, never blended, so
nothing ghosts. The normal map takes the same crop and the same cut, so its
relief stays under the stone it was painted for. Both come out `band` smaller.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def seam(cost: np.ndarray, start: int | None = None, end: int | None = None) -> np.ndarray:
    """
    The column per row of the least-cost top-to-bottom path through `cost`
    (rows x band), moving at most one column a row; from `start` and to `end`
    where given.
    """
    h, b = cost.shape
    total = cost.copy()
    if start is not None:
        total[0] = np.inf
        total[0, start] = cost[0, start]
    back = np.zeros((h, b), dtype=np.int32)
    for y in range(1, h):
        prev = total[y - 1]
        left = np.concatenate(([np.inf], prev[:-1]))
        right = np.concatenate((prev[1:], [np.inf]))
        choices = np.stack((left, prev, right))
        pick = np.argmin(choices, axis=0)
        total[y] += choices[pick, np.arange(b)]
        back[y] = np.arange(b) + pick - 1
    path = np.zeros(h, dtype=np.int32)
    path[-1] = int(np.argmin(total[-1])) if end is None else end
    for y in range(h - 1, 0, -1):
        path[y - 1] = back[y, path[y]]
    return path


def wrap_columns(images: list[np.ndarray], band: int) -> list[np.ndarray]:
    """Each image cropped and cut so its last column continues into its first; the cut is found on the first image."""
    guide = images[0].astype(np.float32)
    w = guide.shape[1]
    right = guide[:, w - band :]
    left = guide[:, :band]
    cost = ((right - left) ** 2).sum(axis=2)
    # The first and last rows are neighbours once the other axis wraps too, so
    # the cut must end where it starts: the free path's end, and again from it.
    closed = int(seam(cost)[-1])
    path = seam(cost, start=closed, end=closed)
    from_left = np.arange(band)[None, :] >= path[:, None]
    out = []
    for image in images:
        band_pixels = np.where(from_left[..., None], image[:, :band], image[:, w - band :])
        out.append(np.concatenate((image[:, band : w - band], band_pixels), axis=1))
    return out


def wrap_rows(images: list[np.ndarray], band: int) -> list[np.ndarray]:
    turned = [np.transpose(i, (1, 0, 2)) for i in images]
    return [np.transpose(i, (1, 0, 2)) for i in wrap_columns(turned, band)]


def seam_error(image: np.ndarray) -> tuple[float, float]:
    """Mean absolute difference across the wrap, columns and rows, 0-255."""
    i = image.astype(np.float32)
    return float(np.abs(i[:, -1] - i[:, 0]).mean()), float(np.abs(i[-1] - i[0]).mean())


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    band_share = 0.2
    if '--band' in sys.argv:
        band_share = float(sys.argv[sys.argv.index('--band') + 1])
    colour_path, normal_path = args[:2]
    colour = np.asarray(Image.open(colour_path).convert('RGB'))
    normal = np.asarray(Image.open(normal_path).convert('RGB'))
    if colour.shape != normal.shape:
        raise SystemExit(f'the two images differ in size: {colour.shape} vs {normal.shape}')
    band = int(round(colour.shape[1] * band_share))
    print(f'before: seam error columns/rows {seam_error(colour)}')
    colour, normal = wrap_columns([colour, normal], band)
    colour, normal = wrap_rows([colour, normal], band)
    print(f'after:  seam error columns/rows {seam_error(colour)}  size {colour.shape[1]}x{colour.shape[0]}')
    out = Path(__file__).resolve().parent.parent / 'public' / 'textures'
    Image.fromarray(colour).save(out / 'floor.png', optimize=True)
    Image.fromarray(normal).save(out / 'floor-normal.png', optimize=True)
    print(f'wrote {out / "floor.png"} and floor-normal.png')


if __name__ == '__main__':
    main()
