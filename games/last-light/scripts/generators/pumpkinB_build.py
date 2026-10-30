BASE=r'C:\Users\lezen\ThreJsJourney\three-vat\games\last-light'

import bpy, os, math, json, bmesh, collections, heapq
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
exec(open(os.path.join(BASE,"scripts","generators","pumpkin_copy.py")).read())
def clean_line(P,r,keep_first=True):
    P=[Vector(q) for q in P]; out=[P[0]]
    for q in P[1:]:
        if (q-out[-1]).length>=0.9*r: out.append(q)
    if len(out)<3: out=[P[0],P[-1]]
    for _ in range(3):
        out=[out[0]]+[(out[i-1]+out[i]*2+out[i+1])/4 for i in range(1,len(out)-1)]+[out[-1]]
    return out
def safe_radius(P,r):
    """tube radius must stay below the local radius of curvature"""
    rs=[]
    for i in range(1,len(P)-1):
        a,b,c=P[i-1],P[i],P[i+1]; ab=(b-a).length; bc=(c-b).length; ac=(c-a).length
        area=((b-a).cross(c-a)).length/2
        R=(ab*bc*ac)/(4*area) if area>1e-9 else 1e9; rs.append(R)
    return min([r]+[0.8*R for R in rs])
def build_B(GUARD=1.7,HOLE=2.4):
    ref=bpy.data.objects["REF.pumpkinB"]; RV,RF,tree=ref_tree(ref)
    J=json.load(open(os.path.join(BASE,"scripts","analysis","pumpkinB_body.json")))
    off=J["off"]; phis=J["phis"]; zc=J["zc"]; C=Vector((0,0,zc))
    pts=[Vector(p) for p in J["pts"]]; rads=J["rads"]; branch2=J.get("branch2")
    def hit(phi,az):
        d=Vector((math.cos(az)*math.cos(phi),math.sin(az)*math.cos(phi),math.sin(phi))); h=tree.ray_cast(C,d,5.0); return h[0]
    def up(x,y):
        h=tree.ray_cast(Vector((x,y,zc)),Vector((0,0,1)),5.0); return h[0]
    def down(x,y):
        h=tree.ray_cast(Vector((x,y,zc)),Vector((0,0,-1)),5.0); return h[0]
    bot_r={}
    def place(kind,i,a):
        az=math.radians(a+off)
        if kind=="side":
            q=hit(phis[i],az)
            if q and i==0: bot_r[round(a,3)]=q.xy.length
            return q if q else C
        if kind in ("top16","stembase"):
            r=0.11 if kind=="top16" else 0.05; q=up(math.cos(az)*r,math.sin(az)*r); return q if q else Vector((math.cos(az)*r,math.sin(az)*r,1.18))
        k=min(bot_r,key=lambda b:min(abs(b-a),360-abs(b-a))); r=bot_r[k]*(0.55 if kind=="bottom16" else 0.22)
        q=down(math.cos(az)*r,math.sin(az)*r); return q if q else Vector((math.cos(az)*r,math.sin(az)*r,0.05))
    V,F,cols=build_pumpkin2(place,K=6,side_z=phis,plateau=[],n_stem=0)
    for r_ in range(len(phis)):
        ring=list(range(r_*cols,(r_+1)*cols))
        for c in range(cols):
            v=V[ring[c]]; ang=math.degrees(math.atan2(v.y,v.x))
            if -158<ang<-22 and 0.12<v.z<1.0:
                same=[V[ring[j]] for j in range(cols) if j%6==c%6 and math.degrees(math.atan2(V[ring[j]].y,V[ring[j]].x))>-5]
                if same:
                    rr_=float(np.mean([w.xy.length for w in same])); zz=float(np.mean([w.z for w in same])); t=math.atan2(v.y,v.x)
                    V[ring[c]]=Vector((math.cos(t)*rr_,math.sin(t)*rr_,zz))
    bm=bmesh.new(); vv=[bm.verts.new(v) for v in V]
    for f in F:
        try: bm.faces.new([vv[i] for i in f])
        except ValueError: pass
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    def frames_for(cl):
        fr=[]; X=None
        for i,p in enumerate(cl):
            tg=(cl[min(i+1,len(cl)-1)]-cl[max(i-1,0)]).normalized()
            if X is None: X=tg.cross(Vector((0,0,1))) if abs(tg.z)<0.9 else tg.cross(Vector((1,0,0)))
            X=(X-tg*X.dot(tg)).normalized(); Y=tg.cross(X).normalized(); fr.append((X.copy(),Y))
        return fr
    def sqo(k,r,fr):
        a=math.radians(45*k); c,s=math.cos(a),math.sin(a); m=max(abs(c),abs(s)); kk=0.88 if abs(abs(c)-abs(s))<0.2 else 1.0
        X,Y=fr; return X*(c/m*r*0.82*kk)+Y*(s/m*r*0.82*kk)
    def pin(p,poly):
        x,y=p; ins=False
        for i in range(len(poly)):
            x1,y1=poly[i]; x2,y2=poly[(i+1)%len(poly)]
            if (y1>y)!=(y2>y) and x<x1+(y-y1)*(x2-x1)/(y2-y1): ins=not ins
        return ins
    def seg_cross(a,b,c,d):
        def ccw(p,q,r): return (r[1]-p[1])*(q[0]-p[0])>(q[1]-p[1])*(r[0]-p[0])
        return ccw(a,c,d)!=ccw(b,c,d) and ccw(a,b,c)!=ccw(a,b,d)
    r0=float(np.median(rads[1:-2]))*0.9
    pts=clean_line(pts,r0); r0=safe_radius(pts,r0)
    fr=frames_for(pts)
    foot=[pts[0]+sqo(k,r0*1.35,fr[0]) for k in range(8)]
    foot=[up(p.x,p.y) or p for p in foot]
    foot2=[tuple(p.xy) for p in foot]
    order=list(range(8)) if signed_area(foot2)>0 else list(range(7,-1,-1))
    fo2=[foot2[i] for i in order]; cen=np.mean(np.array(foot2),0)
    guard=[(cen[0]+(x-cen[0])*GUARD,cen[1]+(y-cen[1])*GUARD) for x,y in fo2]
    hole=[(cen[0]+(x-cen[0])*HOLE,cen[1]+(y-cen[1])*HOLE) for x,y in fo2]
    def crosses(f):
        P=[tuple(v.co.xy) for v in f.verts]
        return any(seg_cross(P[i],P[(i+1)%len(P)],guard[j],guard[(j+1)%len(guard)]) for i in range(len(P)) for j in range(len(guard)))
    cands=[f for f in bm.faces if f.calc_center_median().z>0.8 and f.normal.z>0.15]
    kill=[f for f in cands if pin(tuple(f.calc_center_median().xy),hole) or any(pin(tuple(v.co.xy),guard) for v in f.verts) or crosses(f)]
    before=set(e for e in bm.edges if e.is_boundary)
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    bnd=[e for e in bm.edges if e.is_boundary and e not in before]
    ad=collections.defaultdict(list)
    for e in bnd:
        a,b=e.verts; ad[a].append(b); ad[b].append(a)
    seen=set(); loops=[]
    for s_ in ad:
        if s_ in seen: continue
        L_=[s_]; seen.add(s_); prev=None; cur=s_
        while True:
            nx=[w for w in ad[cur] if w is not prev and w not in seen]
            if not nx: break
            prev,cur=cur,nx[0]; L_.append(cur); seen.add(cur)
        loops.append(L_)
    B=max(loops,key=len); B2=[tuple(v.co.xy) for v in B]
    if signed_area(B2)<0: B=B[::-1]; B2=B2[::-1]
    vfoot=[bm.verts.new(p) for p in foot]
    allv=B+[vfoot[i] for i in order]
    tris=cdt_region(B2,fo2)
    band=[]
    if tris:
        for t in tris:
            try: band.append(bm.faces.new([allv[i] for i in t]))
            except ValueError: pass
        bmesh.ops.join_triangles(bm,faces=band,angle_face_threshold=math.radians(30),angle_shape_threshold=math.radians(40),cmp_seam=False,cmp_sharp=False,cmp_uvs=False,cmp_vcols=False,cmp_materials=False)
    prevr=vfoot
    for i in range(1,len(pts)):
        s_=r0*(1.25 if i==len(pts)-1 else 1.0)
        ring=[bm.verts.new(pts[i]+sqo(k,s_,fr[i])) for k in range(8)]
        for k in range(8): bm.faces.new((prevr[k],prevr[(k+1)%8],ring[(k+1)%8],ring[k]))
        prevr=ring
    bm.faces.new(prevr)
    if branch2:
        rb=float(np.median(branch2["r"]))*0.9
        cl=clean_line(branch2["pts"],rb); rb=safe_radius(cl,rb); fr2=frames_for(cl); prevr=None
        for i,c in enumerate(cl):
            ring=[bm.verts.new(c+sqo(k,rb*(0.8 if i==len(cl)-1 else 1.0),fr2[i])) for k in range(8)]
            if prevr:
                for k in range(8): bm.faces.new((prevr[k],prevr[(k+1)%8],ring[(k+1)%8],ring[k]))
            else: first=ring
            prevr=ring
        bm.faces.new(prevr); bm.faces.new(first[::-1])
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    for f in bm.faces: f.smooth=True
    me=bpy.data.meshes.new("pumpkinB.v2.uncarved"); bm.to_mesh(me); bm.free(); me.use_fake_user=True
    return me,{"band":len(band),"cdt_ok":bool(tris),"hole_loop":len(B),"killed":len(kill)}
