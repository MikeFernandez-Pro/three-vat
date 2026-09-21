## Soldier.glb — soldier

WebGL2 · Apple GPU (iPhone 15 Pro Max, A17 Pro, Safari)

**Frame time** (no GPU timer in this browser — wall clock around 4 renders and a 1-pixel readback; read the ratios, not the absolutes; best of 90)

| encoding | instances | best ms | vs VAT | median | max | n | |
| --- | --- | --- | --- | --- | --- | --- | --- |
| vat | 340 | 7.500 | 1.00x | 10.500 | 20.500 | 90 | **SATURATED** |
| mat4-lerp | 340 | 5.250 | 0.70x | 9.000 | 22.750 | 90 | **SATURATED** |
| mat4-near | 340 | 4.750 | 0.63x | 6.750 | 17.500 | 90 | |
| qt-near | 340 | 4.500 | 0.60x | 6.000 | 13.500 | 90 | |
| qt-slerp | 340 | 4.500 | 0.60x | 7.250 | 19.500 | 90 | |

Rows marked SATURATED spent more than 8 ms a frame and were fighting the display cadence. Every number in such a row is an upper bound, and the ratio between two of them says nothing — both are pinned against the same ceiling.

**Cost of the bake**

| encoding | texture | vs VAT | rows | width | bake |
| --- | --- | --- | --- | --- | --- |
| VAT (control) | 25.2 MB | 1.00x | 111 | 7434 verts | 306 ms |
| mat4-lerp | 353.8 kB | 0.0137x | 111 | 51 slots x 4 | 10 ms |
| mat4-near | 707.6 kB | 0.0274x | 222 | 51 slots x 4 | 14 ms |
| qt-near | 353.8 kB | 0.0137x | 222 | 51 slots x 2 | 14 ms |
| qt-slerp | 176.9 kB | 0.0069x | 111 | 51 slots x 2 | 8 ms |

**Refusal**

No refusal: not one of Soldier.glb's 4 clips animates a morph target, so there is nothing here the encoding cannot store. (Try ?asset=robot.)

**Non-uniform bone scale**: none in this asset.
