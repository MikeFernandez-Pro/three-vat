
"""Pumpkin rebuild from a reference, with the rules learnt on A (and from the manual cleanup):
 body = clean quad grid (8 lobes x 6 cols, grooves on columns, rings on measured heights, quad caps)
 stem = bevelled square tube along the reference stem's geodesic centre line (handles curls)
 carvings = exact reference outlines, simplified; rim on the surface, ONE wall strip rim i -> floor i,
            ONE flat n-gon floor, quad-paired constrained triangulation between grid and rim."""
import bpy, bmesh, math, collections, json, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
BASE=r"C:\Users\lezen\ThreJsJourney\three-vat\games\last-light"
exec(open(os.path.join(BASE,"scripts","generators","pumpkin_v3.py")).read())
exec(open(os.path.join(BASE,"scripts","generators","pumpkin_carve.py")).read())
def ref_tree(ref):
    RV=[v.co.copy() for v in ref.data.vertices]; RF=[list(p.vertices) for p in ref.data.polygons]
    return RV,RF,BVHTree.FromPolygons(RV,RF)
def detect_grooves(tree,z,front=(-160,-20)):
    th=np.radians(np.arange(0,360,1.0)); rr=[]
    for t in th:
        d=Vector((math.cos(t),math.sin(t),0)); h=tree.ray_cast(Vector((0,0,z))+d*3,-d,6); rr.append(h[0].xy.length if h[0] else np.nan)
    rr=np.array(rr); k=7; rs=np.convolve(np.concatenate([rr[-k:],rr,rr[:k]]),np.ones(k)/k,'same')[k:-k]
    mins=[i for i in range(360) if rs[i]<rs[i-1] and rs[i]<=rs[(i+1)%360]]
    mins=[i for i in mins if not (360+front[0]<i<360+front[1])]
    sel=[]
    for i in sorted(mins,key=lambda i:rs[i]):
        if all(min(abs(i-j),360-abs(i-j))>25 for j in sel): sel.append(i)
    # regular 8-lobe fit: offset that best matches the detected grooves
    best=min(np.arange(0,45,0.5),key=lambda o:sum(min(abs(((g-o)%45)),45-abs(((g-o)%45))) for g in sel))
    return float(best),sel
def stem_centerline(RV,RF,ztop_body,n=9):
    S=set(i for i,v in enumerate(RV) if v.z>ztop_body+0.02 and v.xy.length<0.7)
    adj=collections.defaultdict(list)
    for f in RF:
        for a,b in zip(f,f[1:]+f[:1]):
            if a in S and b in S: adj[a].append(b); adj[b].append(a)
    base_i=min(S,key=lambda i:(RV[i].xy.length*3+RV[i].z))
    # keep the component containing the base, geodesic distances (Dijkstra)
    import heapq
    dist={base_i:0.0}; pq=[(0.0,base_i)]
    while pq:
        d,i=heapq.heappop(pq)
        if d>dist[i]: continue
        for j in adj[i]:
            nd=d+(RV[i]-RV[j]).length
            if nd<dist.get(j,1e9): dist[j]=nd; heapq.heappush(pq,(nd,j))
    comp=list(dist); D=max(dist.values())
    pts=[];rads=[]
    for k in range(n+1):
        lo=D*k/(n+1); hi=D*(k+1)/(n+1)
        band=[RV[i] for i in comp if lo<=dist[i]<hi]
        if len(band)<3: continue
        c=sum(band,Vector())/len(band); pts.append(c); rads.append(float(np.median([(v-c).length for v in band])))
    return pts,rads
