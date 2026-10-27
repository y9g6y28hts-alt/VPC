"""Path-traces a construction stage of the concept residence with Blender Cycles.

Input is the output of export-scene.mjs (world.glb, house-<t>.glb, baked ground
textures, shot-<name>.json). The geometry, materials, sun and camera are the
experience's own; Cycles adds what real-time rendering cannot: global
illumination, soft area shadows, glossy reflections and an atmospheric sky.
Half-built components are cut by their construction planes and capped.

The render is written as linear EXR and tone-mapped here (ACES fitted, as on
the site) to an 8-bit PNG, so the look does not depend on Blender's colour
management configuration.

usage: python3 tools/cinematic/render.py --dir <export dir> --t 1.000 --shot hero
       [--size 1600x900] [--samples 128] [--out frame.png] [--grass]
"""
import argparse
import json
import math
import os
import sys

import bpy  # noqa: I001 — bpy must load before bmesh/mathutils
import bmesh
import numpy as np
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument('--dir', required=True)
ap.add_argument('--t', default='1.000')
ap.add_argument('--shot', default='hero')
ap.add_argument('--size', default='1600x900')
ap.add_argument('--samples', type=int, default=128)
ap.add_argument('--out', default=None)
ap.add_argument('--exposure', type=float, default=0.0)
ap.add_argument('--grass', action='store_true', help='scatter real grass blades near the camera')
ap.add_argument('--threads', type=int, default=0)
ap.add_argument('--haze', type=float, default=0.0, help='atmospheric volume density (1/m), e.g. 0.0008')
ap.add_argument('--cams', default=None, help='JSON camera path (three coords): renders every pose in one session')
ap.add_argument('--outdir', default=None, help='with --cams: graded frames are written here as NNNN.png')
ap.add_argument('--grass-window', type=float, default=40.0)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

D = os.path.abspath(args.dir)
W, H = map(int, args.size.split('x'))
shot = json.load(open(os.path.join(D, f'shot-{args.shot}.json')))
out_png = os.path.abspath(args.out or os.path.join(D, f'render-{args.shot}-{args.t}.png'))


def b(v):
    """three.js (Y up) → Blender (Z up)."""
    return Vector((v[0], -v[2], v[1]))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ import
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(D, 'world.glb'))
world_objs = set(bpy.data.objects) - before
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(D, f'house-{args.t}.glb'))
house_objs = set(bpy.data.objects) - before


def make_single_user(ob):
    if ob.data.users > 1:
        ob.data = ob.data.copy()


# ------------------------------------------------- construction cut planes
def apply_clip(ob, planes):
    """Keeps the side n·p + c >= 0 of each (three.js world) plane and caps the cut."""
    make_single_user(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    mw = ob.matrix_world
    inv = mw.inverted()
    for nx, ny, nz, c in planes:
        n_w = b((nx, ny, nz)).normalized()
        p_w = n_w * (-c)
        co = inv @ p_w
        no = mw.to_3x3().transposed() @ n_w  # plane normals transform by Aᵀ
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no.normalized(), clear_inner=True)
        cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if cut_edges:
            bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
    bm.to_mesh(ob.data)
    bm.free()


clipped = 0
for ob in house_objs:
    if ob.type == 'MESH' and 'clip' in ob.keys():
        apply_clip(ob, [list(p) for p in ob['clip']])
        clipped += 1

# ---------------------------------------------------------------- terrain
near, far = shot['near'], shot['far']


def even_lawn(image, block=48, amount=0.85):
    """Evens out the lawn of a bake: lot tints, hairline boundaries and mowing
    edges are viewer aids of the real-time scene, not things a camera would
    see. Lawn pixels move towards a low-pass of the lawn (large-scale variation
    stays)."""
    from PIL import Image
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    rgb = px[..., :3]
    lawn = (rgb[..., 1] > rgb[..., 0] * 1.05) & (rgb[..., 1] > rgb[..., 2] * 1.2) & (px[..., 3] > 0.5)
    hb, wb = h // block, w // block
    m = lawn[: hb * block, : wb * block].reshape(hb, block, wb, block).astype(np.float32)
    c = rgb[: hb * block, : wb * block].reshape(hb, block, wb, block, 3)
    cnt = m.sum(axis=(1, 3))
    mean = (c * m[..., None]).sum(axis=(1, 3)) / np.maximum(cnt, 1)[..., None]
    fallback = rgb[lawn].mean(axis=0) if lawn.any() else np.zeros(3)
    mean[cnt < 1] = fallback
    low = np.dstack([np.asarray(Image.fromarray(mean[..., k].astype(np.float32), mode='F').resize((w, h), Image.BILINEAR)) for k in range(3)])
    rgb[lawn] = rgb[lawn] * (1 - amount) + low[lawn] * amount
    px[..., :3] = rgb
    image.pixels.foreach_set(px.ravel())
    image.update()


