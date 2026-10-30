
"""Stylized skull - primary forms.
Front=-Y, up=+Z, unit height ~1. Shape = signed distance field (smooth unions,
real subtractions for the cavities). A dense sphere is shrink-projected onto the
zero level set, relaxed, voxel-remeshed, then decimated into faceted low poly."""
import bpy, bmesh, math, numpy as np
from mathutils import Vector

def rot_y(p,c,a):
    q=p-c; ca,sa=math.cos(a),math.sin(a)
    return np.stack([q[:,0]*ca+q[:,2]*sa,q[:,1],-q[:,0]*sa+q[:,2]*ca],1)
def ell(p,c,r,ay=0.0):
    q=rot_y(p,np.array(c),ay) if ay else p-np.array(c)
    r=np.array(r); k0=np.linalg.norm(q/r,axis=1); k1=np.linalg.norm(q/(r*r),axis=1)
    return k0*(k0-1.0)/np.maximum(k1,1e-9)
def smin(a,b,k):
    h=np.clip(0.5+0.5*(b-a)/k,0,1); return b*(1-h)+a*h-k*h*(1-h)
def smax(a,b,k): return -smin(-a,-b,k)
def mirror(f,p): # f evaluated for +x feature and its mirror
    q=p.copy(); q[:,0]=np.abs(q[:,0]); return f(q)

def rbox(p,c,h,r,az=0.0):
    q=p-np.array(c)
    if az:
        ca,sa=math.cos(az),math.sin(az); q=np.stack([q[:,0]*ca+q[:,1]*sa,-q[:,0]*sa+q[:,1]*ca,q[:,2]],1)
    d=np.abs(q)-(np.array(h)-r)
    return np.linalg.norm(np.maximum(d,0),axis=1)+np.minimum(d.max(1),0)-r

P=dict(
 cranium=((0,0.08,0.63),(0.36,0.37,0.355)), occiput=((0,0.20,0.55),(0.30,0.24,0.27)),
 forehead=((0,-0.11,0.66),(0.33,0.27,0.27)), faceplate=((0,-0.20,0.43),(0.335,0.215,0.25)),
 maxilla=((0,-0.19,0.20),(0.25,0.21,0.15)),
 cheek=((0.28,-0.25,0.33),(0.12,0.13,0.105)), zyg=((0.34,-0.08,0.33),(0.045,0.15,0.04)),
 brow=((0.175,-0.335,0.555),(0.185,0.075,0.062),0.45),
 socket=((0.165,-0.45,0.42),(0.15,0.24,0.10),-0.32),
 glabella=((0.0,-0.44,0.55),(0.035,0.09,0.065)),
 browgroove=((0.16,-0.43,0.66),(0.17,0.10,0.045),0.3),
 nose_l=((0.05,-0.44,0.22),(0.048,0.2,0.068)), nose_t=((0.026,-0.44,0.31),(0.02,0.2,0.08),0.42),
 tooth_R=0.235, tooth_cy=-0.03, tooth_n=8, tooth_span=1.75,
 floor_front=0.0, floor_back=0.26,
)
def teeth_sdf(p,P=P):
    d=np.full(len(p),9.0); n=P["tooth_n"]
    for i in range(n):
        u=(i-(n-1)/2)/((n-1)/2); th=u*P["tooth_span"]/2
        x=P["tooth_R"]*math.sin(th); y=P["tooth_cy"]-P["tooth_R"]*math.cos(th)
        w=0.027 if abs(u)<0.5 else 0.024; hz=0.062 if abs(u)<0.8 else 0.052
        zc=0.004*((i*7)%3)
        if i==n-2:   # the fang
            d=np.minimum(d,rbox(p,(x,y,0.0),(0.024,0.03,0.058),0.012,az=th))
            d=np.minimum(d,ell(p,(x,y,-0.075),(0.018,0.02,0.06)))
        else:
            d=np.minimum(d,rbox(p,(x,y,zc),(w,0.03,hz),0.012,az=th))
        d=np.minimum(d,ell(p,(x*1.02,y-0.004,0.095),(0.024,0.03,0.055)))
    return d
