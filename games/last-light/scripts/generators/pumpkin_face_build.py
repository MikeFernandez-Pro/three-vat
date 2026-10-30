
import bpy, os, math, bmesh, collections, itertools
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
def build_face_A(carver,margin=0.03,hole_scale=1.35,mouth=False,mouth_eps=0.012):
    ref=bpy.data.objects["REF.pumpkinA"]; RV=[v.co.copy() for v in ref.data.vertices]; RF=[list(q.vertices) for q in ref.data.polygons]
    unc=bpy.data.meshes["pumpkinA.v3.uncarved"]
    bt=BVHTree.FromPolygons([v.co.copy() for v in unc.vertices],[list(p.vertices) for p in unc.polygons])
    R0=0.62; face=(-155,-25,0.08,0.7)
    def recess(v):
        a=math.degrees(math.atan2(v.y,v.x))
        if not (face[0]<a<face[1] and face[2]<v.z<face[3]): return 0.0
        d=Vector((v.x,v.y,0)).normalized(); h=bt.ray_cast(v+d*1.5,-d,3.0)
        return (h[0].xy.length-v.xy.length) if h[0] else 0.0
    rec=np.array([recess(v) for v in RV])
    bmr=bmesh.new()
    for v in RV: bmr.verts.new(v)
    bmr.verts.index_update(); bmr.verts.ensure_lookup_table()
    for f in RF: bmr.faces.new([bmr.verts[i] for i in f])
    bmr.faces.index_update()
    cut=set(f.index for f in bmr.faces if np.mean([rec[v.index] for v in f.verts])>0.025)
    adj=collections.defaultdict(list)
    for e in bmr.edges:
        if sum(1 for f in e.link_faces if f.index in cut)==1:
            a,b=e.verts; adj[a.index].append(b.index); adj[b.index].append(a.index)
    bmr.free()
    seen=set(); loops=[]
    for s_ in adj:
        if s_ in seen: continue
        loop=[s_]; seen.add(s_); prev=None; cur=s_
        while True:
            nx=[n for n in adj[cur] if n!=prev and n not in seen]
            if not nx: break
            prev,cur=cur,nx[0]; loop.append(cur); seen.add(cur)
        loops.append(loop)
    def to2(v): return (math.atan2(v.y,v.x)*R0, v.z)
    def surf(u,z):
        t=u/R0; d=Vector((math.cos(t),math.sin(t),0)); h=bt.ray_cast(Vector((0,0,z))+d*1.5,-d,3.0)
        return h[0] if h[0] else Vector((math.cos(t)*0.6,math.sin(t)*0.6,z))
    def pin(p,poly):
        x,y=p; ins=False
        for i in range(len(poly)):
            x1,y1=poly[i]; x2,y2=poly[(i+1)%len(poly)]
            if (y1>y)!=(y2>y) and x<x1+(y-y1)*(x2-x1)/(y2-y1): ins=not ins
        return ins
    def max_triangle(P2):
        best=None; P=np.array(P2)
        for i,j,k in itertools.combinations(range(len(P)),3):
            a=0.5*abs((P[j][0]-P[i][0])*(P[k][1]-P[i][1])-(P[k][0]-P[i][0])*(P[j][1]-P[i][1]))
            if best is None or a>best[0]: best=(a,(i,j,k))
        return [tuple(P[i]) for i in best[1]]
    FEATS=[("eye_L",(-79,-62),3),("eye_R",(-123,-102),3),("nose",(-99,-84),2)]
    bm=bmesh.new(); bm.from_mesh(unc); bm.verts.ensure_lookup_table(); log=[]
    for name,(a0,a1),per in FEATS:
        L=max([l for l in loops if len(l)>=6 and all(a0-3<math.degrees(math.atan2(RV[i].y,RV[i].x))<a1+3 for i in l)],key=len)
        P2=[to2(RV[i]) for i in L]
        enc=[i for i in range(len(RV)) if pin(to2(RV[i]),P2)]
        depth=float(np.percentile(rec[enc],90))
        tri=max_triangle(P2)
        if signed_area(tri)<0: tri=tri[::-1]
        out2=[]
        for i in range(3):
            a=np.array(tri[i]); b=np.array(tri[(i+1)%3])
            for s in range(per+1): out2.append(tuple(a+(b-a)*s/(per+1)))
        info=carver(bm,to2,surf,out2,depth,margin=margin,hole_scale=hole_scale,front=lambda co: co.xy.length>0.45 and co.z<0.79,pin=pin,signed_area=signed_area)
        info["feat"]=name; log.append(info)
    if mouth:
        Lm=max([l for l in loops if all(-150<math.degrees(math.atan2(RV[i].y,RV[i].x))<-40 for i in l)],key=len)
        P2=[to2(RV[i]) for i in Lm]
        if signed_area(P2)<0: P2=P2[::-1]
        D=douglas_peucker(P2,mouth_eps)
        if signed_area(D)<0: D=D[::-1]
        enc=[i for i in range(len(RV)) if pin(to2(RV[i]),D)]
        depth=float(np.percentile(rec[enc],90)) if enc else 0.06
        info=carve_feature3(bm,to2,surf,D,depth,margin=0.025,hole_margin=0.04,front=lambda co: co.xy.length>0.45 and co.z<0.79,pin=pin,signed_area=signed_area)
        info["feat"]="mouth"; info["depth"]=round(depth,3); info["outline"]=len(D); log.append(info)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    for f in bm.faces: f.smooth=True
    nonman=sum(1 for e in bm.edges if not e.is_manifold)
    me=bpy.data.meshes.new("pumpkinA.v3c"); bm.to_mesh(me); bm.free()
    ob=bpy.data.objects["pumpkinA.v3"]; old=ob.data; ob.data=me; me.name="pumpkinA.v3"
    if old.users==0: bpy.data.meshes.remove(old)
    return log,nonman,me
def tri_quality(me,boxes):
    bm=bmesh.new(); bm.from_mesh(me); out={}
    for k,(a0,a1,z0,z1) in boxes.items():
        fs=[f for f in bm.faces if a0<math.degrees(math.atan2(f.calc_center_median().y,f.calc_center_median().x))<a1 and z0<f.calc_center_median().z<z1 and f.calc_center_median().xy.length>0.45]
        obt=[f for f in fs if len(f.verts)==3 and max(math.degrees(l.calc_angle()) for l in f.loops)>135]
        out[k]={"faces":len(fs),"obtuse_tris":len(obt),"min_angle":round(min(math.degrees(l.calc_angle()) for f in fs for l in f.loops),1)}
    bm.free(); return out
