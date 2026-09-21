## Soldier.glb — soldier

WebGL2 · ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)

**Frame time** (timed with EXT_disjoint_timer_query_webgl2 — real GPU milliseconds; best of 90)

| encoding | instances | best ms | vs VAT | median | max | n | |
| --- | --- | --- | --- | --- | --- | --- | --- |
| vat | 340 | 0.463 | 1.00x | 0.476 | 0.695 | 90 |  |
| mat4-lerp | 340 | 0.725 | 1.57x | 0.733 | 2.651 | 90 |  |
| mat4-near | 340 | 0.703 | 1.52x | 0.716 | 2.766 | 90 |  |
| qt-near | 340 | 0.633 | 1.37x | 0.639 | 2.693 | 90 |  |
| qt-slerp | 340 | 0.658 | 1.42x | 0.669 | 2.614 | 90 |  |
| vat | 1000 | 1.362 | 1.00x | 1.382 | 3.411 | 90 |  |
| mat4-lerp | 1000 | 2.134 | 1.57x | 2.447 | 5.061 | 90 |  |
| mat4-near | 1000 | 2.084 | 1.53x | 2.491 | 4.832 | 90 |  |
| qt-near | 1000 | 1.856 | 1.36x | 1.865 | 3.686 | 90 |  |
| qt-slerp | 1000 | 1.944 | 1.43x | 2.170 | 4.019 | 90 |  |

**Cost of the bake**

| encoding | texture | vs VAT | rows | width | bake |
| --- | --- | --- | --- | --- | --- |
| VAT (control) | 25.2 MB | 1.00x | 111 | 7434 verts | 1328 ms |
| mat4-lerp | 353.8 kB | 0.0137x | 111 | 51 slots x 4 | 11 ms |
| mat4-near | 707.6 kB | 0.0274x | 222 | 51 slots x 4 | 9 ms |
| qt-near | 353.8 kB | 0.0137x | 222 | 51 slots x 2 | 19 ms |
| qt-slerp | 176.9 kB | 0.0069x | 111 | 51 slots x 2 | 6 ms |

**Refusal**

No refusal: not one of Soldier.glb's 4 clips animates a morph target, so there is nothing here the encoding cannot store. (Try ?asset=robot.)

**Non-uniform bone scale**: none in this asset.


