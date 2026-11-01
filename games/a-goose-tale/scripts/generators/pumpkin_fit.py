
"""Pumpkin retopology onto a reference surface (clean quad grid, our topology).
1) lobes: groove angles detected on the reference (local minima of the radius), tracked ring by ring
2) columns: K per lobe between two grooves (groove, flank, crest, flank) -> grooves lie on our edges
3) rows: rays from an inner centre at chosen elevations (bottom dimple ... top rim)
4) carved front: vertices that fall into the carving get the radius of the same lobe phase on the
   uncarved lobes (the face is cut later with its own loops)
5) stem: swept bevelled square section along the reference stem centre line"""
import bpy, bmesh, math, collections
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
def radius_profile(tree,z,n=720,R=2.0):
    th=np.linspace(-math.pi,math.pi,n,endpoint=False); r=np.zeros(n)
    for i,t in enumerate(th):
        d=Vector((math.cos(t),math.sin(t),0)); hit=tree.ray_cast(Vector((0,0,z))+d*R,-d,R)
        r[i]=(hit[0].xy.length if hit[0] else np.nan)
    return th,r
def detect_grooves(tree,z,n_expected=(8,12),min_sep_deg=22,exclude_front=True):
    th,r=radius_profile(tree,z)
    k=9; rs=np.convolve(np.nan_to_num(np.concatenate([r[-k:],r,r[:k]]),nan=np.nanmean(r)),np.ones(k)/k,'same')[k:-k]
    mins=[i for i in range(len(rs)) if rs[i]<=rs[i-1] and rs[i]<=rs[(i+1)%len(rs)]]
    # keep deep minima, enforce spacing
    mins=sorted(mins,key=lambda i:rs[i])
    sel=[]
    for i in mins:
        a=math.degrees(th[i])
        if exclude_front and -150<a<-30: continue
        if all(abs((a-b+180)%360-180)>min_sep_deg for b in sel): sel.append(a)
    return sorted(sel)
def fill_front_grooves(back,lobes):
    # back grooves cover the rear; fill the front gap with evenly spaced grooves of the mean spacing
    back=sorted(back); gaps=[(back[(i+1)%len(back)]-back[i])%360 for i in range(len(back))]
    gi=int(np.argmax(gaps)); g=gaps[gi]; n_missing=max(0,lobes-len(back))
    new=[back[gi]+g*(j+1)/(n_missing+1) for j in range(n_missing)]
    return sorted([((a+180)%360)-180 for a in back+new])

SQ=[(1,0.55),(0.55,1),(-0.55,1),(-1,0.55),(-1,-0.55),(-0.55,-1),(0.55,-1),(1,-0.55)]
def fit_body(tree,grooves_deg,K=4,center=(0,0,0.4),phis=(-80,-68,-55,-42,-30,-20,-10,0,9,18,27,36,45,54,62,70,77),
             face=(-150,-30,0.12,0.66),top_pole_z=None):
    C=Vector(center); g=sorted(grooves_deg); N=len(g)
    az=[]
    for i in range(N):
        a0=g[i]; a1=g[(i+1)%N]+(360 if i==N-1 else 0)
        for k in range(K): az.append(math.radians(a0+(a1-a0)*k/K))
    cols=len(az); verts=[]; rings=[]; phase=[k%K for k in range(cols)]
    for ph in phis:
        ring=[]
        for t in az:
            d=Vector((math.cos(t)*math.cos(math.radians(ph)),math.sin(t)*math.cos(math.radians(ph)),math.sin(math.radians(ph))))
            hit=tree.ray_cast(C,d,5.0); verts.append(hit[0] if hit[0] else C+d*0.5); ring.append(len(verts)-1)
        rings.append(ring)
    # carved front: replace by the mean radius of the same (ring, phase) on the uncarved lobes
    a0,a1,z0,z1=face
    for ri,ring in enumerate(rings):
        for c,vi in enumerate(ring):
            v=verts[vi]; a=math.degrees(math.atan2(v.y,v.x))
            if a0<a<a1 and z0<v.z<z1:
                same=[verts[ring[j]] for j in range(cols) if phase[j]==phase[c] and not (a0-20<math.degrees(math.atan2(verts[ring[j]].y,verts[ring[j]].x))<a1+20)]
                if same:
                    rr=np.mean([w.xy.length for w in same]); zz=np.mean([w.z for w in same])
                    t=math.atan2(v.y,v.x); verts[vi]=Vector((math.cos(t)*rr,math.sin(t)*rr,zz))
    hb=tree.ray_cast(C,Vector((0,0,-1)),5.0)[0]; verts.append(hb); bot=len(verts)-1
    top=Vector((0,0,top_pole_z)) if top_pole_z is not None else C+Vector((0,0,0.3))
    verts.append(top); topi=len(verts)-1
    faces=[]
    for i in range(len(rings)-1):
        A,B=rings[i],rings[i+1]
        for c in range(cols): faces.append((A[c],A[(c+1)%cols],B[(c+1)%cols],B[c]))
    for c in range(cols):
        faces.append((rings[0][(c+1)%cols],rings[0][c],bot)); faces.append((rings[-1][c],rings[-1][(c+1)%cols],topi))
    return verts,faces