def build_body(ref_name,obj_name,coll,K=6,body_fracs=(0.012,0.048,0.12,0.21,0.29,0.40,0.51,0.61,0.70)):
    ref=bpy.data.objects[ref_name]; RV,RF,tree=ref_tree(ref)
    Z=[v.z for v in RV]
    zc=0.45*max(Z); C=Vector((0,0,zc))
    off,gro=detect_grooves(tree,zc)
    def hit(phi,az):
        d=Vector((math.cos(az)*math.cos(phi),math.sin(az)*math.cos(phi),math.sin(phi))); h=tree.ray_cast(C,d,5.0); return h[0]
    def vhit(x,y,up=True):
        h=tree.ray_cast(Vector((x,y,zc)),Vector((0,0,1 if up else -1)),5.0); return h[0]
    az0=math.radians(off+22.5)
    scan=[(p,hit(math.radians(p),az0)) for p in np.arange(-88,86,0.25)]; scan=[(p,h) for p,h in scan if h is not None]
    rmax=max(h.xy.length for p,h in scan)
    Rall=np.array([v.xy.length for v in RV]); Zall=np.array(Z)
    zcap=float(np.percentile(Zall[Rall>0.4*rmax],97))+0.01   # body top, the stem/curl excluded
    scan=[(p,h) for p,h in scan if h.z<=zcap]
    phi_rim=max([t for t in scan if t[0]>0 and t[1].xy.length>0.45*rmax],key=lambda t:t[1].z)[0]
    phi_bot=min([t for t in scan if t[0]<0 and t[1].xy.length>0.25*rmax],key=lambda t:t[1].z)[0]
    zr=hit(math.radians(phi_rim),az0).z; zb=hit(math.radians(phi_bot),az0).z
    def phi_for_z(zt):
        lo,hi=math.radians(phi_bot),math.radians(phi_rim)
        for _ in range(40):
            m=(lo+hi)/2; h=hit(m,az0)
            if h is None or h.z>zt: hi=m
            else: lo=m
        return (lo+hi)/2
    zs=[zb+(zr-zb)*f/0.812 for f in body_fracs[1:]]
    p70=phi_for_z(zs[-1])
    side_phi=[math.radians(phi_bot)]+[phi_for_z(z) for z in zs]
    side_phi+=[p70+(math.radians(phi_rim-3.0)-p70)*f for f in (0.4,0.75)]+[math.radians(phi_rim-3.0),math.radians(phi_rim-1.2),math.radians(phi_rim)]
    pts,rads=stem_centerline(RV,RF,zr)
    rstem=rads[0]*1.6; rim_r={}; bot_r={}
    def sq(az,r,frame=None):
        c,s=math.cos(az),math.sin(az); m=max(abs(c),abs(s)); k=0.88 if abs(abs(c)-abs(s))<0.2 else 1.0
        if frame is None: return Vector((c/m*r*0.82*k,s/m*r*0.82*k,0))
        X,Y=frame; return X*(c/m*r*0.82*k)+Y*(s/m*r*0.82*k)
    frames=[]
    for i,p in enumerate(pts):
        tg=(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized()
        X=tg.cross(Vector((0,1,0))) if abs(tg.y)<0.9 else tg.cross(Vector((1,0,0))); X.normalize(); Y=tg.cross(X).normalized()
        frames.append((X,Y))
    PLAT=[0.2,0.4,0.58,0.74]; T16=0.86
    def nearest(dct,a): k=min(dct,key=lambda b:min(abs(b-a),360-abs(b-a))); return dct[k]
    def place(kind,i,a):
        az=math.radians(a+off)
        if kind=="side":
            q=hit(side_phi[i],az)
            if q and i==len(side_phi)-1: rim_r[round(a,3)]=q.xy.length
            if q and i==0: bot_r[round(a,3)]=q.xy.length
            return q if q else C
        if kind in ("plateau","top16"):
            t=PLAT[i] if kind=="plateau" else T16
            r=nearest(rim_r,a)*(1-t)+rstem*t; q=vhit(math.cos(az)*r,math.sin(az)*r,True)
            return q if q else Vector((math.cos(az)*r,math.sin(az)*r,zr))
        if kind=="stembase":
            p=sq(az,rads[0]*1.35); q=vhit(p.x+pts[0].x,p.y+pts[0].y,True); return q if q else pts[0]+p
        if kind=="stem":
            last=i>=len(pts)-1; return pts[i]+sq(az,rads[i]*(1.3 if last else 1.0),frames[i])
        if kind in ("bottom16","bottom8"):
            r=nearest(bot_r,a)*(0.55 if kind=="bottom16" else 0.22); q=vhit(math.cos(az)*r,math.sin(az)*r,False)
            return q if q else Vector((math.cos(az)*r,math.sin(az)*r,zb))
    V,F,cols=build_pumpkin2(place,K=K,side_z=side_phi,plateau=PLAT,n_stem=len(pts))
    # uncarved front: same lobe phase from the back lobes
    for r_ in range(len(side_phi)):
        ring=list(range(r_*cols,(r_+1)*cols))
        for c in range(cols):
            v=V[ring[c]]; ang=math.degrees(math.atan2(v.y,v.x))
            if -158<ang<-22 and zb+0.05<v.z<zr-0.02:
                same=[V[ring[j]] for j in range(cols) if j%K==c%K and not (-180<math.degrees(math.atan2(V[ring[j]].y,V[ring[j]].x))<-0)]
                if same:
                    rr=float(np.mean([w.xy.length for w in same])); zz=float(np.mean([w.z for w in same])); t=math.atan2(v.y,v.x)
                    V[ring[c]]=Vector((math.cos(t)*rr,math.sin(t)*rr,zz))
    me=bpy.data.meshes.new(obj_name+".uncarved"); me.from_pydata([tuple(v) for v in V],[],F)
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    for f in bm.faces: f.smooth=True
    bm.to_mesh(me); bm.free(); me.use_fake_user=True
    return me,{"groove_offset":off,"grooves_found":gro,"rim_z":round(zr,3),"bottom_z":round(zb,3),"stem_samples":len(pts),"stem_r":[round(x,3) for x in rads]}
def carve_features(ref_name,unc_me,obj_name,coll,eps=0.006,thr=0.016,N_scale=1.0,zmin_safe=0.11):
    ref=bpy.data.objects[ref_name]; RV,RF,_=ref_tree(ref)
    bt=BVHTree.FromPolygons([v.co.copy() for v in unc_me.vertices],[list(q.vertices) for q in unc_me.polygons])
    R0=float(np.median([v.co.xy.length for v in unc_me.vertices]))
    def dep(co):
        d=Vector((co.x,co.y,0)).normalized(); h=bt.ray_cast(co+d*1.5,-d,3.0); return (h[0].xy.length-co.xy.length) if h[0] else 0.0
    def to2(v): return (math.atan2(v.y,v.x)*R0, v.z)
    def surf(u,z):
        t=u/R0; d=Vector((math.cos(t),math.sin(t),0)); h=bt.ray_cast(Vector((0,0,z))+d*1.5,-d,3.0)
        return h[0] if h[0] else Vector((math.cos(t)*R0,math.sin(t)*R0,z))
    def pin(p,poly):
        x,y=p; ins=False
        for i in range(len(poly)):
            x1,y1=poly[i]; x2,y2=poly[(i+1)%len(poly)]
            if (y1>y)!=(y2>y) and x<x1+(y-y1)*(x2-x1)/(y2-y1): ins=not ins
        return ins
    bmr=bmesh.new()
    for v in RV: bmr.verts.new(v)
    bmr.verts.index_update(); bmr.verts.ensure_lookup_table()
    for f in RF: bmr.faces.new([bmr.verts[i] for i in f])
    bmr.faces.index_update()
    def inzone(c):
        a=math.degrees(math.atan2(c.y,c.x)); return -165<a<-15 and c.xy.length>0.3*R0
    rec={f.index:(dep(f.calc_center_median())>thr) for f in bmr.faces if inzone(f.calc_center_median())}
    adj=collections.defaultdict(list)
    for e in bmr.edges:
        fs=[f for f in e.link_faces if f.index in rec]
        if len(fs)==2 and rec[fs[0].index]!=rec[fs[1].index]:
            a,b=e.verts; adj[a.index].append(b.index); adj[b.index].append(a.index)
    bmr.free()
    seen=set(); loops=[]
    for s in adj:
        if s in seen: continue
        L=[s]; seen.add(s); prev=None; cur=s
        while True:
            nx=[n for n in adj[cur] if n!=prev and n not in seen]
            if not nx: break
            prev,cur=cur,nx[0]; L.append(cur); seen.add(cur)
        if L[0] in adj[L[-1]] and len(L)>=6: loops.append(L)
    feats=[]
    for L in loops:
        P=[to2(RV[i]) for i in L]
        P=[(u,max(z,zmin_safe)) for u,z in P]
        if signed_area(P)<0: P=P[::-1]
        if abs(signed_area(P))<0.002: continue
        def _simple(Q):
            n=len(Q)
            def ccw(p,q,r): return (r[1]-p[1])*(q[0]-p[0])>(q[1]-p[1])*(r[0]-p[0])
            for i in range(n):
                for j in range(i+2,n):
                    if i==0 and j==n-1: continue
                    a,b,c_,d=Q[i],Q[(i+1)%n],Q[j],Q[(j+1)%n]
                    if ccw(a,c_,d)!=ccw(b,c_,d) and ccw(a,b,c_)!=ccw(a,b,d): return False
            return True
        Q=None
        for e_ in (eps,eps*1.5,eps*2,eps*3,eps*4,eps*6):
            O=rdp_closed(P,e_)
            Qc=[O[0]]
            for q in O[1:]:
                if math.dist(q,Qc[-1])>0.006: Qc.append(q)
            if math.dist(Qc[0],Qc[-1])<0.006: Qc.pop()
            if len(Qc)>=3 and _simple(Qc): Q=Qc; break
        if Q is None: continue
        if signed_area(Q)<0: Q=Q[::-1]
        enc=[v for v in RV if pin(to2(v),Q)]
        d=[dep(v) for v in enc if dep(v)>0.02]
        feats.append({"outline":Q,"depth":float(np.median(d)) if d else 0.04,"raw":len(L),"area":abs(signed_area(Q))})
    feats.sort(key=lambda f:-f["area"])
    bm=bmesh.new(); bm.from_mesh(unc_me); log=[]
    lay=bm.faces.layers.int.new("grid")
    for f in bm.faces: f[lay]=1
    for ft in feats:
        others=[g["outline"] for g in feats if g is not ft]
        def front(co):
            a=math.degrees(math.atan2(co.y,co.x))
            return -179<a<-1 and co.xy.length>0.62*R0
        N=int(len(ft["outline"])*1.3*N_scale)
        for gd,hm in ((0.012,0.025),(0.022,0.035),(0.035,0.05),(0.05,0.07)):
            snap=bm.copy()
            lay=bm.faces.layers.int.get("grid")
            info=carve_structured(bm,to2,surf,ft["outline"],ft["depth"],N=N,hole_margin=hm,front=front,pin=pin,signed_area=signed_area,guard_d=gd,face_ok=lambda f,lay=lay: f[lay] in (1,2))
            ok=info["band_tris"]>0 and not info["extra_loops"] and not any(e.is_boundary for e in bm.edges)
            if ok: snap.free(); info["guard"]=gd; break
            bm.free(); bm=snap; info["guard"]="failed"
        info.update({"raw_loop":ft["raw"],"outline":len(ft["outline"]),"depth":round(ft["depth"],3)}); log.append(info)
    # floors: one flat n-gon each (rule from the manual cleanup)
    bm.normal_update()
    floors=[f for f in bm.faces if len(f.verts)>=3 and dep(f.calc_center_median())>0.02 and abs(f.normal.dot(Vector((f.calc_center_median().x,f.calc_center_median().y,0)).normalized()))>0.85]
    groups=[]; seenf=set()
    for f in floors:
        if f in seenf: continue
        st=[f]; g=[]
        while st:
            x=st.pop()
            if x in seenf: continue
            seenf.add(x); g.append(x)
            for e in x.edges:
                for y in e.link_faces:
                    if y in floors and y not in seenf: st.append(y)
        groups.append(g)
    merged=0
    for g in groups:
        if len(g)>1:
            r=bmesh.ops.dissolve_faces(bm,faces=g,use_verts=True); merged+=1
    for f in bm.faces:
        if len(f.verts)>4:
            c=f.calc_center_median(); P=np.array([v.co-c for v in f.verts]); n=Vector(np.linalg.svd(P)[2][2])
            for v in f.verts: v.co=v.co-n*(v.co-c).dot(n)
    open_b=[e for e in bm.edges if e.is_boundary]
    if open_b:
        r=bmesh.ops.holes_fill(bm,edges=open_b,sides=0)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    for f in bm.faces: f.smooth=True
    me=bpy.data.meshes.new(obj_name); bm.to_mesh(me); bm.free()
    ob=bpy.data.objects.get(obj_name) or bpy.data.objects.new(obj_name,me)
    old=ob.data if ob.data is not me else None; ob.data=me
    if coll not in ob.users_collection: coll.objects.link(ob)
    if old and old.users==0: bpy.data.meshes.remove(old)
    return ob,log,{"floors_merged":merged,"open_edges_filled":len(open_b)}
def rdp_closed(P,eps):
    n=len(P); i1=max(range(n),key=lambda i:math.dist(P[0],P[i]))
    def rdp(idx):
        if len(idx)<3: return idx
        a=np.array(P[idx[0]]); b=np.array(P[idx[-1]]); ab=b-a; L=np.linalg.norm(ab)
        d=[abs(np.cross(ab,np.array(P[i])-a))/L if L>1e-12 else math.dist(P[i],P[idx[0]]) for i in idx]
        k=int(np.argmax(d))
        if d[k]>eps: return rdp(idx[:k+1])[:-1]+rdp(idx[k:])
        return [idx[0],idx[-1]]
    return [P[i] for i in rdp(list(range(0,i1+1)))[:-1]+rdp(list(range(i1,n))+[0])[:-1]]
def evaluate(ob,ref_name):
    ref=bpy.data.objects[ref_name]; RV,RF,_=ref_tree(ref)
    me=ob.data; bm=bmesh.new(); bm.from_mesh(me)
    ot=BVHTree.FromPolygons([v.co.copy() for v in me.vertices],[list(q.vertices) for q in me.polygons])
    d=np.array([ot.find_nearest(v)[3] for v in RV])
    tri=bm.copy(); bmesh.ops.triangulate(tri,faces=tri.faces[:]); tri.faces.ensure_lookup_table()
    tree=BVHTree.FromPolygons([v.co for v in tri.verts],[[v.index for v in f.verts] for f in tri.faces])
    inter=sum(1 for a,b in tree.overlap(tree) if a<b and not (set(tri.faces[a].verts)&set(tri.faces[b].verts)))
    out={"verts":len(bm.verts),"tris_equiv":len(tri.faces),"ref_verts":len(RV),"ref_tris":len(RF),
         "quads":sum(1 for f in bm.faces if len(f.verts)==4),"tris":sum(1 for f in bm.faces if len(f.verts)==3),"ngons":sum(1 for f in bm.faces if len(f.verts)>4),
         "nonmanifold":sum(1 for e in bm.edges if not e.is_manifold),"intersections":inter,
         "dist_med_p90_max":[round(float(np.median(d)),4),round(float(np.percentile(d,90)),4),round(float(d.max()),4)]}
    tri.free(); bm.free(); return out
