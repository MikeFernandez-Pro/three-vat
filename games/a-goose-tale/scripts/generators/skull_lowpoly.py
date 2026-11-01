
"""Low-poly stylized skull built like the reference: a designed spherical cage
(rows/columns placed on the face landmarks: teeth, gum, nose, cheek, eyes, brow),
projected from the skull centre onto the target surface; each quad is split along
the diagonal that best follows the surface; creases > 35 deg are marked sharp."""
import bpy, bmesh, math, json, os
from mathutils import Vector
from mathutils.bvhtree import BVHTree
CENTER=Vector((0.0,0.60,0.45))
# rows: elevation (deg) chosen so that, at the front, they land on z = teeth bottom, gum, nose base,
# cheek, eye bottom, eye middle, brow, brow top, forehead ... (z = 0.45 + 0.6*tan(phi))
ROWS=[-75,-58,-44,-36.9,-31.7,-22.6,-14.0,-4.8,4.8,15.8,22.6,30.3,40,52,66,80]
# columns: azimuth from the front (deg); dense over nose / eyes / cheeks, sparse on the cranium
COLS=[0,8,16,25,35,46,58,72,90,112,135,158,180]
def build(target_tree,name="skull.lowpoly",coll=None,rows=ROWS,cols=COLS,sharp_deg=35.0,landmarks=None,snap_max=0.06):
    az=[-c for c in reversed(cols[1:-1])]+cols   # 0 .. 180 then mirrored -> full ring order
    ring_az=[math.radians(a) for a in ([0]+cols[1:-1]+[180]+[-c for c in reversed(cols[1:-1])])]
    verts=[]; rings=[]
    def cast(phi,th):
        d=Vector((math.sin(th)*math.cos(phi),-math.cos(th)*math.cos(phi),math.sin(phi)))
        hit=target_tree.ray_cast(CENTER,d,5.0)
        return hit[0] if hit[0] is not None else CENTER+d*0.5
    for ph in rows:
        r=[]
        for th in ring_az:
            verts.append(cast(math.radians(ph),th)); r.append(len(verts)-1)
        rings.append(r)
    verts.append(cast(math.radians(-90),0.0)); bot=len(verts)-1
    verts.append(cast(math.radians(90),0.0)); top=len(verts)-1
    # landmark snapping: every target corner pulls its nearest cage vertex onto it,
    # so that our edges run through the same crease points as the reference
    if landmarks:
        from mathutils.kdtree import KDTree
        kd=KDTree(len(verts))
        for i,v in enumerate(verts): kd.insert(v,i)
        kd.balance()
        pairs=[]
        for li,L in enumerate(landmarks):
            for (co,idx,dist) in kd.find_n(L,3): pairs.append((dist,li,idx))
        pairs.sort(); usedL=set(); usedV=set()
        for dist,li,idx in pairs:
            if dist>snap_max or li in usedL or idx in usedV: continue
            verts[idx]=landmarks[li].copy(); usedL.add(li); usedV.add(idx)
    faces=[]
    n=len(ring_az)
    def tri_split(a,b,c,d):
        # quad a-b-c-d ; choose the diagonal whose midpoint lies closest to the surface
        m1=(verts[a]+verts[c])/2; m2=(verts[b]+verts[d])/2
        d1=target_tree.find_nearest(m1)[3]; d2=target_tree.find_nearest(m2)[3]
        return [(a,b,c),(a,c,d)] if d1<=d2 else [(a,b,d),(b,c,d)]
    for i in range(len(rings)-1):
        A,B=rings[i],rings[i+1]
        for k in range(n):
            j=(k+1)%n
            faces+=tri_split(A[k],A[j],B[j],B[k])
    for k in range(n):
        j=(k+1)%n
        faces.append((rings[0][j],rings[0][k],bot)); faces.append((rings[-1][k],rings[-1][j],top))
    me=bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry(); me.from_pydata([tuple(v) for v in verts],[],faces)
    bm=bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    for e in bm.edges:
        e.smooth = not (len(e.link_faces)==2 and math.degrees(e.calc_face_angle())>sharp_deg)
    for f in bm.faces: f.smooth=True
    bm.to_mesh(me); bm.free()
    ob=bpy.data.objects.get(name) or bpy.data.objects.new(name,me)
    ob.data=me
    if coll and coll not in ob.users_collection: coll.objects.link(ob)
    return ob
