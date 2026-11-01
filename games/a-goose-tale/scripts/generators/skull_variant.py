
"""Variant of the clean skull: same crease network, moved loops.
All edits are smooth weighted displacements, so topology and creases are preserved."""
import bpy, math
from mathutils import Vector
def sstep(a,b,x):
    t=max(0.0,min(1.0,(x-a)/(b-a))); return t*t*(3-2*t)
def make_variant(src_name="skull.loops",name="skull.variant1",coll=None,gum_z=0.045,
                 brow_lift=0.018,dome=0.035,socket_push=0.02,cheek_pinch=0.025,nose_narrow=0.1):
    src=bpy.data.objects[src_name]; me=src.data.copy(); me.name=name
    for v in me.vertices:
        x,y,z=v.co; ax=abs(x)
        # 1) flat gum line: the whole lower rim of the dental band on one plane (removes the two fangs)
        if y<0.47 and z<0.065:
            z=gum_z
        # 2) steeper angry V: outer brow ends lifted, centre untouched
        w=sstep(0.12,0.38,ax)*(1-sstep(0.72,0.78,z))*sstep(0.56,0.62,z)*(1-sstep(0.35,0.45,y))
        z+=brow_lift*w
        # 3) slightly taller, rounder dome
        if z>0.72: z=0.72+(z-0.72)*(1+dome)
        # 4) deeper sockets (vertices inside the socket bowl move back)
        ws=(1-sstep(0.04,0.11,math.hypot((ax-0.26)/1.6,(z-0.5))))*sstep(0.08,0.2,y)
        y+=socket_push*ws
        # 5) cheekbones a touch narrower
        wc=sstep(0.38,0.47,ax)*(1-sstep(0.42,0.5,z))*sstep(0.18,0.24,z)*(1-sstep(0.55,0.7,y))
        x*=1-cheek_pinch*wc
        # 6) narrower nose triangle at its base
        wn=(1-sstep(0.08,0.13,ax))*sstep(0.16,0.2,z)*(1-sstep(0.42,0.48,z))*(1-sstep(0.18,0.26,y))
        x*=1-nose_narrow*wn
        v.co=(x,y,z)
    ob=bpy.data.objects.get(name)
    if ob:
        old=ob.data; ob.data=me
        if old.users==0: bpy.data.meshes.remove(old)
    else:
        ob=bpy.data.objects.new(name,me)
    if coll and coll not in ob.users_collection: coll.objects.link(ob)
    return ob
