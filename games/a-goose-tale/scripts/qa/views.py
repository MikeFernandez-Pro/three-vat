
import bpy, os, math, numpy as np
from mathutils import Vector
VIEWS={"front":((0,-3.4,0.42),(0,0,0.42)),"side":((3.4,0,0.42),(0,0,0.42)),
       "threequarter":((2.0,-2.6,0.25),(0,0,0.45)),"top":((0,-0.4,3.6),(0,0,0.3))}
def render_views(scene_name,outdir,tag,views=VIEWS,res=640):
    sc=bpy.data.scenes[scene_name]; cam=sc.camera
    sc.render.resolution_x=res; sc.render.resolution_y=res
    paths=[]
    for name,(loc,tgt) in views.items():
        cam.location=loc; dv=Vector(tgt)-Vector(loc); cam.rotation_euler=dv.to_track_quat('-Z','Y').to_euler()
        p=os.path.join(outdir,"%s_%s.png"%(tag,name)); sc.render.filepath=p
        bpy.ops.render.render(write_still=True,scene=scene_name); paths.append(p)
    # 2x2 contact sheet
    ims=[]
    for p in paths:
        im=bpy.data.images.load(p,check_existing=False); a=np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4); ims.append(a); bpy.data.images.remove(im)
    top=np.concatenate([ims[2],ims[3]],axis=1); bot=np.concatenate([ims[0],ims[1]],axis=1)
    sheet=np.concatenate([bot,top],axis=0)   # pixel rows start at the bottom
    h,w,_=sheet.shape
    img=bpy.data.images.get("SHEET_"+tag) or bpy.data.images.new("SHEET_"+tag,w,h)
    if img.size[0]!=w: img.scale(w,h)
    img.pixels.foreach_set(sheet.ravel())
    sp=os.path.join(outdir,"%s_sheet.png"%tag); img.filepath_raw=sp; img.file_format='PNG'; img.save()
    return sp,img.name
def peek(image_name):
    """show an image in the biggest editor for a screenshot; returns what to restore"""
    win=bpy.context.window
    a=max(bpy.context.screen.areas,key=lambda a:a.width*a.height)
    prev=a.ui_type; a.ui_type='IMAGE_EDITOR'; a.spaces.active.image=bpy.data.images[image_name]
    reg=[r for r in a.regions if r.type=='WINDOW'][0]
    with bpy.context.temp_override(window=win,area=a,region=reg,space_data=a.spaces.active):
        bpy.ops.image.view_all(fit_view=True)
    return prev
def unpeek():
    for a in bpy.context.screen.areas:
        if a.type=='IMAGE_EDITOR' and a.width*a.height==max(x.width*x.height for x in bpy.context.screen.areas):
            a.ui_type='VIEW_3D'
