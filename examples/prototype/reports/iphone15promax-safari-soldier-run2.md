## Soldier.glb — soldier

WebGL2 · Apple GPU (iPhone 15 Pro Max, A17 Pro, Safari)

**Frame time** (no GPU timer in this browser — wall clock around 8 renders and a 1-pixel readback; read the ratios, not the absolutes; best of 90)

| encoding | instances | best ms | vs VAT | median | max | n | |
| --- | --- | --- | --- | --- | --- | --- | --- |
| vat | 340 | 7.250 | 1.00x | 10.875 | 18.875 | 90 | **SATURATED** |
| mat4-lerp | 340 | 5.375 | 0.74x | 9.500 | 18.000 | 90 | **SATURATED** |
| mat4-near | 340 | 4.250 | 0.59x | 7.625 | 19.375 | 90 | |
| qt-near | 340 | 4.250 | 0.59x | 7.500 | 19.000 | 90 | |
| qt-slerp | 340 | 4.375 | 0.60x | 8.125 | 15.125 | 90 | **SATURATED** |

Rows marked SATURATED spent more than 8 ms a frame and were fighting the display cadence. Every number in such a row is an upper bound, and the ratio between two of them says nothing — both are pinned against the same ceiling.

**Cost of the bake**

| encoding | texture | vs VAT | rows | width | bake |
| --- | --- | --- | --- | --- | --- |
| VAT (control) | 25.2 MB | 1.00x | 111 | 7434 verts | 366 ms |
| mat4-lerp | 353.8 kB | 0.0137x | 111 | 51 slots x 4 | 10 ms |
| mat4-near | 707.6 kB | 0.0274x | 222 | 51 slots x 4 | 13 ms |
| qt-near | 353.8 kB | 0.0137x | 222 | 51 slots x 2 | 15 ms |
| qt-slerp | 176.9 kB | 0.0069x | 111 | 51 slots x 2 | 8 ms |

**Refusal**

No refusal: not one of Soldier.glb's 4 clips animates a morph target, so there is nothing here the encoding cannot store. (Try ?asset=robot.)

**Non-uniform bone scale**: none in this asset.
