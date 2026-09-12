# rucdoc render pipeline (track 2)

Turns rucdoc's 3D models into editor assets. Runs headless via the official
`bpy` wheel (Python 3.13): `pip install bpy` — no Blender install needed.
Requires ~500MB disk; renders CPU-only (Cycles), no GPU/EGL required.

## Drop models here

```
tools/render-pipeline/models/<PieceName>.stl|.3mf|.obj
tools/render-pipeline/pieces.json     # per-piece config (see below)
```

Models: download from thangs.com/designer/rucdoc (needs a free account —
the pipeline cannot fetch them anonymously). MIT © rucdoc; attribution in
index.html/README.md lands with the first rendered asset (design spec §9).

## Per-piece config

```jsonc
{  // comments here are illustrative — the real file must be valid JSON

  "R1S250": {
    "model": "models/1L_straight_250.stl",
    "entry": [-125, 0, 0],          // model-space connector midpoint (mm)
    "exit":  [ 125, 0, 0],
    "heading_deg": 90                // travel direction in model space
  }
}
```

Everything else is measured, not entered: footprint bbox (w/h), connector
running-surface heights (dz), connector world offsets (verts).

## Run

```
python render.py --config pieces.json --out ../../assets
```

Emits per piece: `<Name>.0.png` (lit top-down ortho base), `<Name>.mask.png`
(tint mask: walls/lane surface white), and prints catalog assertions
(w/h/verts/dz as JS literals for src/pieces.js, with diffs vs the seed
values). Sprites render at 2 px/cm, image center = model origin, travel +x
(the registration invariants from docs/design/orient-elevation.md §6 —
the script asserts projected-bbox aspect against the measured w/h).

3MF: bpy does not import 3MF natively; convert once (`pip install trimesh`
then `trimesh` load/save as STL) or export STL from your slicer.

## Then

1. Move `<Name>.0.png` into `assets/`, remove `procedural: true` from the
   catalog entry (the preload skip + tests enforce consistency).
2. Apply measured verts/dz to the catalog if they differ from the seeds.
3. Attribution update + license file (design spec §9).