def ground_material():
    mat = bpy.data.materials.new('ground')
    nt = mat.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    L = nt.links.new
    outn = N('ShaderNodeOutputMaterial')
    bsdf = N('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.93
    tc = N('ShaderNodeTexCoord')
    sep = N('ShaderNodeSeparateXYZ')
    L(tc.outputs['Object'], sep.inputs[0])

    def uv_for(win):
        # u = (X - cx)/S + .5 ; v = (Y + cz)/S + .5  (Blender Y = -three z)
        mu = N('ShaderNodeMath'); mu.operation = 'MULTIPLY_ADD'
        mu.inputs[1].default_value = 1 / win['size']
        mu.inputs[2].default_value = 0.5 - win['cx'] / win['size']
        L(sep.outputs['X'], mu.inputs[0])
        mv = N('ShaderNodeMath'); mv.operation = 'MULTIPLY_ADD'
        mv.inputs[1].default_value = 1 / win['size']
        mv.inputs[2].default_value = 0.5 + win['cz'] / win['size']
        L(sep.outputs['Y'], mv.inputs[0])
        comb = N('ShaderNodeCombineXYZ')
        L(mu.outputs[0], comb.inputs[0])
        L(mv.outputs[0], comb.inputs[1])
        return comb

    def tex(path, win):
        t = N('ShaderNodeTexImage')
        t.image = bpy.data.images.load(path)
        t.extension = 'CLIP'
        t.interpolation = 'Cubic'
        L(uv_for(win).outputs[0], t.inputs['Vector'])
        return t

    tn = tex(os.path.join(D, f'ground-near-{args.t}.png'), near)
    tf = tex(os.path.join(D, 'ground-far.png'), far)
    even_lawn(tn.image)
    even_lawn(tf.image)
    # Inside the near window the near bake wins: the texture is CLIP-extended,
    # so its alpha is 0 outside the window (and in the pool cut-out).
    mix = N('ShaderNodeMix'); mix.data_type = 'RGBA'
    L(tn.outputs['Alpha'], mix.inputs['Factor'])
    L(tf.outputs['Color'], mix.inputs['A'])
    L(tn.outputs['Color'], mix.inputs['B'])
    # Subtle relief so grazing light catches the lawn.
    noise = N('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 140.0; noise.inputs['Detail'].default_value = 6.0
    bump = N('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25; bump.inputs['Distance'].default_value = 0.02
    L(noise.outputs['Fac'], bump.inputs['Height'])
    L(bump.outputs['Normal'], bsdf.inputs['Normal'])
    # Mid-scale variation (moisture, wear) breaks up the flat bake.
    var = N('ShaderNodeTexNoise'); var.inputs['Scale'].default_value = 0.35; var.inputs['Detail'].default_value = 10.0; var.inputs['Roughness'].default_value = 0.62
    L(tc.outputs['Object'], var.inputs['Vector'])
    vr = N('ShaderNodeMapRange'); vr.inputs['To Min'].default_value = 0.8; vr.inputs['To Max'].default_value = 1.15
    L(var.outputs['Fac'], vr.inputs['Value'])
    vmul = N('ShaderNodeMix'); vmul.data_type = 'RGBA'; vmul.blend_type = 'MULTIPLY'
    vmul.inputs['Factor'].default_value = 1.0
    vcomb = N('ShaderNodeCombineXYZ')
    for k in range(3):
        L(vr.outputs['Result'], vcomb.inputs[k])
    L(mix.outputs['Result'], vmul.inputs['A'])
    L(vcomb.outputs[0], vmul.inputs['B'])
    L(vmul.outputs['Result'], bsdf.inputs['Base Color'])
    L(bsdf.outputs['BSDF'], outn.inputs['Surface'])
    return mat, tn


terrain = next((o for o in world_objs if o.name.startswith('terrain')), None)
if terrain:
    gmat, near_tex = ground_material()
    terrain.data.materials.clear()
    terrain.data.materials.append(gmat)
    # Pool excavation: where the near bake is transparent the terrain turns
    # transparent too (pixel-exact outline), and a rectangular pit fitted to
    # that hole sits below it; the pool shell, once built, lines the pit.
    img = near_tex.image
    IW, IH = img.size
    px = np.empty(IW * IH * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(IH, IW, 4)
    S = near['size']
    gx = near['cx'] + ((np.arange(IW) + 0.5) / IW - 0.5) * S
    gy = -near['cz'] + ((np.arange(IH) + 0.5) / IH - 0.5) * S
    lcx, lcy = shot['lot']['centroid']['x'], -shot['lot']['centroid']['z']
    close = ((gx[None, :] - lcx) ** 2 + (gy[:, None] - lcy) ** 2) < 30.0 ** 2
    hole = (px[..., 3] < 0.5) & close
    if hole.sum() > 50:
        hm = bpy.data.images.new('pool-hole', IW, IH, alpha=False)
        hm.colorspace_settings.name = 'Non-Color'
        h4 = np.repeat(hole[..., None].astype(np.float32), 4, axis=2)
        h4[..., 3] = 1.0
        hm.pixels.foreach_set(h4.ravel())
        hm.update()
        hm.pack()
        nt = gmat.node_tree
        ht = nt.nodes.new('ShaderNodeTexImage')
        ht.image = hm
        ht.extension = 'CLIP'
        ht.interpolation = 'Linear'
        nt.links.new(near_tex.inputs['Vector'].links[0].from_socket, ht.inputs['Vector'])
        gt = nt.nodes.new('ShaderNodeMath')
        gt.operation = 'GREATER_THAN'
        gt.inputs[1].default_value = 0.5
        nt.links.new(ht.outputs['Color'], gt.inputs[0])
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        ms = nt.nodes.new('ShaderNodeMixShader')
        gout = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        surf = gout.inputs['Surface'].links[0].from_socket
        nt.links.new(gt.outputs[0], ms.inputs['Fac'])
        nt.links.new(surf, ms.inputs[1])
        nt.links.new(tr.outputs[0], ms.inputs[2])
        nt.links.new(ms.outputs[0], gout.inputs['Surface'])
        # Rectangle fitted to the hole (principal axes), slightly oversized so
        # no gap shows at the rim.
        ys_, xs_ = np.nonzero(hole)
        P = np.stack([gx[xs_], gy[ys_]], axis=1)
        c0 = P.mean(axis=0)
        _, vecs = np.linalg.eigh(np.cov((P - c0).T))
        ax = vecs.T  # rows: axes
        q = (P - c0) @ ax.T
        lo_, hi2 = q.min(axis=0) - 0.03, q.max(axis=0) + 0.03
        corners = [c0 + ax[0] * a + ax[1] * b for a, b in ((lo_[0], lo_[1]), (hi2[0], lo_[1]), (hi2[0], hi2[1]), (lo_[0], hi2[1]))]
        from mathutils.bvhtree import BVHTree
        tree = BVHTree.FromObject(terrain, bpy.context.evaluated_depsgraph_get())
        tinv = terrain.matrix_world.inverted()
        hit = tree.ray_cast(tinv @ Vector((c0[0] + ax[0][0] * (hi2[0] + 0.5), c0[1] + ax[0][1] * (hi2[0] + 0.5), 50.0)), Vector((0, 0, -1)))
        z0 = (terrain.matrix_world @ hit[0]).z if hit[0] is not None else 0.0
        depth = 1.5
        pbm = bmesh.new()
        top = [pbm.verts.new((c[0], c[1], z0 + 0.02)) for c in corners]
        bot = [pbm.verts.new((c[0], c[1], z0 - depth)) for c in corners]
        pbm.faces.new(bot)
        for i in range(4):
            j = (i + 1) % 4
            pbm.faces.new([top[i], top[j], bot[j], bot[i]])
        pme = bpy.data.meshes.new('pool-pit')
        pbm.to_mesh(pme)
        pbm.free()
        pit = bpy.data.materials.new('pit-soil')
        pb = pit.node_tree.nodes['Principled BSDF']
        pb.inputs['Base Color'].default_value = (0.05, 0.032, 0.02, 1)  # damp dark topsoil
        pb.inputs['Roughness'].default_value = 0.72
        pme.materials.append(pit)
        pob = bpy.data.objects.new('pool-pit', pme)
        scene.collection.objects.link(pob)
        print(f'pool pit {hi2[0] - lo_[0]:.1f} x {hi2[1] - lo_[1]:.1f} m', flush=True)

# ----------------------------------------------------------- material fixes
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if not bsdf:
        continue
    name = mat.name.lower()
    if 'glass' in name and 'rail' not in name:
        # Architectural glazing: clear, reflective, slightly tinted, with the
        # warm interior light read through it.
        bsdf.inputs['Roughness'].default_value = 0.015
        # Coated (low-e) glazing reflects ~12 % head-on: sky, trees and lawn
        # read in the panes; the interior is only a soft warm presence.
        bsdf.inputs['IOR'].default_value = 2.0
        bsdf.inputs['Coat Weight'].default_value = 0.0
        bsdf.inputs['Base Color'].default_value = (0.012, 0.016, 0.018, 1)
        if bsdf.inputs['Base Color'].is_linked:
            mat.node_tree.links.remove(bsdf.inputs['Base Color'].links[0])
        es = bsdf.inputs['Emission Strength']
        es.default_value = es.default_value * 0.22
        ec = bsdf.inputs['Emission Color']
        if not ec.is_linked:
            ec.default_value = (1.0, 0.78, 0.55, 1)
    if 'poolwater' in name or 'water' in name:
        bsdf.inputs['Transmission Weight'].default_value = 0.85
        bsdf.inputs['Roughness'].default_value = 0.02
        bsdf.inputs['IOR'].default_value = 1.33
    # Rendered walls: real lime render sits near 0.6 albedo, not paper white.
    if name.startswith('plaster'):
        bc = bsdf.inputs['Base Color']
        if bc.is_linked:
            mul = mat.node_tree.nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Factor'].default_value = 1.0
            mul.inputs['B'].default_value = (0.8, 0.79, 0.77, 1)
            src = bc.links[0].from_socket
            mat.node_tree.links.new(src, mul.inputs['A'])
            mat.node_tree.links.new(mul.outputs['Result'], bc)
    # Leaves and cards: light passes through foliage.
    if bsdf.inputs['Base Color'].is_linked and mat.blend_method != 'OPAQUE':
        bsdf.inputs['Subsurface Weight'].default_value = 0.0
        bsdf.inputs['Transmission Weight'].default_value = 0.12

# Asphalt (the road parcel's unnamed material): the engine's dark albedo lets
# the blue sky's reflection dominate at grazing angles, so the road reads navy.
# Real asphalt is a weathered grey around 0.1 albedo and very rough.
for ob in world_objs:
    if ob.type != 'MESH' or not ob.name.startswith('roads'):
        continue
    for mat in ob.data.materials:
        if not mat or not mat.name.lower().startswith('material'):
            continue
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bc = bsdf.inputs['Base Color'] if bsdf else None
        if not bc or not bc.is_linked or bc.links[0].from_node.type != 'TEX_IMAGE':
            continue  # factor-tinted materials (red earth) stay as they are
        mul = mat.node_tree.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        mul.inputs['B'].default_value = (1.9, 1.88, 1.85, 1)
        mat.node_tree.links.new(bc.links[0].from_socket, mul.inputs['A'])
        mat.node_tree.links.new(mul.outputs['Result'], bc)
        bsdf.inputs['Roughness'].default_value = 0.96
        if bsdf.inputs['Roughness'].is_linked:
            mat.node_tree.links.remove(bsdf.inputs['Roughness'].links[0])
        bsdf.inputs['Specular IOR Level'].default_value = 0.35
        print('asphalt:', mat.name, flush=True)

# ------------------------------------------------------------ sky and sun
sun_w = b(shot['sun']).normalized()
elev = math.asin(max(-1.0, min(1.0, sun_w.z)))
rot = math.atan2(sun_w.x, -sun_w.y)  # Blender sky: rotation measured from -Y towards +X
world = bpy.data.worlds.new('sky')
scene.world = world
nt = world.node_tree
nt.nodes.clear()
sky = nt.nodes.new('ShaderNodeTexSky')
sky.sky_type = 'MULTIPLE_SCATTERING'
sky.sun_disc = False  # the sun lamp is the sun
sky.sun_elevation = elev
sky.sun_rotation = rot
sky.altitude = 200.0
sky.air_density = 1.0
sky.aerosol_density = 1.4
# The sky seen by the camera stays at its strength; as fill light it counts
# double, so shade under a clear sky reads open and blue rather than black
# (the usual architectural-photography fill).
bg = nt.nodes.new('ShaderNodeBackground')
bg.inputs['Strength'].default_value = 0.1
fill = nt.nodes.new('ShaderNodeBackground')
fill.inputs['Strength'].default_value = 0.2
lp = nt.nodes.new('ShaderNodeLightPath')
mixw = nt.nodes.new('ShaderNodeMixShader')
wout = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
# The fill is half desaturated: it stands in for the light bounced off the
# surroundings (red earth, lawn, neighbouring houses) that the scene does not
# model, so shade reads blue-grey rather than saturated navy.
bw = nt.nodes.new('ShaderNodeRGBToBW')
nt.links.new(sky.outputs['Color'], bw.inputs['Color'])
desat = nt.nodes.new('ShaderNodeMix')
desat.data_type = 'RGBA'
desat.inputs['Factor'].default_value = 0.5
nt.links.new(sky.outputs['Color'], desat.inputs['A'])
nt.links.new(bw.outputs['Val'], desat.inputs['B'])
nt.links.new(desat.outputs['Result'], fill.inputs['Color'])
nt.links.new(lp.outputs['Is Camera Ray'], mixw.inputs['Fac'])
nt.links.new(fill.outputs['Background'], mixw.inputs[1])
nt.links.new(bg.outputs['Background'], mixw.inputs[2])
nt.links.new(mixw.outputs['Shader'], wout.inputs['Surface'])

sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 4.2
sun_data.angle = math.radians(0.6)
sun_data.color = (1.0, 0.8, 0.6)  # late-afternoon sun
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (-sun_w).to_track_quat('-Z', 'Y').to_euler()

# ------------------------------------------------- atmosphere (volumetric)
if args.haze > 0:
    # A large box of thin forward-scattering haze: aerial perspective on the
    # far shore and visible sun shafts through the trees at golden hour. A box
    # (not a world volume) so rays leaving it still see the sky.
    hb = bmesh.new()
    bmesh.ops.create_cube(hb, size=1.0)
    hme = bpy.data.meshes.new('haze')
    hb.to_mesh(hme)
    hb.free()
    haze = bpy.data.objects.new('haze', hme)
    lc = shot['lot']['centroid']
    haze.location = (lc['x'], -lc['z'], 60.0)
    haze.scale = (1600.0, 1600.0, 140.0)
    scene.collection.objects.link(haze)
    hm = bpy.data.materials.new('haze')
    hnt = hm.node_tree
    hnt.nodes.clear()
    hout = hnt.nodes.new('ShaderNodeOutputMaterial')
    pv = hnt.nodes.new('ShaderNodeVolumePrincipled')
    pv.inputs['Density'].default_value = args.haze
    pv.inputs['Anisotropy'].default_value = 0.55
    pv.inputs['Color'].default_value = (0.92, 0.94, 1.0, 1)
    hnt.links.new(pv.outputs['Volume'], hout.inputs['Volume'])
    hme.materials.append(hm)
    haze.visible_shadow = False

# ---------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new('cam')
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(shot['fov'])
cam_data.clip_start = 0.1
cam_data.clip_end = 6000
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
cam.location = b(shot['position'])
direction = b(shot['target']) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

# -------------------------------------------------------- optional grass
def scatter_grass(window_m=40.0, per_m2=560, res=0.08, children=8):
    """Real grass blades on the lawn around the lot.

    Density comes from a mask: lawn-coloured ground in the near bake, minus the
    footprint of every exported surface at ground level (roads, paving, slabs,
    deck, pool, site works), so blades never poke through hard surfaces."""
    from PIL import Image, ImageDraw

    # Window centred halfway from the camera to the lot: the lawn in view
    # (for a camera path, the lot itself).
    cam_p = shot['position'] if not args.cams else [shot['lot']['centroid']['x'], 0, shot['lot']['centroid']['z']]
    cx = (shot['lot']['centroid']['x'] + cam_p[0]) / 2
    cz = (shot['lot']['centroid']['z'] + cam_p[2]) / 2
    n = int(window_m / res)
    x0, y0 = cx - window_m / 2, -cz - window_m / 2  # Blender XY of the window corner

    # 1. Lawn mask from the near bake (green dominates, alpha present).
    img = near_tex.image
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    xs = x0 + (np.arange(n) + 0.5) * res
    ys = y0 + (np.arange(n) + 0.5) * res
    u = ((xs - near['cx']) / near['size'] + 0.5) * img.size[0]
    v = ((ys + near['cz']) / near['size'] + 0.5) * img.size[1]
    ui = np.clip(u.astype(int), 0, img.size[0] - 1)
    vi = np.clip(v.astype(int), 0, img.size[1] - 1)
    samp = px[vi[:, None], ui[None, :]]  # rows: y, cols: x
    r, g, bl, a = samp[..., 0], samp[..., 1], samp[..., 2], samp[..., 3]
    lawn = (g > r * 1.05) & (g > bl * 1.2) & (a > 0.5)
    # Average lawn albedo of the bake (sRGB bytes → linear): the blades take
    # the ground's own colour so the grass meets the far terrain seamlessly.
    lawn_srgb = samp[..., :3][lawn].mean(axis=0) if lawn.any() else np.array([0.3, 0.45, 0.2])
    lawn_lin = np.where(lawn_srgb <= 0.04045, lawn_srgb / 12.92, ((lawn_srgb + 0.055) / 1.055) ** 2.4)
    # Close hairline gaps (lot tints and mowing edges in the bake), ~25 cm.
    def shift_any(m, rad, op):
        out = m.copy()
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if dx * dx + dy * dy > rad * rad:
                    continue
                sh = np.roll(np.roll(m, dy, 0), dx, 1)
                out = (out | sh) if op == 'or' else (out & sh)
        return out
    lawn = shift_any(shift_any(lawn, 3, 'or'), 3, 'and').astype(np.float32)

    # 2. Hard surfaces: rasterise ground-level triangles of every unique mesh
    #    (instanced meshes are trees, tufts, impostors and markers).
    block = Image.new('L', (n, n), 0)
    draw = ImageDraw.Draw(block)
    for ob in list(world_objs) + list(house_objs):
        if ob.type != 'MESH' or ob is terrain or ob.data.users > 1:
            continue
        me = ob.data
        nv = len(me.vertices)
        if nv == 0 or nv > 300000:
            continue
        co = np.empty(nv * 3, dtype=np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        mw = np.array(ob.matrix_world, dtype=np.float32)
        co = co @ mw[:3, :3].T + mw[:3, 3]
        if co[:, 2].min() > 0.45:
            continue
        me.calc_loop_triangles()
        tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
        me.loop_triangles.foreach_get('vertices', tri)
        p3 = co[tri.reshape(-1, 3)]  # (T, 3, 3)
        keep = p3[:, :, 2].min(1) < 0.45
        px2 = (p3[keep][:, :, 0] - x0) / res
        py2 = n - 1 - (p3[keep][:, :, 1] - y0) / res
        inside = (px2.max(1) > -2) & (px2.min(1) < n + 2) & (py2.max(1) > -2) & (py2.min(1) < n + 2)
        for xs3, ys3 in zip(px2[inside], py2[inside]):
            draw.polygon(list(zip(xs3.tolist(), ys3.tolist())), fill=255)
    hard = np.asarray(block, dtype=np.float32)[::-1, :] / 255.0
    density = np.clip(lawn * (1.0 - hard), 0, 1)
    # Feather the window: blades thin out over its outer 7 m (random per cell),
    # so the hair grass dissolves into the textured terrain instead of ending
    # on a straight line.
    idx = (np.arange(n) + 0.5) * res
    edge = np.minimum(np.minimum(idx, window_m - idx)[:, None], np.minimum(idx, window_m - idx)[None, :])
    keep = np.clip(edge / 7.0, 0, 1) ** 1.5
    if os.environ.get('CINE_DEBUG'):
        Image.fromarray((np.dstack([lawn, hard, density]) * 255).astype(np.uint8)[::-1]).save(os.path.join(D, 'grass-mask.png'))
    # 3. Emitter: only the lawn cells of the mask (particle texture influence
    #    is not evaluated by the bpy module, so the mask becomes geometry).
    cell = 0.15
    k = max(1, int(round(cell / res)))
    m = density[: (n // k) * k, : (n // k) * k].reshape(n // k, k, n // k, k).mean(axis=(1, 3))
    kk = keep[: (n // k) * k, : (n // k) * k].reshape(n // k, k, n // k, k).mean(axis=(1, 3))
    rng = np.random.default_rng(7)
    rows, cols = np.nonzero((m > 0.5) & (rng.random(m.shape) < kk))
    cell = k * res  # the mask's own cell size
    # The emitter lies on the terrain (which is not flat), so blades are never
    # buried where the ground rises a few centimetres.
    from mathutils.bvhtree import BVHTree
    deps = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(terrain, deps)
    tmw = terrain.matrix_world
    tinv = tmw.inverted()
    verts = {}
    bm = bmesh.new()

    def vert(i, j):
        key = (i, j)
        if key not in verts:
            x_, y_ = x0 + j * cell, y0 + i * cell
            hit = tree.ray_cast(tinv @ Vector((x_, y_, 50.0)), (tinv.to_3x3() @ Vector((0, 0, -1))).normalized())
            z_ = (tmw @ hit[0]).z if hit[0] is not None else 0.0
            verts[key] = bm.verts.new((x_, y_, z_ + 0.004))
        return verts[key]

    for r_, c_ in zip(rows.tolist(), cols.tolist()):
        bm.faces.new([vert(r_, c_), vert(r_, c_ + 1), vert(r_ + 1, c_ + 1), vert(r_ + 1, c_)])
    me = bpy.data.meshes.new('grass-emitter')
    bm.to_mesh(me)
    bm.free()
    plane = bpy.data.objects.new('grass-emitter', me)
    scene.collection.objects.link(plane)
    lawn_area = len(rows) * cell * cell
    em = bpy.data.materials.new('emitter-invisible')
    em.node_tree.nodes.clear()
    em_out = em.node_tree.nodes.new('ShaderNodeOutputMaterial')
    em_tr = em.node_tree.nodes.new('ShaderNodeBsdfTransparent')
    em.node_tree.links.new(em_tr.outputs[0], em_out.inputs['Surface'])
    plane.data.materials.append(em)
    ps = plane.modifiers.new('grass', 'PARTICLE_SYSTEM').particle_system
    st = ps.settings
    st.type = 'HAIR'
    st.count = int(lawn_area * per_m2 / (children + 1))
    st.use_advanced_hair = True
    st.emit_from = 'FACE'
    st.distribution = 'RAND'
    st.use_even_distribution = True
    # Children cluster around their parent; interpolated children would spread
    # beyond the lawn cells.
    st.child_type = 'SIMPLE'
    st.child_percent = children
    st.rendered_child_count = children
    st.child_radius = 0.06
    st.child_roundness = 1.0
    st.child_length = 1.0
    st.roughness_1 = 0.005
    st.roughness_endpoint = 0.008
    st.roughness_2 = 0.004
    st.clump_factor = 0.05
    st.root_radius = 1.0
    st.tip_radius = 0.0
    st.radius_scale = 0.0045
    st.hair_step = 4
    st.render_step = 4
    st.use_hair_bspline = True
    # Random emission velocity is in metres, like the length: keep it a
    # fraction of the blade so the lawn reads as mown, not overgrown.
    st.factor_random = 0.012
    st.brownian_factor = 0.0
    # Set last: Blender derives the emission velocity from it (and vice versa).
    st.hair_length = 0.055  # a mown lawn
    # Blade material: ground colour under each blade, varied per strand.
    gm = bpy.data.materials.new('grass-blades')
    nt = gm.node_tree
    nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.6
    bsdf.inputs['Transmission Weight'].default_value = 0.2
    hi = nt.nodes.new('ShaderNodeHairInfo')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    lo, hi_ = lawn_lin * 0.7, lawn_lin * 1.35
    ramp.color_ramp.elements[0].color = (*lo.tolist(), 1)
    ramp.color_ramp.elements[1].color = (*hi_.tolist(), 1)
    nt.links.new(hi.outputs['Random'], ramp.inputs['Fac'])
    tip = nt.nodes.new('ShaderNodeMix'); tip.data_type = 'RGBA'; tip.blend_type = 'MULTIPLY'
    tipv = nt.nodes.new('ShaderNodeMapRange')
    tipv.inputs['To Min'].default_value = 0.55
    tipv.inputs['To Max'].default_value = 1.15
    nt.links.new(hi.outputs['Intercept'], tipv.inputs['Value'])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    for k in range(3):
        nt.links.new(tipv.outputs['Result'], comb.inputs[k])
    tip.inputs['Factor'].default_value = 1.0
    nt.links.new(ramp.outputs['Color'], tip.inputs['A'])
    nt.links.new(comb.outputs[0], tip.inputs['B'])
    nt.links.new(tip.outputs['Result'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], o.inputs['Surface'])
    plane.data.materials.append(gm)
    st.material = 2
    print(f'grass: {st.count} parents x {st.rendered_child_count} children on {lawn_area:.0f} m² of lawn, albedo {np.round(lawn_lin, 3).tolist()}', flush=True)


if args.grass and terrain:
    scatter_grass(window_m=args.grass_window, per_m2=560 if args.grass_window <= 40 else 480)

# ---------------------------------------------------------------- render
r = scene.render
r.engine = 'CYCLES'
r.resolution_x, r.resolution_y = W, H
r.resolution_percentage = 100
r.film_transparent = False
cy = scene.cycles
cy.device = 'CPU'
cy.samples = args.samples
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.02
cy.use_denoising = True
cy.denoiser = 'OPENIMAGEDENOISE'
cy.max_bounces = 6
cy.diffuse_bounces = 3
cy.glossy_bounces = 3
cy.transmission_bounces = 6
cy.transparent_max_bounces = 24
cy.caustics_reflective = False
cy.caustics_refractive = False
cy.sample_clamp_indirect = 8.0
if args.threads:
    r.threads_mode = 'FIXED'
    r.threads = args.threads
r.image_settings.file_format = 'OPEN_EXR'
r.image_settings.color_depth = '32'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grade import grade, load_exr, save  # noqa: E402

print(f'clipped {clipped} components; rendering {W}x{H} @ {args.samples} spp', flush=True)
if args.cams:
    # Camera path: the scene (and its BVH) is built once, every pose renders
    # in this session. Frames that already exist are skipped (resumable).
    import time
    path = json.load(open(args.cams))
    cam_data.angle_y = math.radians(path.get('fov', shot['fov']))
    os.makedirs(args.outdir, exist_ok=True)
    for f in path['frames']:
        png = os.path.join(args.outdir, f"{f['i']:04d}.png")
        if os.path.exists(png):
            continue
        t0 = time.time()
        cam.location = b(f['position'])
        cam.rotation_euler = (b(f['target']) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        exr = png[:-4] + '.exr'
        r.filepath = exr
        bpy.ops.render.render(write_still=True)
        save(grade(load_exr(exr), exposure=-1.0 + args.exposure, warmth=0.06), png)
        os.remove(exr)
        print(f"frame {f['i']} in {time.time() - t0:.1f} s", flush=True)
else:
    exr = out_png.rsplit('.', 1)[0] + '.exr'
    r.filepath = exr
    bpy.ops.render.render(write_still=True)
    save(grade(load_exr(exr), exposure=-1.0 + args.exposure, warmth=0.06), out_png)
    print('wrote', out_png, flush=True)