def stem_from_ref(ref_verts,zmin,rmax=0.24,slices=8,section=SQ,cap=1.25):
    S=[v for v in ref_verts if v.z>zmin and v.xy.length<rmax+0.5*(v.z-zmin)]
    zs=sorted(v.z for v in S); lo,hi=zs[0],zs[-1]
    pts=[];rads=[]
    for i in range(slices+1):
        z=lo+(hi-lo)*i/slices; band=[v for v in S if abs(v.z-z)<(hi-lo)/slices*0.6]
        if not band: continue
        c=sum(band,Vector())/len(band); pts.append(c); rads.append(np.median([(v-c).xy.length for v in band]))
    return pts,rads
def sweep(verts,faces,pts,rads,section=SQ,cap=1.25):
    prev=None;first=None
    for i,p in enumerate(pts):
        tg=(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized()
        side=tg.cross(Vector((0,1,0))).normalized() if abs(tg.y)<0.9 else Vector((1,0,0)); up=side.cross(tg).normalized()
        s=rads[i]*(cap if i==len(pts)-1 else 1.0)
        ring=[]
        for (u,v) in section:
            verts.append(p+side*u*s*0.75+up*v*s*0.75); ring.append(len(verts)-1)
        if prev:
            m=len(ring)
            for k in range(m): faces.append((prev[k],prev[(k+1)%m],ring[(k+1)%m],ring[k]))
        else: first=ring
        prev=ring
    faces.append(tuple(prev)); faces.append(tuple(reversed(first)))
def make(name,coll,verts,faces,sharp_deg=None):
    me=bpy.data.meshes.get(name) or bpy.data.meshes.new(name); me.clear_geometry(); me.from_pydata([tuple(v) for v in verts],[],faces)
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    for f in bm.faces: f.smooth=True
    for e in bm.edges: e.smooth=True
    bm.to_mesh(me); bm.free()
    ob=bpy.data.objects.get(name) or bpy.data.objects.new(name,me); ob.data=me
    if coll not in ob.users_collection: coll.objects.link(ob)
    return ob

def carve_from_reference(body_ob,RV,RF,face=(-155,-25,0.08,0.7),thr=0.025,bins=32,depth_pct=85,max_depth=0.2):
    """Find the recessed parts of the reference face (relative to our uncarved body), turn each one
    into a star-shaped outline in (angle, z), build a radial cutter of the measured depth, cut with EXACT booleans."""
    me=body_ob.data
    bt=BVHTree.FromPolygons([v.co.copy() for v in me.vertices],[list(p.vertices) for p in me.polygons])
    def recess(v):
        a=math.degrees(math.atan2(v.y,v.x))
        if not (face[0]<a<face[1] and face[2]<v.z<face[3]): return 0.0
        d=Vector((v.x,v.y,0)).normalized(); h=bt.ray_cast(v+d*1.5,-d,3.0)
        return (h[0].xy.length-v.xy.length) if h[0] else 0.0
    rec=[recess(v) for v in RV]
    bm=bmesh.new()
    for v in RV: bm.verts.new(v)
    bm.verts.index_update(); bm.verts.ensure_lookup_table()
    for f in RF: bm.faces.new([bm.verts[i] for i in f])
    bm.faces.index_update(); bm.faces.ensure_lookup_table()
    cut=set(f.index for f in bm.faces if sum(rec[v.index]>thr for v in f.verts)>=2)
    comp={}; k=0
    for fi in cut:
        if fi in comp: continue
        st=[fi]
        while st:
            x=st.pop()
            if x in comp: continue
            comp[x]=k
            for e in bm.faces[x].edges:
                for g in e.link_faces:
                    if g.index in cut and g.index not in comp: st.append(g.index)
        k+=1
    groups=collections.defaultdict(list)
    for fi,c in comp.items(): groups[c].append(fi)
    def body_r(t,z):
        d=Vector((math.cos(t),math.sin(t),0)); h=bt.ray_cast(Vector((0,0,z))+d*1.5,-d,3.0); return h[0].xy.length if h[0] else 0.6
    cutters=[]
    for c,fis in groups.items():
        if len(fis)<4: continue
        if float(np.percentile([rec[v.index] for fi in fis for v in bm.faces[fi].verts],depth_pct))>max_depth: continue
        vs=set(v.index for fi in fis for v in bm.faces[fi].verts)
        P=np.array([(math.atan2(RV[i].y,RV[i].x),RV[i].z) for i in vs])
        depth=float(np.percentile([rec[i] for i in vs],depth_pct))
        cen=P.mean(0); sx=0.62
        best={}
        for j in range(len(P)):
            a=math.atan2(P[j,1]-cen[1],(P[j,0]-cen[0])*sx); b=int((a+math.pi)/(2*math.pi)*bins)%bins
            dd=math.hypot((P[j,0]-cen[0])*sx,P[j,1]-cen[1])
            if b not in best or dd>best[b][0]: best[b]=(dd,(P[j,0],P[j,1]),a)
        outline=[p for dd,p,a in sorted(best.values(),key=lambda t:t[2])]
        cutters.append((outline,depth,len(fis)))
    bm.free()
    cut_objs=[]
    for ci,(outline,depth,nf) in enumerate(cutters):
        n=len(outline); cv=[]
        for (t,z) in outline: r=body_r(t,z); cv.append((math.cos(t)*(r+0.1),math.sin(t)*(r+0.1),z))
        for (t,z) in outline: r=body_r(t,z); cv.append((math.cos(t)*(r-depth),math.sin(t)*(r-depth),z))
        cf=[list(range(n)),list(range(2*n-1,n-1,-1))]+[[i,(i+1)%n,n+(i+1)%n,n+i] for i in range(n)]
        cm=bpy.data.meshes.new("cut%d"%ci); cm.from_pydata(cv,[],cf)
        b2=bmesh.new(); b2.from_mesh(cm); bmesh.ops.recalc_face_normals(b2,faces=b2.faces); b2.to_mesh(cm); b2.free()
        co=bpy.data.objects.new("cut%d"%ci,cm); bpy.context.scene.collection.objects.link(co); cut_objs.append(co)
        md=body_ob.modifiers.new("cut%d"%ci,'BOOLEAN'); md.operation='DIFFERENCE'; md.solver='EXACT'; md.object=co
    bpy.context.view_layer.update()
    dg=bpy.context.evaluated_depsgraph_get(); dg.update()
    new=bpy.data.meshes.new_from_object(body_ob.evaluated_get(dg))
    body_ob.modifiers.clear()
    for co in cut_objs: bpy.data.objects.remove(co,do_unlink=True)
    b3=bmesh.new(); b3.from_mesh(new)
    bmesh.ops.triangulate(b3,faces=[f for f in b3.faces if len(f.verts)>4],quad_method='BEAUTY',ngon_method='BEAUTY')
    for f in b3.faces: f.smooth=True
    b3.to_mesh(new); b3.free()
    old=body_ob.data; body_ob.data=new
    return cutters
