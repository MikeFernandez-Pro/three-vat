
"""Stylized pumpkin generator - clean quad grid like the RetopoFlow references.
Body = lobed surface of revolution: rings follow a measured profile (bottom dimple ->
belly -> shoulder -> top collar dipping to the stem), columns = N lobes x K segments
(groove, flank, crest, flank). Stem = bevelled square section swept along a bent curve."""
import bpy, bmesh, math, random
from mathutils import Vector
def resample(pts,n):
    L=[0.0]
    for i in range(1,len(pts)): L.append(L[-1]+math.dist(pts[i],pts[i-1]))
    out=[]
    for k in range(n):
        t=L[-1]*k/(n-1); i=max(j for j in range(len(L)) if L[j]<=t+1e-9); i=min(i,len(pts)-2)
        u=(t-L[i])/max(1e-9,L[i+1]-L[i]); out.append((pts[i][0]+(pts[i+1][0]-pts[i][0])*u, pts[i][1]+(pts[i+1][1]-pts[i][1])*u))
    return out
def body(P,seed=1):
    rng=random.Random(seed)
    prof=resample(P["profile"],P["rings"])          # (z, r) from bottom centre to top centre
    N=P["lobes"]; K=P["seg_per_lobe"]; cols=N*K
    lobe_scale=[1.0+rng.uniform(-P["lobe_jitter"],P["lobe_jitter"]) for _ in range(N)]
    wid=[1.0+rng.uniform(-P.get("width_jitter",0),P.get("width_jitter",0)) for _ in range(N)]
    acc=[0.0]
    for w_ in wid: acc.append(acc[-1]+w_)
    def warp(u):   # u in [0,1) uniform lobe param -> warped angle
        x=u*N; i=int(x)%N; fr=x-int(x); return 2*math.pi*(acc[i]+fr*wid[i])/acc[-1]
    rmax=max(r for z,r in prof)
    verts=[]; rings=[]
    for i,(z,r) in enumerate(prof[1:-1],start=1):
        ring=[]
        w=min(1.0,(r/rmax)/0.55)                   # lobes fade out near the poles
        for c in range(cols):
            u=c/cols; th=warp(u)+P["twist"]*z
            f=abs(math.cos(N*(2*math.pi*u)/2))       # 1 crest .. 0 groove (in lobe space)
            k=(1-P["groove"]*w)+P["groove"]*w*(f**P["crest_round"])
            k*=1+(lobe_scale[int(u*N)%N]-1)*w
            verts.append(Vector((math.cos(th)*r*k, math.sin(th)*r*k, z))); ring.append(len(verts)-1)
        rings.append(ring)
    verts.append(Vector((0,0,prof[0][0]))); bot=len(verts)-1
    verts.append(Vector((0,0,prof[-1][0]))); top=len(verts)-1
    faces=[]
    for i in range(len(rings)-1):
        A,B=rings[i],rings[i+1]
        for c in range(cols): faces.append((A[c],A[(c+1)%cols],B[(c+1)%cols],B[c]))
    for c in range(cols):
        faces.append((rings[0][(c+1)%cols],rings[0][c],bot)); faces.append((rings[-1][c],rings[-1][(c+1)%cols],top))
    return verts,faces
def stem(P,verts,faces):
    S=P["stem"]; base=Vector(S["base"])
    ctrl=[base,base+Vector(S["c1"]),base+Vector(S["c2"]),base+Vector(S["tip"])]
    def bez(t):
        a,b,c,d=ctrl; return a*(1-t)**3+b*3*t*(1-t)**2+c*3*t*t*(1-t)+d*t**3
    n=S["segments"]; prev=None; first=None
    sec=S["section"]  # half widths of the bevelled square: 8 points
    for i in range(n+1):
        t=i/n; p=bez(t); tg=(bez(min(1,t+0.01))-bez(max(0,t-0.01))).normalized()
        side=tg.cross(Vector((0,1,0))).normalized() if abs(tg.y)<0.9 else Vector((1,0,0))
        up=side.cross(tg).normalized()
        s=S["r0"]+(S["r1"]-S["r0"])*t
        if i==n: s*=S["cap"]
        ring=[]
        for (u,v) in sec:
            verts.append(p+side*u*s+up*v*s); ring.append(len(verts)-1)
        if prev:
            m=len(ring)
            for k in range(m): faces.append((prev[k],prev[(k+1)%m],ring[(k+1)%m],ring[k]))
        else: first=ring
        prev=ring
    faces.append(tuple(prev)); faces.append(tuple(reversed(first)))
def build(P,name,coll,seed=1):
    v,f=body(P,seed); stem(P,v,f)
    me=bpy.data.meshes.get(name) or bpy.data.meshes.new(name); me.clear_geometry()
    me.from_pydata([tuple(x) for x in v],[],f)
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    for e in bm.edges: e.smooth=not (len(e.link_faces)==2 and math.degrees(e.calc_face_angle())>P["sharp_deg"])
    for fc in bm.faces: fc.smooth=True
    bm.to_mesh(me); bm.free()
    ob=bpy.data.objects.get(name) or bpy.data.objects.new(name,me); ob.data=me
    if coll not in ob.users_collection: coll.objects.link(ob)
    return ob
SQ=[(1,0.55),(0.55,1),(-0.55,1),(-1,0.55),(-1,-0.55),(-0.55,-1),(0.55,-1),(1,-0.55)]
PUMPKIN_A=dict(
    profile=[(0.10,0.0),(0.03,0.22),(0.0,0.42),(0.05,0.53),(0.16,0.59),(0.30,0.635),(0.46,0.652),(0.60,0.628),(0.72,0.575),(0.82,0.49),
             (0.90,0.37),(0.945,0.26),(0.93,0.18),(0.86,0.12),(0.78,0.07),(0.74,0.0)],
    rings=18, lobes=10, seg_per_lobe=4, groove=0.13, crest_round=0.35, lobe_jitter=0.03, twist=0.0,
    stem=dict(base=(0.0,0.0,0.72),c1=(0.0,0.0,0.18),c2=(0.02,0.0,0.36),tip=(0.14,0.0,0.43),r0=0.075,r1=0.055,cap=1.35,segments=6,section=SQ),
    sharp_deg=40.0)

PUMPKIN_A2=dict(
    profile=[(0.06,0.0),(0.015,0.2),(0.0,0.4),(0.03,0.5),(0.11,0.57),(0.24,0.625),(0.37,0.652),(0.49,0.64),(0.59,0.6),(0.67,0.53),
             (0.715,0.44),(0.735,0.33),(0.74,0.24),(0.725,0.16),(0.70,0.08),(0.69,0.0)],
    rings=18, lobes=9, seg_per_lobe=4, groove=0.085, crest_round=0.7, lobe_jitter=0.06, width_jitter=0.18, twist=0.04,
    stem=dict(base=(0.0,0.0,0.68),c1=(0.0,0.0,0.22),c2=(-0.02,0.0,0.42),tip=(0.1,0.02,0.5),r0=0.058,r1=0.046,cap=1.45,segments=7,section=SQ),
    sharp_deg=55.0)
