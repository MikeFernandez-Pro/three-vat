# The dead trees' uvs (public/models/deadTrees.glb), 2026-10-26: the file came
# with one squashed unwrap per tree, so a bark set laid over it stretched. Each
# tree is welded where the file had split it, cut into a few broad islands by
# angle, each wrapping a good part of the way round its branch, and those
# unwrapped flat again by angle, so a cut falls only at an island's edge; each
# island is turned so its branch runs up the uv's v, as a bark set's grain
# does, and scaled to a uv unit a metre of the file, so every island takes the
# bark at one size.
#
# With `trunk`, a single upright trunk (the giant tree's first cut, 2026-10-26)
# is unwrapped round its axis instead, one seam down it: u the way round, m, at
# each point's own radius, v up it, m; a face looking up or down, a cap, laid
# flat from above.
#
#   blender -b -P scripts/generators/deadtrees_uv.py -- <in.glb> <out.glb> [trunk]
#
# A mesh whose material reads a texture, leaf cards cut out by theirs, keeps
# its own uvs and its vertex colours.
#
# Run on the file as downloaded (kept outside the repo), not on its own output.
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

src, dst, *mode = sys.argv[sys.argv.index('--') + 1 :]
angle = next((float(m) for m in mode if m.replace('.', '').isdigit()), None)
mode = [m for m in mode if not m.replace('.', '').isdigit()]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)

# How far apart two faces' normals may lean and still share an island, degrees: broad, so an island wraps much of its
# branch, the unwrap by angle after flattening it.
ANGLE = angle or 89
MARGIN = 0.02


def islands(bm, uv):
    """The faces in groups that share a uv edge."""
    seen = set()
    groups = []
    for face in bm.faces:
        if face.index in seen:
            continue
        seen.add(face.index)
        group, stack = [], [face]
        while stack:
            f = stack.pop()
            group.append(f)
            for loop in f.loops:
                other = loop.link_loop_radial_next
                if other == loop or other.face.index in seen:
                    continue
                # Shared in uv too: both ends of the edge meet.
                a, b = loop[uv].uv, loop.link_loop_next[uv].uv
                c, d = other.link_loop_next[uv].uv, other[uv].uv
                if (a - c).length < 1e-5 and (b - d).length < 1e-5:
                    seen.add(other.face.index)
                    stack.append(other.face)
        groups.append(group)
    return groups


def frame(face, uv):
    """How the face's points move per unit of u and of v, in 3D: its dP/du and dP/dv."""
    l0, l1, l2 = face.loops[0], face.loops[1], face.loops[2]
    e1, e2 = l1.vert.co - l0.vert.co, l2.vert.co - l0.vert.co
    s1, s2 = l1[uv].uv - l0[uv].uv, l2[uv].uv - l0[uv].uv
    det = s1.x * s2.y - s2.x * s1.y
    if abs(det) < 1e-12:
        return None
    return (e1 * s2.y - e2 * s1.y) / det, (e2 * s1.x - e1 * s2.x) / det


