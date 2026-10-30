
"""Clean carvings (eyes / nose / mouth) the way the reference is built:
outline with its corners -> hole in the grid -> zipper strip -> rim support loop -> straight walls
-> floor support loop -> one flat floor. No boolean, no slivers."""
import bpy, bmesh, math, collections
import numpy as np
from mathutils import Vector
def turning_corners(P2,k):
    n=len(P2); sc=[]
    for i in range(n):
        a=np.array(P2[i-1]); b=np.array(P2[i]); c=np.array(P2[(i+1)%n])
        u=b-a; v=c-b; nu=np.linalg.norm(u); nv=np.linalg.norm(v)
        if nu<1e-9 or nv<1e-9: sc.append(0); continue
        ang=math.acos(max(-1,min(1,float(u.dot(v)/(nu*nv))))); sc.append(ang)
    idx=sorted(range(n),key=lambda i:-sc[i]); out=[]
    for i in idx:
        if all(min(abs(i-j),n-abs(i-j))>n//(2*k) for j in out): out.append(i)
        if len(out)==k: break
    return sorted(out)
def simplify_outline(P2,corners,per_edge):
    n=len(P2); pts=[]
    for ci in range(len(corners)):
        a=corners[ci]; b=corners[(ci+1)%len(corners)]
        seg=[P2[(a+j)%n] for j in range((b-a)%n+1)]
        L=[0.0]
        for j in range(1,len(seg)): L.append(L[-1]+math.dist(seg[j],seg[j-1]))
        for s in range(per_edge+1):
            t=L[-1]*s/(per_edge+1); j=max(m for m in range(len(L)) if L[m]<=t+1e-12); j=min(j,len(seg)-2)
            u=(t-L[j])/max(1e-12,L[j+1]-L[j]); pts.append((seg[j][0]+(seg[j+1][0]-seg[j][0])*u, seg[j][1]+(seg[j+1][1]-seg[j][1])*u))
    return pts
def signed_area(P):
    return 0.5*sum(P[i][0]*P[(i+1)%len(P)][1]-P[(i+1)%len(P)][0]*P[i][1] for i in range(len(P)))
def zipper(A,B,posA,posB):
    """triangulate the band between two closed loops (index lists, same winding)"""
    na,nb=len(A),len(B)
    j0=min(range(nb),key=lambda j:(posB[B[j]]-posA[A[0]]).length)
    B=B[j0:]+B[:j0]
    i=j=0; F=[]
    while i<na or j<nb:
        a0,a1=A[i%na],A[(i+1)%na]; b0,b1=B[j%nb],B[(j+1)%nb]
        if i>=na: F.append((a0,b1,b0)); j+=1; continue
        if j>=nb: F.append((a0,a1,b0)); i+=1; continue
        if (posA[a1]-posB[b0]).length < (posA[a0]-posB[b1]).length: F.append((a0,a1,b0)); i+=1
        else: F.append((a0,b1,b0)); j+=1
    return F

def offset_polygon(P,d,max_miter=2.0):
    """outward offset of a CCW 2D polygon (mitred, clamped)"""
    n=len(P); out=[]
    for i in range(n):
        p0=np.array(P[i-1]); p1=np.array(P[i]); p2=np.array(P[(i+1)%n])
        e0=p1-p0; e1=p2-p1
        n0=np.array([e0[1],-e0[0]]); n1=np.array([e1[1],-e1[0]])
        n0/=max(1e-12,np.linalg.norm(n0)); n1/=max(1e-12,np.linalg.norm(n1))
        m=n0+n1; ml=np.linalg.norm(m)
        if ml<1e-9: m=n1; ml=1.0
        m/=ml; s=d/max(1/max_miter,float(m.dot(n1)))
        out.append(tuple(p1+m*s))
    return out
def carve_feature(bm,to2,surf,outline2,depth,margin=0.03,hole_scale=1.6,front=lambda co:True,pin=None,signed_area=None):
    """outline2: CCW 2D polygon (u,z). Builds: hole -> zipper band (beautified) -> outer band M -> rim R
       -> rim support R1 -> walls -> floor support -> flat floor."""
    cen=np.mean(np.array(outline2),0)
    Mo=offset_polygon(outline2,margin)
    grown=[(cen[0]+(x-cen[0])*hole_scale, cen[1]+(y-cen[1])*hole_scale) for x,y in Mo]
    before=set(e for e in bm.edges if e.is_boundary)
    kill=[f for f in bm.faces if front(f.calc_center_median()) and pin(to2(f.calc_center_median()),grown)]
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    bnd=[e for e in bm.edges if e.is_boundary and e not in before]
    ad=collections.defaultdict(list)
    for e in bnd:
        a,b=e.verts; ad[a].append(b); ad[b].append(a)
    start=bnd[0].verts[0]; B=[start]; prev=None; cur=start
    while True:
        nx=[w for w in ad[cur] if w is not prev and w not in B]
        if not nx: break
        prev,cur=cur,nx[0]; B.append(cur)
    if signed_area([to2(v.co) for v in B])<0: B=B[::-1]
    rim=[surf(x,y) for x,y in outline2]; mid=[surf(x,y) for x,y in Mo]
    radial=[Vector((p.x,p.y,0)).normalized() for p in rim]; c3=sum(rim,Vector())/len(rim)
    R1=[p-r*depth*0.12+(c3-p)*0.02 for p,r in zip(rim,radial)]
    W =[p-r*depth+(c3-p)*0.07 for p,r in zip(rim,radial)]
    Wc=sum(W,Vector())/len(W); Mx=np.array([w-Wc for w in W]); nrm=Vector(np.linalg.svd(Mx)[2][2])
    W=[w-nrm*(w-Wc).dot(nrm) for w in W]
    W1=[r1+(w-r1)*0.86 for r1,w in zip(R1,W)]
    W2=[w+(Wc-w)*0.1 for w in W]
    vM=[bm.verts.new(p) for p in mid]; vR=[bm.verts.new(p) for p in rim]; vR1=[bm.verts.new(p) for p in R1]
    vW1=[bm.verts.new(p) for p in W1]; vW=[bm.verts.new(p) for p in W]; vW2=[bm.verts.new(p) for p in W2]
    pos={v:v.co for v in B+vM}; band=[]
    for (a,b,c) in zipper(B,vM,pos,pos):
        try: band.append(bm.faces.new((a,b,c)))
        except ValueError: pass
    n=len(vR)
    for X,Y in ((vM,vR),(vR,vR1),(vR1,vW1),(vW1,vW),(vW,vW2)):
        for i in range(n): bm.faces.new((X[i],X[(i+1)%n],Y[(i+1)%n],Y[i]))
    fl=bm.faces.new(vW2); bmesh.ops.triangulate(bm,faces=[fl],quad_method='BEAUTY',ngon_method='BEAUTY')
    inner_edges=[e for e in set(e for f in band for e in f.edges) if all(f in band for f in e.link_faces) and len(e.link_faces)==2]
    bmesh.ops.beautify_fill(bm,faces=band,edges=inner_edges)
    return {"hole":len(B),"rim":n,"removed":len(kill)}

def chamfer_offset(P,d,corner_deg=25.0):
    """outward offset with chamfered corners: returns list of (first,last) 2D points per vertex"""
    n=len(P); out=[]
    for i in range(n):
        p0=np.array(P[i-1]); p1=np.array(P[i]); p2=np.array(P[(i+1)%n])
        e0=p1-p0; e1=p2-p1
        n0=np.array([e0[1],-e0[0]]); n1=np.array([e1[1],-e1[0]])
        n0/=max(1e-12,np.linalg.norm(n0)); n1/=max(1e-12,np.linalg.norm(n1))
        turn=math.degrees(math.acos(max(-1,min(1,float(n0.dot(n1))))))
        if turn>corner_deg: out.append((tuple(p1+n0*d),tuple(p1+n1*d)))
        else:
            m=(n0+n1); m/=max(1e-12,np.linalg.norm(m)); q=tuple(p1+m*d/max(0.5,float(m.dot(n1)))); out.append((q,q))
    return out
def carve_feature2(bm,to2,surf,outline2,depth,margin=0.03,hole_scale=1.35,front=lambda co:True,pin=None,signed_area=None):
    cen=np.mean(np.array(outline2),0)
    CH=chamfer_offset(outline2,margin)
    Mo=[]; idx=[]
    for a,b in CH:
        if a==b: idx.append((len(Mo),len(Mo))); Mo.append(a)
        else: idx.append((len(Mo),len(Mo)+1)); Mo+= [a,b]
    grown=[(cen[0]+(x-cen[0])*hole_scale, cen[1]+(y-cen[1])*hole_scale) for x,y in Mo]
    before=set(e for e in bm.edges if e.is_boundary)
    kill=[f for f in bm.faces if front(f.calc_center_median()) and pin(to2(f.calc_center_median()),grown)]
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    bnd=[e for e in bm.edges if e.is_boundary and e not in before]
    ad=collections.defaultdict(list)
    for e in bnd:
        a,b=e.verts; ad[a].append(b); ad[b].append(a)
    start=bnd[0].verts[0]; B=[start]; prev=None; cur=start
    while True:
        nx=[w for w in ad[cur] if w is not prev and w not in B]
        if not nx: break
        prev,cur=cur,nx[0]; B.append(cur)
    if signed_area([to2(v.co) for v in B])<0: B=B[::-1]
    rim=[surf(x,y) for x,y in outline2]; mid=[surf(x,y) for x,y in Mo]
    radial=[Vector((p.x,p.y,0)).normalized() for p in rim]; c3=sum(rim,Vector())/len(rim)
    R1=[p-r*depth*0.12+(c3-p)*0.02 for p,r in zip(rim,radial)]
    W =[p-r*depth+(c3-p)*0.07 for p,r in zip(rim,radial)]
    Wc=sum(W,Vector())/len(W); Mx=np.array([w-Wc for w in W]); nrm=Vector(np.linalg.svd(Mx)[2][2])
    W=[w-nrm*(w-Wc).dot(nrm) for w in W]
    W1=[r1+(w-r1)*0.86 for r1,w in zip(R1,W)]
    W2=[w+(Wc-w)*0.1 for w in W]
    vM=[bm.verts.new(p) for p in mid]; vR=[bm.verts.new(p) for p in rim]; vR1=[bm.verts.new(p) for p in R1]
    vW1=[bm.verts.new(p) for p in W1]; vW=[bm.verts.new(p) for p in W]; vW2=[bm.verts.new(p) for p in W2]
    pos={v:v.co for v in B+vM}; band=[]
    for (a,b,c) in zipper(B,vM,pos,pos):
        try: band.append(bm.faces.new((a,b,c)))
        except ValueError: pass
    n=len(vR)
    for i in range(n):
        j=(i+1)%n; a_first,a_last=idx[i]; b_first,b_last=idx[j]
        bm.faces.new((vM[a_last],vM[b_first],vR[j],vR[i]))
        if a_first!=a_last: bm.faces.new((vM[a_first],vM[a_last],vR[i]))
    for X,Y in ((vR,vR1),(vR1,vW1),(vW1,vW),(vW,vW2)):
        for i in range(n): bm.faces.new((X[i],X[(i+1)%n],Y[(i+1)%n],Y[i]))
    fl=bm.faces.new(vW2); bmesh.ops.triangulate(bm,faces=[fl],quad_method='BEAUTY',ngon_method='BEAUTY')
    inner_edges=[e for e in set(e for f in band for e in f.edges) if all(f in band for f in e.link_faces) and len(e.link_faces)==2]
    bmesh.ops.beautify_fill(bm,faces=band,edges=inner_edges)
    return {"hole":len(B),"rim":n,"mid":len(Mo),"removed":len(kill)}

def douglas_peucker(P,eps):
    """closed polygon simplification keeping the farthest-apart pair as anchors"""
    P=[tuple(p) for p in P]; n=len(P)
    i0=0; i1=max(range(n),key=lambda i:math.dist(P[0],P[i]))
    def rdp(pts):
        if len(pts)<3: return pts
        a=np.array(pts[0]); b=np.array(pts[-1]); ab=b-a; L=np.linalg.norm(ab)
        d=[abs(np.cross(ab,np.array(p)-a))/L if L>1e-12 else math.dist(p,pts[0]) for p in pts]
        k=int(np.argmax(d))
        if d[k]>eps: return rdp(pts[:k+1])[:-1]+rdp(pts[k:])
        return [pts[0],pts[-1]]
    A=P[i0:i1+1]; B=P[i1:]+P[:1]
    return rdp(A)[:-1]+rdp(B)[:-1]
def offset_signed(P,d,corner_deg=25.0,max_miter=1.6):
    """CCW polygon; convex corners chamfered (two points), concave corners mitred (one point)."""
    n=len(P); out=[]
    for i in range(n):
        p0=np.array(P[i-1]); p1=np.array(P[i]); p2=np.array(P[(i+1)%n])
        e0=p1-p0; e1=p2-p1
        n0=np.array([e0[1],-e0[0]]); n1=np.array([e1[1],-e1[0]])
        n0/=max(1e-12,np.linalg.norm(n0)); n1/=max(1e-12,np.linalg.norm(n1))
        convex=(e0[0]*e1[1]-e0[1]*e1[0])>0
        turn=math.degrees(math.acos(max(-1,min(1,float(n0.dot(n1))))))
        if convex and turn>corner_deg and d>0: out.append((tuple(p1+n0*d),tuple(p1+n1*d)))
        else:
            m=n0+n1; ml=np.linalg.norm(m); m=m/ml if ml>1e-9 else n1
            q=tuple(p1+m*d/max(1/max_miter,float(m.dot(n1)))); out.append((q,q))
    return out
def carve_feature3(bm,to2,surf,outline2,depth,margin=0.03,hole_margin=0.05,front=lambda co:True,pin=None,signed_area=None,floor_inset=0.012):
    CH=offset_signed(outline2,margin)
    Mo=[]; idx=[]
    for a,b in CH:
        if a==b: idx.append((len(Mo),len(Mo))); Mo.append(a)
        else: idx.append((len(Mo),len(Mo)+1)); Mo+=[a,b]
    hole=[a for a,b in offset_signed(Mo,hole_margin,corner_deg=360)]
    before=set(e for e in bm.edges if e.is_boundary)
    kill=[f for f in bm.faces if front(f.calc_center_median()) and pin(to2(f.calc_center_median()),hole)]
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    bnd=[e for e in bm.edges if e.is_boundary and e not in before]
    ad=collections.defaultdict(list)
    for e in bnd:
        a,b=e.verts; ad[a].append(b); ad[b].append(a)
    start=bnd[0].verts[0]; B=[start]; prev=None; cur=start
    while True:
        nx=[w for w in ad[cur] if w is not prev and w not in B]
        if not nx: break
        prev,cur=cur,nx[0]; B.append(cur)
    if signed_area([to2(v.co) for v in B])<0: B=B[::-1]
    rim=[surf(x,y) for x,y in outline2]; mid=[surf(x,y) for x,y in Mo]
    inner=[a for a,b in offset_signed(outline2,-floor_inset,corner_deg=360)]
    radial=[Vector((p.x,p.y,0)).normalized() for p in rim]
    R1=[p-r*depth*0.12 for p,r in zip(rim,radial)]
    W=[p-r*depth for p,r in zip(rim,radial)]
    Wc=sum(W,Vector())/len(W); Mx=np.array([w-Wc for w in W]); nrm=Vector(np.linalg.svd(Mx)[2][2])
    W=[w-nrm*(w-Wc).dot(nrm) for w in W]
    W1=[r1+(w-r1)*0.86 for r1,w in zip(R1,W)]
    W2=[]
    for (x,y),w,r in zip(inner,W,radial):
        q=surf(x,y)-Vector((q_ for q_ in (0,0,0))); q=q-Vector((q.x,q.y,0)).normalized()*depth
        q=q-nrm*(q-Wc).dot(nrm); W2.append(q)
    vM=[bm.verts.new(p) for p in mid]; vR=[bm.verts.new(p) for p in rim]; vR1=[bm.verts.new(p) for p in R1]
    vW1=[bm.verts.new(p) for p in W1]; vW=[bm.verts.new(p) for p in W]; vW2=[bm.verts.new(p) for p in W2]
    pos={v:v.co for v in B+vM}; band=[]
    for (a,b,c) in zipper(B,vM,pos,pos):
        try: band.append(bm.faces.new((a,b,c)))
        except ValueError: pass
    n=len(vR)
    for i in range(n):
        j=(i+1)%n; a_first,a_last=idx[i]; b_first,b_last=idx[j]
        bm.faces.new((vM[a_last],vM[b_first],vR[j],vR[i]))
        if a_first!=a_last: bm.faces.new((vM[a_first],vM[a_last],vR[i]))
    for X,Y in ((vR,vR1),(vR1,vW1),(vW1,vW),(vW,vW2)):
        for i in range(n): bm.faces.new((X[i],X[(i+1)%n],Y[(i+1)%n],Y[i]))
    fl=bm.faces.new(vW2); bmesh.ops.triangulate(bm,faces=[fl],quad_method='BEAUTY',ngon_method='BEAUTY')
    inner_edges=[e for e in set(e for f in band for e in f.edges) if all(f in band for f in e.link_faces) and len(e.link_faces)==2]
    bmesh.ops.beautify_fill(bm,faces=band,edges=inner_edges)
    return {"hole":len(B),"rim":n,"mid":len(Mo),"removed":len(kill)}

def carve_simple(bm,to2,surf,outline2,depth,hole_margin=0.03,front=lambda co:True,pin=None,signed_area=None):
    """Light carving like the reference mouth: rim loop on the surface -> one straight wall -> flat floor.
       Grid hole boundary is zipped to the rim and the band/floor triangles are beautified."""
    hole=[a for a,b in offset_signed(outline2,hole_margin,corner_deg=360)]
    before=set(e for e in bm.edges if e.is_boundary)
    kill=[f for f in bm.faces if front(f.calc_center_median()) and pin(to2(f.calc_center_median()),hole)]
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    bnd=[e for e in bm.edges if e.is_boundary and e not in before]
    ad=collections.defaultdict(list)
    for e in bnd:
        a,b=e.verts; ad[a].append(b); ad[b].append(a)
    start=bnd[0].verts[0]; B=[start]; prev=None; cur=start
    while True:
        nx=[w for w in ad[cur] if w is not prev and w not in B]
        if not nx: break
        prev,cur=cur,nx[0]; B.append(cur)
    if signed_area([to2(v.co) for v in B])<0: B=B[::-1]
    rim=[surf(x,y) for x,y in outline2]
    W=[p-Vector((p.x,p.y,0)).normalized()*depth for p in rim]
    Wc=sum(W,Vector())/len(W); Mx=np.array([w-Wc for w in W]); nrm=Vector(np.linalg.svd(Mx)[2][2])
    W=[w-nrm*(w-Wc).dot(nrm) for w in W]
    vR=[bm.verts.new(p) for p in rim]; vW=[bm.verts.new(p) for p in W]
    pos={v:v.co for v in B+vR}; band=[]
    for (a,b,c) in zipper(B,vR,pos,pos):
        try: band.append(bm.faces.new((a,b,c)))
        except ValueError: pass
    n=len(vR)
    for i in range(n): bm.faces.new((vR[i],vR[(i+1)%n],vW[(i+1)%n],vW[i]))
    fl=bm.faces.new(vW)
    res=bmesh.ops.triangulate(bm,faces=[fl],quad_method='BEAUTY',ngon_method='BEAUTY')
    floor=res["faces"]
    for grp in (band,floor):
        ie=[e for e in set(e for f in grp for e in f.edges) if len(e.link_faces)==2 and all(g in grp for g in e.link_faces)]
        bmesh.ops.beautify_fill(bm,faces=grp,edges=ie)
    return {"hole":len(B),"rim":n,"removed":len(kill)}

def carve_bevel(bm,to2,surf,outline2,depth,bevel_w=0.012,bevel_d=0.008,floor_inset=0.008,hole_margin=0.025,front=lambda co:True,pin=None,signed_area=None):
    """Carving with a regular lip bevel and a floor split in strips:
       grid hole -> zipper -> outer bevel edge E (on the surface) -> lip edge O (slightly sunk)
       -> straight wall -> floor edge W -> inset ring Wi -> floor core."""
    CH=offset_signed(outline2,bevel_w)
    E2=[]; idx=[]
    for a,b in CH:
        if a==b: idx.append((len(E2),len(E2))); E2.append(a)
        else: idx.append((len(E2),len(E2)+1)); E2+=[a,b]
    hole=[a for a,b in offset_signed(E2,hole_margin,corner_deg=360)]
    before=set(e for e in bm.edges if e.is_boundary)
    kill=[f for f in bm.faces if front(f.calc_center_median()) and pin(to2(f.calc_center_median()),hole)]
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    bnd=[e for e in bm.edges if e.is_boundary and e not in before]
    ad=collections.defaultdict(list)
    for e in bnd:
        a,b=e.verts; ad[a].append(b); ad[b].append(a)
    start=bnd[0].verts[0]; B=[start]; prev=None; cur=start
    while True:
        nx=[w for w in ad[cur] if w is not prev and w not in B]
        if not nx: break
        prev,cur=cur,nx[0]; B.append(cur)
    if signed_area([to2(v.co) for v in B])<0: B=B[::-1]
    Ep=[surf(x,y) for x,y in E2]
    rad=lambda p: Vector((p.x,p.y,0)).normalized()
    O=[surf(x,y) for x,y in outline2]; O=[p-rad(p)*bevel_d for p in O]
    W=[p-rad(p)*(depth-bevel_d) for p in O]
    Wc=sum(W,Vector())/len(W); Mx=np.array([w-Wc for w in W]); nrm=Vector(np.linalg.svd(Mx)[2][2])
    W=[w-nrm*(w-Wc).dot(nrm) for w in W]
    inner2=[a for a,b in offset_signed(outline2,-floor_inset,corner_deg=360)]
    Wi=[]
    for (x,y) in inner2:
        q=surf(x,y); q=q-rad(q)*depth; q=q-nrm*(q-Wc).dot(nrm); Wi.append(q)
    vE=[bm.verts.new(p) for p in Ep]; vO=[bm.verts.new(p) for p in O]; vW=[bm.verts.new(p) for p in W]; vWi=[bm.verts.new(p) for p in Wi]
    pos={v:v.co for v in B+vE}; band=[]
    for (a,b,c) in zipper(B,vE,pos,pos):
        try: band.append(bm.faces.new((a,b,c)))
        except ValueError: pass
    n=len(vO)
    for i in range(n):
        j=(i+1)%n; a_first,a_last=idx[i]; b_first,b_last=idx[j]
        bm.faces.new((vE[a_last],vE[b_first],vO[j],vO[i]))
        if a_first!=a_last: bm.faces.new((vE[a_first],vE[a_last],vO[i]))
    for X,Y in ((vO,vW),(vW,vWi)):
        for i in range(n): bm.faces.new((X[i],X[(i+1)%n],Y[(i+1)%n],Y[i]))
    core=bm.faces.new(vWi)
    res=bmesh.ops.triangulate(bm,faces=[core],quad_method='BEAUTY',ngon_method='BEAUTY'); floor=res["faces"]
    for grp in (band,floor):
        ie=[e for e in set(e for f in grp for e in f.edges) if len(e.link_faces)==2 and all(g in grp for g in e.link_faces)]
        if ie: bmesh.ops.beautify_fill(bm,faces=grp,edges=ie)
    holes=[e for e in bm.edges if e.is_boundary]
    if holes: bmesh.ops.holes_fill(bm,edges=holes,sides=12)
    return {"hole":len(B),"lip":n,"bevel_outer":len(E2),"removed":len(kill)}

def carve_light(bm,to2,surf,outline2,depth,margin=0.02,hole_margin=0.03,rim_support=0.22,front=lambda co:True,pin=None,signed_area=None):
    """Lighter carving for long outlines (mouths): outer band -> rim -> ONE wider support loop -> wall -> flat floor."""
    CH=offset_signed(outline2,margin)
    Mo=[]; idx=[]
    for a,b in CH:
        if a==b: idx.append((len(Mo),len(Mo))); Mo.append(a)
        else: idx.append((len(Mo),len(Mo)+1)); Mo+=[a,b]
    hole=[a for a,b in offset_signed(Mo,hole_margin,corner_deg=360)]
    before=set(e for e in bm.edges if e.is_boundary)
    kill=[f for f in bm.faces if front(f.calc_center_median()) and pin(to2(f.calc_center_median()),hole)]
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    bnd=[e for e in bm.edges if e.is_boundary and e not in before]
    ad=collections.defaultdict(list)
    for e in bnd:
        a,b=e.verts; ad[a].append(b); ad[b].append(a)
    start=bnd[0].verts[0]; B=[start]; prev=None; cur=start
    while True:
        nx=[w for w in ad[cur] if w is not prev and w not in B]
        if not nx: break
        prev,cur=cur,nx[0]; B.append(cur)
    if signed_area([to2(v.co) for v in B])<0: B=B[::-1]
    rad=lambda p: Vector((p.x,p.y,0)).normalized()
    rim=[surf(x,y) for x,y in outline2]; mid=[surf(x,y) for x,y in Mo]
    R1=[p-rad(p)*depth*rim_support for p in rim]
    W=[p-rad(p)*depth for p in rim]
    Wc=sum(W,Vector())/len(W); Mx=np.array([w-Wc for w in W]); nrm=Vector(np.linalg.svd(Mx)[2][2])
    W=[w-nrm*(w-Wc).dot(nrm) for w in W]
    vM=[bm.verts.new(p) for p in mid]; vR=[bm.verts.new(p) for p in rim]; vR1=[bm.verts.new(p) for p in R1]; vW=[bm.verts.new(p) for p in W]
    pos={v:v.co for v in B+vM}; band=[]
    for (a,b,c) in zipper(B,vM,pos,pos):
        try: band.append(bm.faces.new((a,b,c)))
        except ValueError: pass
    n=len(vR)
    for i in range(n):
        j=(i+1)%n; a_first,a_last=idx[i]; b_first,b_last=idx[j]
        bm.faces.new((vM[a_last],vM[b_first],vR[j],vR[i]))
        if a_first!=a_last: bm.faces.new((vM[a_first],vM[a_last],vR[i]))
    for X,Y in ((vR,vR1),(vR1,vW)):
        for i in range(n): bm.faces.new((X[i],X[(i+1)%n],Y[(i+1)%n],Y[i]))
    fl=bm.faces.new(vW)
    res=bmesh.ops.triangulate(bm,faces=[fl],quad_method='BEAUTY',ngon_method='BEAUTY'); floor=res["faces"]
    for grp in (band,floor):
        ie=[e for e in set(e for f in grp for e in f.edges) if len(e.link_faces)==2 and all(g in grp for g in e.link_faces)]
        if ie: bmesh.ops.beautify_fill(bm,faces=grp,edges=ie)
    holes=[e for e in bm.edges if e.is_boundary]
    if holes: bmesh.ops.holes_fill(bm,edges=holes,sides=12)
    return {"hole":len(B),"rim":n,"band":len(Mo),"removed":len(kill)}

from mathutils.geometry import delaunay_2d_cdt
def resample_keep(P,N):
    """resample a closed polygon to ~N points, keeping every original corner"""
    n=len(P); L=[math.dist(P[i],P[(i+1)%n]) for i in range(n)]; tot=sum(L); out=[]
    extra=max(0,N-n)
    for i in range(n):
        k=int(round(extra*L[i]/tot)); out.append(tuple(P[i]))
        for j in range(1,k+1):
            t=j/(k+1); out.append((P[i][0]+(P[(i+1)%n][0]-P[i][0])*t, P[i][1]+(P[(i+1)%n][1]-P[i][1])*t))
    return out
def cdt_region(outer,inner=None):
    """constrained Delaunay of the region inside 'outer' (and outside 'inner'); returns triangles as
       index tuples into outer+inner (no new vertices allowed)"""
    pts=list(outer)+(list(inner) if inner else [])
    no=len(outer); edges=[(i,(i+1)%no) for i in range(no)]
    if inner:
        ni=len(inner); edges+=[(no+i,no+(i+1)%ni) for i in range(ni)]
    vc,ed,fa,ov,oe,of=delaunay_2d_cdt([Vector(p) for p in pts],edges,[],0,1e-7)
    if len(vc)!=len(pts): return None
    remap={}
    for k,orig in enumerate(ov):
        if orig: remap[k]=orig[0]
    def inside(pt,poly):
        x,y=pt; ins=False
        for i in range(len(poly)):
            x1,y1=poly[i]; x2,y2=poly[(i+1)%len(poly)]
            if (y1>y)!=(y2>y) and x<x1+(y-y1)*(x2-x1)/(y2-y1): ins=not ins
        return ins
    tris=[]
    for f in fa:
        idx=[remap[k] for k in f]
        a,b,c_=pts[idx[0]],pts[idx[1]],pts[idx[2]]
        area=0.5*abs((b[0]-a[0])*(c_[1]-a[1])-(c_[0]-a[0])*(b[1]-a[1]))
        if area<2e-6: continue
        c=(sum(pts[i][0] for i in idx)/3, sum(pts[i][1] for i in idx)/3)
        if inside(c,outer) and not (inner and inside(c,inner)): tris.append(tuple(idx))
    return tris
def carve_structured(bm,to2,surf,outline2,depth,N=42,hole_margin=0.03,front=lambda co:True,pin=None,signed_area=None,guard_d=0.012,face_ok=lambda f:True):
    """Reference-like mouth: rim loop (N verts on the surface), ONE straight wall strip (rim i -> floor i),
       flat floor, everything triangulated by constrained Delaunay in the face plane (no overlaps),
       then paired into quads where the shape allows."""
    O=resample_keep(outline2,N)
    if signed_area(O)<0: O=O[::-1]
    Oa=np.array(O)
    def dpoly(p):
        p=np.array(p); a=Oa; b=np.roll(Oa,-1,axis=0); ab=b-a
        t=np.clip(((p-a)*ab).sum(1)/np.maximum((ab*ab).sum(1),1e-12),0,1)
        return float(np.min(np.linalg.norm(a+ab*t[:,None]-p,axis=1)))
    def seg_cross(a,b,c,d):
        def ccw(p,q,r): return (r[1]-p[1])*(q[0]-p[0])>(q[1]-p[1])*(r[0]-p[0])
        return ccw(a,c,d)!=ccw(b,c,d) and ccw(a,b,c)!=ccw(a,b,d)
    def touches(f):
        P=[to2(v.co) for v in f.verts]
        if any(pin(q,O) or dpoly(q)<guard_d for q in P): return True
        c=to2(f.calc_center_median())
        if pin(c,O) or dpoly(c)<hole_margin: return True
        return any(seg_cross(P[i],P[(i+1)%len(P)],O[j],O[(j+1)%len(O)]) for i in range(len(P)) for j in range(len(O)))
    before=set(e for e in bm.edges if e.is_boundary)
    kill=[f for f in bm.faces if face_ok(f) and front(f.calc_center_median()) and touches(f)]
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    bnd=[e for e in bm.edges if e.is_boundary and e not in before]
    ad=collections.defaultdict(list)
    for e in bnd:
        a,b=e.verts; ad[a].append(b); ad[b].append(a)
    seen=set(); loops=[]
    for s_ in ad:
        if s_ in seen: continue
        L=[s_]; seen.add(s_); prev=None; cur=s_
        while True:
            nx=[w for w in ad[cur] if w is not prev and w not in seen]
            if not nx: break
            prev,cur=cur,nx[0]; L.append(cur); seen.add(cur)
        loops.append(L)
    B=max(loops,key=len); extra_loops=[len(l) for l in loops if l is not B]
    B2=[to2(v.co) for v in B]
    if signed_area(B2)<0: B=B[::-1]; B2=B2[::-1]
    rad=lambda p: Vector((p.x,p.y,0)).normalized()
    def _cc(P,Q):
        def ccw(p,q,r): return (r[1]-p[1])*(q[0]-p[0])>(q[1]-p[1])*(r[0]-p[0])
        return sum(1 for i in range(len(P)) for j in range(len(Q)) if ccw(P[i],Q[j],Q[(j+1)%len(Q)])!=ccw(P[(i+1)%len(P)],Q[j],Q[(j+1)%len(Q)]) and ccw(P[i],P[(i+1)%len(P)],Q[j])!=ccw(P[i],P[(i+1)%len(P)],Q[(j+1)%len(Q)]))
    dbg_seg=[]
    def ccw(p,q,r): return (r[1]-p[1])*(q[0]-p[0])>(q[1]-p[1])*(r[0]-p[0])
    for i in range(len(B2)):
        for j in range(len(O)):
            P1,P2,Q1,Q2=B2[i],B2[(i+1)%len(B2)],O[j],O[(j+1)%len(O)]
            if ccw(P1,Q1,Q2)!=ccw(P2,Q1,Q2) and ccw(P1,P2,Q1)!=ccw(P1,P2,Q2):
                e=None
                for ed in B[i].link_edges:
                    if ed.other_vert(B[i]) is B[(i+1)%len(B)]: e=ed
                dbg_seg.append({"B":[[round(x,3) for x in P1],[round(x,3) for x in P2]],"O":[[round(x,3) for x in Q1],[round(x,3) for x in Q2]],"edge_found":e is not None,"edge_faces":len(e.link_faces) if e else None})
    dbg_cross=_cc(B2,O); dbg_inside=sum(1 for q in B2 if pin(q,O)); dbg_selfB=_cc(B2,B2)
    vR=[bm.verts.new(surf(x,y)) for x,y in O]
    Fp=[v.co-rad(v.co)*depth for v in vR]
    Fc=sum(Fp,Vector())/len(Fp); Mx=np.array([f-Fc for f in Fp]); nrm=Vector(np.linalg.svd(Mx)[2][2])
    Fp=[f-nrm*(f-Fc).dot(nrm) for f in Fp]
    vF=[bm.verts.new(p) for p in Fp]
    created=[]
    allv=B+vR
    for t in cdt_region(B2,O) or []:
        try: created.append(bm.faces.new([allv[i] for i in t]))
        except ValueError: pass
    band_layer=bm.faces.layers.int.get("grid")
    if band_layer:
        for f_ in created: f_[band_layer]=2
    n=len(vR)
    for i in range(n): bm.faces.new((vR[i],vR[(i+1)%n],vF[(i+1)%n],vF[i]))
    fl=[]
    for t in cdt_region(O) or []:
        try: fl.append(bm.faces.new([vF[i] for i in t]))
        except ValueError: pass
    for grp in (created,fl):
        bmesh.ops.join_triangles(bm,faces=grp,angle_face_threshold=math.radians(25),angle_shape_threshold=math.radians(35),cmp_seam=False,cmp_sharp=False,cmp_uvs=False,cmp_vcols=False,cmp_materials=False)
    return {"dbg_seg":dbg_seg[:3],"dbg_cross":dbg_cross,"dbg_B_inside_O":dbg_inside,"hole":len(B),"extra_loops":extra_loops,"rim":n,"removed":len(kill),"band_tris":len(created),"floor_tris":len(fl)}