def sdf(p,P=P):
    d=ell(p,*P["cranium"])
    d=smin(d,ell(p,*P["occiput"]),0.15)
    d=smin(d,ell(p,*P["forehead"]),0.12)
    d=smin(d,ell(p,*P["faceplate"]),0.14)
    d=smin(d,ell(p,*P["maxilla"]),0.10)
    d=smin(d,mirror(lambda q: ell(q,*P["cheek"]),p),0.07)
    d=smin(d,mirror(lambda q: ell(q,*P["zyg"]),p),0.06)
    d=smin(d,mirror(lambda q: ell(q,P["brow"][0],P["brow"][1],P["brow"][2]),p),0.06)
    d=smax(d,-mirror(lambda q: ell(q,P["browgroove"][0],P["browgroove"][1],P["browgroove"][2]),p),0.05)
    d=smax(d,-ell(p,*P["glabella"]),0.03)
    d=smax(d,-mirror(lambda q: ell(q,P["socket"][0],P["socket"][1],P["socket"][2]),p),0.022)
    nose=np.minimum(mirror(lambda q: ell(q,*P["nose_l"]),p),mirror(lambda q: ell(q,P["nose_t"][0],P["nose_t"][1],P["nose_t"][2]),p))
    d=smax(d,-nose,0.012)
    zf=P["floor_front"]+(P["floor_back"]-P["floor_front"])*np.clip((p[:,1]+0.05)/0.45,0,1)
    d=smax(d,zf+0.045-p[:,2],0.03)
    d=smin(d,teeth_sdf(p),0.006)
    return d

def grad(p,eps=1e-3):
    g=np.zeros_like(p)
    for i in range(3):
        e=np.zeros(3); e[i]=eps
        g[:,i]=(sdf(p+e)-sdf(p-e))/(2*eps)
    return g

def build_primary(coll,name="skull",subdiv=6,iters=45,voxel=0.008,decimate=0.02):
    bm=bmesh.new(); bmesh.ops.create_icosphere(bm,subdivisions=subdiv,radius=0.75)
    bmesh.ops.translate(bm,verts=bm.verts,vec=(0,0.02,0.45))
    me=bpy.data.meshes.new(name+".tmp"); bm.to_mesh(me); bm.free()
    co=np.zeros(len(me.vertices)*3); me.vertices.foreach_get("co",co); P_=co.reshape(-1,3)
    # neighbour lists for relaxation
    ev=np.zeros(len(me.edges)*2,dtype=np.int64); me.edges.foreach_get("vertices",ev); ev=ev.reshape(-1,2)
    n=len(P_)
    for it in range(iters):
        d=sdf(P_); g=grad(P_); gn=np.maximum((g*g).sum(1),1e-9)
        P_=P_-(d/gn)[:,None]*g*0.9
        if it<iters-8:
            # tangential relaxation (umbrella) to keep triangles even
            acc=np.zeros_like(P_); cnt=np.zeros(n)
            np.add.at(acc,ev[:,0],P_[ev[:,1]]); np.add.at(acc,ev[:,1],P_[ev[:,0]])
            np.add.at(cnt,ev[:,0],1); np.add.at(cnt,ev[:,1],1)
            avg=acc/cnt[:,None]; P_=P_+0.35*(avg-P_)
    me.vertices.foreach_set("co",P_.ravel()); me.update()
    ob=bpy.data.objects.get(name+".primary")
    if ob:
        old=ob.data; ob.data=me
        if old.users==0: bpy.data.meshes.remove(old)
    else:
        ob=bpy.data.objects.new(name+".primary",me); coll.objects.link(ob)
    me.name=name+".primary"
    ob.modifiers.clear()
    rm=ob.modifiers.new("remesh",'REMESH'); rm.mode='VOXEL'; rm.voxel_size=voxel; rm.use_smooth_shade=False
    dc=ob.modifiers.new("faceting",'DECIMATE'); dc.ratio=decimate; dc.use_symmetry=True; dc.symmetry_axis='X'
    err=np.abs(sdf(P_)); 
    return ob, float(err.max()), float(np.median(err))
