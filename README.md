# 3DForge 0.6

**Live demo:** <https://meillermedia.github.io/3D-Forge/>

A small browser-based mesh modeller built with [three.js](https://threejs.org) (v0.160, loaded via CDN as ES modules). No build step, no dependencies to install.

## Run

ES modules need an HTTP server (opening `index.html` via `file://` will not work):

```sh
python3 -m http.server 8765
```

Then open <http://localhost:8765/index.html>. An internet connection is required for the three.js CDN.

## macOS app (optional, Tauri)

The web version needs none of this. To build a native macOS app (requires Node.js and [Rust](https://rustup.rs)):

```sh
npm install
npm run app:dev     # run as desktop app
npm run app:build   # .app and .dmg in src-tauri/target/release/bundle/
```

Signing (optional): copy `.env.signing.example` to `.env.signing` (git-ignored), enter your Developer ID identity (and Apple ID, app-specific password and team ID for notarization), then run `npm run app:build:signed`. Secrets are only read from that ignored file or the environment and never stored in tracked files.

Mac App Store (optional): in the Apple Developer portal create the App ID (`de.oth-aw.3dforge`, see `src-tauri/tauri.conf.json`), the certificates "Apple Distribution" / "3rd Party Mac Developer Application" and "Mac Installer Distribution" / "3rd Party Mac Developer Installer" (install them in the keychain), a Mac App Store provisioning profile for the App ID, and the app record in App Store Connect. Fill the `APPSTORE_*` values in `.env.signing`, then:

```sh
rustup target add x86_64-apple-darwin   # once, for the universal build
npm run app:appstore                    # sandboxed, signed .pkg in src-tauri/gen/appstore/
npm run app:appstore:upload             # upload to App Store Connect (or open the .pkg with Transporter)
```

Texts, screenshots, icon and privacy policy for the store entry are in `store/` (see `store/README.md`). Increase `APPSTORE_BUILD_NUMBER` for every upload. The sandbox entitlements are in `src-tauri/appstore/`.

Put three.js into `lib/three/` first (see `lib/README.txt`), otherwise the app loads it from the CDN and needs internet. In the app, exports use a native save dialog.

## Features

### Scene & navigation
- Rotatable 3D view (orbit), Blender-style navigation with the middle mouse button (drag = orbit, `Shift`+drag = pan, `Ctrl`+drag = zoom; mouse wheel also zooms); a navigation gizmo at the top right (click an axis to snap the view, drag to orbit) with zoom and pan drag buttons below it, orbiting and zooming around the selected orbit center, with a ground grid and axes
- Orbit options: orbit around the origin or the current selection; "Center" focuses the view on the orbit center, "Home" (`Home`) resets the view to the initial position
- Optional grid snapping (units configurable, 0 = off)

### Primitives
- Box, sphere, cylinder, tube and plane, placed by clicking in the 3D view with a live preview
- Per-shape parameters (e.g. size, subdivisions) and a colour for new objects

### Object mode
- Select, move, rotate and scale with a gizmo (global or local orientation)
- **Transform pivot**: move or rotate only an object's pivot while keeping its shape in place; numeric position and rotation inputs do the same when this mode is active
- A yellow frame shows the extent of the selected object(s)
- Multi-selection: `Shift`/`Ctrl`/`Cmd`+click in the view or in the object list toggles objects, `Ctrl+A` selects all; the gizmo transforms the whole selection, and duplicate, delete and colour apply to all selected objects
- Numeric position / scale / rotation / colour fields in the side panel; all number fields can be changed by dragging the mouse up/down inside them (`Shift` = fine)
- Duplicate and delete objects
- **Bool**: with exactly two objects selected, combine them with Add (A + B) or Subtract (A − B), where A is the first selected object; the result is a new editable mesh (BSP-based CSG, face colours are not kept)
- **Edges** (Shift+H): hides the edges between faces of the selected objects whose angle is below a limit (default 30°) by merging those faces
- **Close holes** (Shift+K): fills open boundary loops of the selected objects, so the mesh becomes closed
- Scrollable object list with rename (double-click) and selection
- Undo / redo for the whole scene

### Edit mode (vertices, edges, faces)
- Convert any primitive into an editable mesh and edit **vertices**, **edges** or **faces**
- Move, rotate and scale selections; selected edges are highlighted
- **Add**: new vertices, edges between two selected points, face extrusion
- **Remove**: delete vertices, edges (merging faces) or faces
- **Connect** boundary points of the same face
- **Chamfer** selected edges with adjustable width
- **Subdivide** the selected faces with Catmull-Clark subdivision surfaces (one level per click, `Shift+D`; disabled without a face selection)
- **Mirror** on X, Y and/or Z so edits are applied to both sides; enabled mirror planes are shown in the viewport
- Per-face colours (with reset to the object colour)
- Added edges are always visible; Add / Remove / Chamfer are disabled when not applicable

### Import / export
| Format | Import | Export | Notes |
|--------|:------:|:------:|-------|
| JSON (3DForge) | ✓ | ✓ | Lossless, includes face colours |
| glTF / GLB | ✓ | ✓ | Face colours are kept via vertex colours; imported textures are sampled per triangle |
| OBJ | ✓ | ✓ | No materials / colours |
| STL | ✓ | ✓ | No colours |
| 3DS | ✓ | ✓ | Face colours are kept; no transformation matrices |

Imported meshes become editable objects with their centre as origin.

### Usability
- Splash screen and logo (click the logo to show it again)
- Keyboard shortcuts for the whole workflow, shown in hover tooltips, next to menu items, and in **Help → Keyboard shortcuts** (`?`)
- Help dialogs for controls and edit mode (`F1`, `Shift+F1`)

## Keyboard shortcuts (overview)

`Ctrl` also means `Cmd` on macOS.

| Action | Keys |
|--------|------|
| Open / save JSON | `Ctrl+O` / `Ctrl+S` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` |
| Select mode / create box, sphere, cylinder, tube, plane | `1` / `2`–`6` |
| Toggle edit mode | `Tab` |
| Move / rotate / scale | `W` / `E` / `R` |
| Gizmo global / local | `X` |
| Duplicate / delete | `Ctrl+D` / `Del` |
| Center view on orbit center | `F` |
| Edit mode: vertex / edge / face | `1` / `2` / `3` |
| Edit mode: add / remove / chamfer | `Enter` / `Del` / `B` |
| Edit mode: mirror X / Y / Z | `Shift+X` / `Shift+Y` / `Shift+Z` |

The complete, always up-to-date list is in the app (`?`).

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Layout, menus, dialogs |
| `css/styles.css` | Styles |
| `icons/` | Editable SVG icons (one file per icon, `stroke` is masked with the button colour), the logo and the favicon (`favicon.svg`) |
| `js/main.js` | App logic: modes, toolbar, panels, object list, undo/redo, selection tool |
| `js/stage.js` | Scene, camera, renderer, orbit controls, grid |
| `js/shapes.js` | Parametric primitives |
| `js/model.js`, `js/polygon.js` | Editable mesh model and polygon helpers |
| `js/io.js` | Import / export, including a minimal 3DS reader/writer |
| `js/shortcuts.js` | Shortcut registry, tooltips and shortcut table |
| `js/navgizmo.js`, `js/numscrub.js`, `js/splash.js` | Navigation gizmo, number scrubbing, splash screen |
| `js/edit/editor.js` | Sub-object editor (vertex / edge / face) core, picking and region selection |
| `js/edit/mirror.js`, `topology.js`, `chamfer.js`, `extrude.js`, `subdivide.js` | Edit tools, mixed into the editor |
| `js/tools/csg.js` | Boolean (CSG) algorithm for meshes |
| `js/tools/remesh.js` | Remesh / skin-only |
| `js/tools/lattice.js` | Lattice (free-form deformation cage) |
| `js/tools/region.js` | Selection regions (rectangle, circle, lasso) as polygons |

## Limitations
- Chamfer works only on edges shared by exactly two faces; Connect only on boundary points of one face
- The mirror setting is not stored in undo history or files
- OBJ is exported without `.mtl`; OBJ / STL do not keep face colours
