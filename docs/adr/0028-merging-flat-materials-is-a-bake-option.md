# Merging flat materials is a bake option, off by default

`bakeVAT(root, clips, { mergeFlatMaterials: true })` collapses materials that differ only in a flat colour into one material, and moves each part's colour into the merged geometry's `color` attribute. The crowd then draws once per pass instead of once per material. [ADR-0008](./0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md) promised this as "an opt-in helper (`mergeFlatMaterials`)" and it never shipped. It ships now as an option, not a separate function.

## An option, not a helper

A helper run after the bake would have to rewrite a VAT it did not make: re-sort the groups, rebuild the index, and add an attribute to a geometry the textures are already indexed by. Run before the bake, it would have to rewrite the caller's scene. As an option, the merge happens where the materials are first read, before any part takes a material index. The bake then groups the merged parts as one group, and nothing is rewritten. It also crosses a worker as one more field of the options (ADR-0026).

## What is flat, and what merges

A material is **flat** when it has a `color`, holds no texture of any kind, and does not already read vertex colours. A texture varies across a surface, so one colour per part cannot stand in for it. A material already reading vertex colours would have them overwritten.

Two flat materials merge when everything but their colour and their name agrees: type, roughness, metalness, emissive, side, opacity, and every other property three serializes. The comparison is `material.toJSON()` with the colour and the naming fields removed, so it covers each property three knows about, on any material type, with no list to keep current.

A group of two or more flat materials merges into a clone of its first member, made white with `vertexColors` on. Three multiplies the material colour by the vertex colour, so white passes each part's own colour through. A flat material with nothing to merge with is left as it was, not swapped for a clone, because there is no draw call to save.

## Why it is off by default

It is right for exactly one kind of asset, flat-shaded parts with colours and no textures, and a textured character has nothing to merge. On by default, it would hand some callers a material they did not create, and the caller would have to know which. Off by default, `vat.materials` holds the caller's own materials unless the caller asked for something else. ADR-0008's rule still holds: architecture follows the general case, and the collapse is never a precondition for baking.

## Consequences

- **`vat.materials` can hold a material the caller did not create.** It is named after the materials it merged, joined with ` + `. The caller's own materials are only read.
- **The merged geometry gains a `color` attribute** whenever a merge happened. A part the merge did not touch keeps its own colour attribute, or is painted white, which leaves its material's shading unchanged because that material does not read vertex colours.
- **Both encodings**, and the worker. The worker holds only stand-in materials, so the page reads each material's flatness and sends it with the scene. The page also builds the merged material from its own.
- **RobotExpressive draws in one call per pass instead of three.** Its three materials differ only in colour, as ADR-0008 observed. `webgl_merged.html` and `webgpu_merged.html` bake it both ways and toggle between them.
