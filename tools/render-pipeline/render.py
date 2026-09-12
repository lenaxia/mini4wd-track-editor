#!/usr/bin/env python3
"""Top-down ortho renderer + measurer for rucdoc track pieces.

Reads pieces.json (per-piece model + connector annotations), renders
base + tint-mask PNGs, measures footprint/verts/dz, and prints catalog
literals with diffs against expected values. See README.md.

Requires: pip install bpy   (official wheel, Python 3.13; CPU-only Cycles)
"""
import argparse, json, math, os, sys

PX_PER_CM = 2
MASK_WALL = (1.0, 1.0, 1.0)
MASK_BED = (0.0, 0.0, 0.0)

def mm2u(v): return v / 1000.0

def load_model(path):
    import bpy
    ext = os.path.splitext(path)[1].lower()
    if ext == '.3mf':
        sys.exit('3MF: convert to STL first (see README) — bpy has no native importer')
    if ext == '.stl':
        bpy.ops.wm.stl_import(filepath=path)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=path)
    else:
        sys.exit(f'unsupported model type: {ext}')
    objs = list(bpy.context.selected_objects)
    if not objs: sys.exit(f'no objects imported from {path}')
    return objs

def world_bbox(objs):
    import bpy
    from mathutils import Vector
    xs, ys, zs = [], [], []
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

def surface_z_at(objs, x_mm, y_mm, tol_mm=3.0):
    """Connector running-surface height: topmost mesh z over the end
    cross-section (verts within tol of the connector's x — the piece-end
    face spans the width, so match the slice, not the midpoint)."""
    import bpy, bmesh
    from mathutils import Vector
    best = None
    for o in objs:
        if o.type != 'MESH': continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        for v in bm.verts:
            w = o.matrix_world @ v.co
            if abs(w.x - mm2u(x_mm)) < mm2u(tol_mm):
                if best is None or w.z > best: best = w.z
        bm.free()
    return None if best is None else best * 1000.0

def flat_mat(name, rgb, emission=1.5):
    import bpy
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.node_tree.nodes.clear()
    out = m.node_tree.nodes.new('ShaderNodeOutputMaterial')
    em = m.node_tree.nodes.new('ShaderNodeEmission')
    em.inputs[0].default_value = (*rgb, 1.0); em.inputs[1].default_value = emission
    m.node_tree.links.new(em.outputs[0], out.inputs[0])
    return m

def render_pass(scene, path, px_x, px_y):
    import bpy
    scene.render.resolution_x = px_x; scene.render.resolution_y = px_y
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

def process(name, cfg, out_dir, expect):
    import bpy
    # fresh scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = load_model(cfg['model'])
    lo, hi = world_bbox(objs)
    # canonical pose: center bbox on origin, travel +x is assumed to be the
    # model's +x (heading_deg rotates first if annotated)
    heading = cfg.get('heading_deg', 0)
    if heading:
        for o in objs:
            o.rotation_euler.rotate_axis('Z', math.radians(-heading))
        bpy.context.view_layer.update()
        lo, hi = world_bbox(objs)
    w_cm = (hi[0]-lo[0]) * 100.0; h_cm = (hi[1]-lo[1]) * 100.0
    cx, cy = (lo[0]+hi[0])/2, (lo[1]+hi[1])/2
    from mathutils import Vector as _V
    for o in objs: o.location -= _V((cx, cy, 0))
    bpy.context.view_layer.update()

    # scene: cycles CPU, ortho top-down camera
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 16
    scene.render.image_settings.file_format = 'PNG'; scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new('cam'); cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = (0, 0, max(hi[2], 0.05) * 3); scene.collection.objects.link(cam)
    scene.camera = cam
    span_x, span_y = (hi[0]-lo[0]), (hi[1]-lo[1])
    px_x = max(16, round(w_cm * PX_PER_CM * 1.02)); px_y = max(16, round(h_cm * PX_PER_CM * 1.02))
    cam_data.ortho_scale = max(span_x, span_y * px_x / px_y) * 1.02

    # lighting + base materials: assign wall/bed separation is model-specific;
    # default heuristic colors everything as bed, override via cfg['wall_objects']
    sun_data = bpy.data.lights.new('sun', type='SUN'); sun_data.energy = 3
    sun = bpy.data.objects.new('sun', sun_data); sun.rotation_euler = (0.6, 0.3, 0.2)
    scene.collection.objects.link(sun)
    bed = flat_mat('bed', (0.55, 0.55, 0.58)); wall = flat_mat('wall', (0.9, 0.35, 0.2))
    for o in objs:
        if o.type != 'MESH': continue
        o.data.materials.append(wall if o.name in cfg.get('wall_objects', []) else bed)

    render_pass(scene, os.path.join(out_dir, f'{name}.0.png'), px_x, px_y)
    # mask pass: walls white, everything else black
    wall.node_tree.nodes['Emission'].inputs[0].default_value = (*MASK_WALL, 1)
    bed.node_tree.nodes['Emission'].inputs[0].default_value = (*MASK_BED, 1)
    render_pass(scene, os.path.join(out_dir, f'{name}.mask.png'), px_x, px_y)

    # annotations are model-space: rotate them into the canonical frame by
    # the same -heading the objects got, THEN center them (frame consistency)
    ca, sa = math.cos(math.radians(-heading)), math.sin(math.radians(-heading))
    def canon(pt):
        # catalog verts are piece-local CM; dz stays MM (zOff is a mm field)
        x, y = pt[0] * ca - pt[1] * sa, pt[0] * sa + pt[1] * ca
        return [round((x - (lo[0]+hi[0])/2*1000) / 10, 3), round((y - (lo[1]+hi[1])/2*1000) / 10, 3)]
    entry, exit_ = canon(cfg['entry']), canon(cfg['exit'])
    # connector running-surface heights, sliced on the CANONICAL x (post-
    # rotation) so the piece-end faces are found regardless of heading
    dz_e = surface_z_at(objs, entry[0] * 10, entry[1] * 10)
    dz_x = surface_z_at(objs, exit_[0] * 10, exit_[1] * 10)
    dz = None if dz_e is None or dz_x is None else round(dz_x - dz_e)
    if dz is not None and dz != 0: exit_ = exit_[:2] + [dz]
    result = {'w': round(w_cm, 1), 'h': round(h_cm, 1), 'verts': [entry, exit_], 'dz': dz}
    if expect:
        for k in ('w', 'h', 'dz'):
            if k in expect and expect[k] is not None and result[k] != expect[k]:
                print(f'  DIFF {name}.{k}: measured {result[k]} vs seed {expect[k]}')
        if 'verts' in expect:
            for got, want in zip(result['verts'], expect['verts']):
                if any(abs(g - w) > 0.05 for g, w in zip(got[:2], want[:2])):
                    print(f'  DIFF {name}.verts: measured {got} vs seed {want}')
    print(f'{name}: w={result["w"]} h={result["h"]} verts={result["verts"]} dz={result["dz"]}')
    print(f'  {{ label: ..., w: {result["w"]}, h: {result["h"]}, verts: {json.dumps(result["verts"])}, ... }},')
    return result

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    ap.add_argument('--out', default='out')
    ap.add_argument('--expect', help='optional JSON of expected seed measurements')
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    expect = json.load(open(a.expect)) if a.expect else {}
    os.makedirs(a.out, exist_ok=True)
    for name, pc in cfg.items():
        process(name, pc, a.out, expect.get(name, {}))

if __name__ == '__main__':
    main()
