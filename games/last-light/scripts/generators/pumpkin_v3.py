
"""Pumpkin generator v3 - topology rules learnt from the reference copies:
 - 8 lobes x K columns (K=3 small pumpkin, 5 tall ones), groove on a column, no extra support columns
 - side rings ~every 0.1 of the height, tight support rings at the top rim, a few plateau rings
 - caps closed with quads (3->1 ring reductions), never a fan; stem grows from the cap ring (8 verts)"""
import bpy, bmesh, math
import numpy as np
from mathutils import Vector
def reduce_3to1(O,I):
    # outer ring O (3n), inner ring I (n): 2 quads per group
    n=len(I); F=[]
    for g in range(n):
        o0,o1,o2,o3=O[3*g],O[3*g+1],O[3*g+2],O[(3*g+3)%len(O)]
        i0,i1=I[g],I[(g+1)%n]
        F.append((o0,o1,o2,i0)); F.append((o2,o3,i1,i0))
    return F
def bridge(A,B):
    m=len(A); return [(A[c],A[(c+1)%m],B[(c+1)%m],B[c]) for c in range(m)]
def build_pumpkin(place,lobes=8,K=3,side_z=(),plateau=(),stem_pts=(),stem_r=(),bottom=None,top_ring=None):
    """place(kind, ring_index, column_angle_deg, extra) -> Vector : positions come from a shape function
       (procedural) or from a projection on a reference (fit)."""
    V=[]; F=[]
    def add(p): V.append(Vector(p)); return len(V)-1
    cols=[360.0*(l+f)/lobes for l in range(lobes) for f in [k/K for k in range(K)]]
    rings=[]
    for ri,z in enumerate(side_z): rings.append([add(place("side",ri,a,z)) for a in cols])
    for pi,t in enumerate(plateau): rings.append([add(place("plateau",pi,a,t)) for a in cols])
    for i in range(len(rings)-1): F+=bridge(rings[i],rings[i+1])
    # top: 24 -> 8 stem ring, then the stem
    sb=[add(place("stembase",0,a,None)) for a in cols[::K]][:lobes] if K==3 else None
    if K!=3:
        mid=[add(place("stembase",0,a,None)) for a in cols[::K//2+1]]
    F+=reduce_3to1(rings[-1],sb)
    prev=sb
    for si,c in enumerate(stem_pts):
        ring=[add(place("stem",si,a,None)) for a in cols[::K]][:lobes]; F+=bridge(prev,ring); prev=ring
    F.append(tuple(prev[::-1]) if False else tuple(prev))
    # bottom: first ring -> 8 ring -> 3 quads
    b8=[add(place("bottom",0,a,None)) for a in cols[::K]][:lobes]
    F+=[tuple(reversed(f)) for f in reduce_3to1(rings[0],b8)]
    F+=[(b8[3],b8[2],b8[1],b8[0]),(b8[7],b8[6],b8[5],b8[4]),(b8[7],b8[4],b8[3],b8[0])]
    return V,F

def reduce_2to1(O,I):
    n=len(I); F=[]
    for g in range(n):
        o0,o1,o2=O[2*g],O[2*g+1],O[(2*g+2)%len(O)]; i0,i1=I[g],I[(g+1)%n]
        F.append((o0,o1,o2,i0)); F.append((o2,i1,i0))
    return F
def build_pumpkin2(place,lobes=8,K=6,side_z=(),plateau=(),n_stem=0):
    V=[];F=[]
    def add(p): V.append(Vector(p)); return len(V)-1
    cols=[360.0*(l+k/K)/lobes for l in range(lobes) for k in range(K)]
    rings=[]
    for ri in range(len(side_z)): rings.append([add(place("side",ri,a)) for a in cols])
    for pi in range(len(plateau)): rings.append([add(place("plateau",pi,a)) for a in cols])
    for i in range(len(rings)-1): F+=bridge(rings[i],rings[i+1])
    c16=cols[::3]; c8=cols[::6]
    t16=[add(place("top16",0,a)) for a in c16]; F+=reduce_3to1(rings[-1],t16)
    t8=[add(place("stembase",0,a)) for a in c8]; F+=reduce_2to1(t16,t8)
    prev=t8
    for si in range(n_stem):
        ring=[add(place("stem",si,a)) for a in c8]; F+=bridge(prev,ring); prev=ring
    F.append(tuple(prev))
    b16=[add(place("bottom16",0,a)) for a in c16]; F+=[tuple(reversed(f)) for f in reduce_3to1(rings[0],b16)]
    b8=[add(place("bottom8",0,a)) for a in c8]; F+=[tuple(reversed(f)) for f in reduce_2to1(b16,b8)]
    F+=[(b8[3],b8[2],b8[1],b8[0]),(b8[7],b8[6],b8[5],b8[4]),(b8[7],b8[4],b8[3],b8[0])]
    return V,F,len(cols)