def lay(obj):
    mesh = obj.data
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(ANGLE), island_margin=MARGIN, scale_to_bounds=False, correct_aspect=True)
    # Cut along those islands' edges alone, and unwrap again by angle, flat with the least stretch.
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.seams_from_islands()
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=MARGIN)
    bpy.ops.object.mode_set(mode='OBJECT')

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active
    report = []
    for group in islands(bm, uv):
        # The branch's way: the island's longest spread in 3D, by its points' area-weighted spread; up the world's where it leans up.
        area = sum(f.calc_area() for f in group) or 1e-9
        centre = sum((f.calc_center_median() * f.calc_area() for f in group), Vector()) / area
        spread = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
        for f in group:
            d = f.calc_center_median() - centre
            spread += Matrix(((d.x * d.x, d.x * d.y, d.x * d.z), (d.y * d.x, d.y * d.y, d.y * d.z), (d.z * d.x, d.z * d.y, d.z * d.z))) * f.calc_area()
        axis = Vector((0, 0, 1))
        for _ in range(32):
            axis = (spread @ axis).normalized() if (spread @ axis).length > 1e-12 else axis
        # Blender's up is +z.
        if axis.z < 0:
            axis = -axis
        # That way in the uv, each face's dP/du and dP/dv solved for it, by area.
        way = Vector((0, 0))
        for f in group:
            tb = frame(f, uv)
            if not tb:
                continue
            t, b = tb
            g = Matrix(((t.dot(t), t.dot(b)), (t.dot(b), b.dot(b))))
            if abs(g.determinant()) < 1e-12:
                continue
            way += (g.inverted() @ Vector((t.dot(axis), b.dot(axis)))) * f.calc_area()
        turn = math.atan2(way.x, way.y) if way.length > 1e-9 else 0
        # A metre a uv unit: the island's surface over its uv area.
        uv_area = 0
        for f in group:
            pts = [l[uv].uv for l in f.loops]
            uv_area += abs(sum(pts[i].x * pts[i - 1].y - pts[i - 1].x * pts[i].y for i in range(len(pts)))) / 2
        size = math.sqrt(area / uv_area) if uv_area > 1e-12 else 1
        c, s = math.cos(turn), math.sin(turn)
        for f in group:
            for l in f.loops:
                p = l[uv].uv
                l[uv].uv = Vector((p.x * c - p.y * s, p.x * s + p.y * c)) * size
        # Back by whole tiles to near the origin: the same bark, small numbers.
        first = group[0].loops[0][uv].uv
        shift = Vector((math.floor(first.x), math.floor(first.y)))
        for f in group:
            for l in f.loops:
                l[uv].uv = l[uv].uv - shift
        # How far the island's v now runs off its branch, degrees, for the report.
        check = Vector((0, 0))
        for f in group:
            tb = frame(f, uv)
            if tb:
                t, b = tb
                g = Matrix(((t.dot(t), t.dot(b)), (t.dot(b), b.dot(b))))
                if abs(g.determinant()) > 1e-12:
                    check += (g.inverted() @ Vector((t.dot(axis), b.dot(axis)))) * f.calc_area()
        report.append((len(group), math.degrees(math.atan2(abs(check.x), check.y)) if check.length else 0, size))
    bm.to_mesh(mesh)
    bm.free()
    obj.select_set(False)
    worst = max(r[1] for r in report)
    # How even the bark's size is, face to face: each face's uv area over its own, the spread from the tenth to the ninetieth.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv = bm.loops.layers.uv.active
    ratios = []
    for f in bm.faces:
        pts = [l[uv].uv for l in f.loops]
        a = abs(sum(pts[i].x * pts[i - 1].y - pts[i - 1].x * pts[i].y for i in range(len(pts)))) / 2
        if f.calc_area() > 1e-9:
            ratios.append(a / f.calc_area())
    bm.free()
    ratios.sort()
    spread = (ratios[len(ratios) // 10], ratios[len(ratios) * 9 // 10])
    print(f'{obj.name}: {len(report)} islands, faces {sum(r[0] for r in report)}, v off its branch at worst {worst:.2f} deg, size {spread[0]:.2f} to {spread[1]:.2f}')


def round_axis(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active or bm.loops.layers.uv.new()
    caps = 0
    for f in bm.faces:
        # Blender's up is +z.
        if abs(f.normal.z) > 0.9:
            caps += 1
            for l in f.loops:
                l[uv].uv = Vector((l.vert.co.x, l.vert.co.y))
            continue
        turns = [math.atan2(l.vert.co.y, l.vert.co.x) for l in f.loops]
        # A face across the seam: its far side's angles a turn on, so it does not span the trunk.
        if max(turns) - min(turns) > math.pi:
            turns = [t + 2 * math.pi if t < 0 else t for t in turns]
        for l, t in zip(f.loops, turns):
            l[uv].uv = Vector((t * math.hypot(l.vert.co.x, l.vert.co.y), l.vert.co.z))
    bm.to_mesh(obj.data)
    bm.free()
    print(f'{obj.name}: unwrapped round its axis, {len(obj.data.polygons)} faces, {caps} caps')


def textured(obj):
    """Whether the mesh's material reads a texture: its uvs are the texture's, not for the bark."""
    return any(m and m.use_nodes and any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes) for m in obj.data.materials)


for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    if textured(obj):
        print(f'{obj.name}: textured, its uvs kept')
    elif mode == ['trunk']:
        round_axis(obj)
    else:
        lay(obj)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_tangents=False, export_yup=True, export_apply=False, export_vertex_color='ACTIVE')
