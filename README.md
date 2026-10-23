# Phoenix Mesh Workshop / QDQR

Android-first 3D editor for the Phoenix fantasy MMORPG, focused on construction modules and game prop cleanup. The initial application uses **Three.js + Capacitor 8** and is designed to run locally and offline on an **Android 15 tablet with 4 GB RAM / 128 GB storage**.

## 📱 APK without a computer

1. Open [GitHub Actions](https://github.com/RayZenGreallyzzz/QDQR/actions/workflows/android-apk.yml).
2. Open the most recent **green** “Android APK — Phoenix Mesh Workshop” run.
3. Under **Artifacts**, tap `PhoenixMeshWorkshop-Android-debug` and download the ZIP. Extract `PhoenixMeshWorkshop-debug.apk` and install it on Android.
4. If the workflow succeeded in publishing a prerelease, the direct APK is also listed under [Releases](https://github.com/RayZenGreallyzzz/QDQR/releases).
5. Android may ask you to allow installation for your browser/files app. Only install the APK from your own QDQR repository.

**This is a prototype/debug build.** Until a permanent release signing key is configured, a build can have a different debug signature, making in-place updates impossible. Export edited models outside the app before reinstalling.

## Editing capabilities (version 0.1)

- Import **GLB** (recommended for materials), **OBJ**, **STL** and standalone/self-contained **GLTF**.
- Touch orbit/pan/zoom and tap-to-select meshes; transform gizmo to move, rotate or scale.
- Remove tiny disconnected triangle islands by minimum triangle count; remove degenerate triangles and recalculate normals.
- Cut away triangles on one side of a plane (no end-cap, not a full solid boolean).
- Bend selected static meshes and edit numeric dimensions X/Y/Z.
- Add wall, floor, round 90-degree wall corner, roof, arch, window frame, door opening and columns.
- Add geometric decoration and image-backed plaques/emblems; edit materials.
- Preserve editable separate objects; convert transform matrices into vertices.
- Export **GLB**, embedded **GLTF**, geometry **OBJ** and **STL**. GLB is the preferred format for Godot.
- Multi-step Undo (limited more aggressively for large models to protect 4 GB RAM).

### Important limitations

This first build does **not** perform texture-atlas baking, detailed sculpting, watertight boolean trimming, true vertex painting, intelligent semantic extraction from one fused atlas, automatic mesh repair, polygon decimation / LOD, or FBX conversion. “Apply matrices” is transform baking, **not** texture baking. Cutting removes faces whose center lies on one side of the plane and leaves an open seam. Imported rigs are not supported for geometry edits.

### Performance guidance for Android 4 GB

- Prefer **20–80k triangles per construction prop** and **under ~150k total visible triangles** while editing; these are conservative starting recommendations, not hard hardware limits.
- Large GLB models near **450k triangles** are rejected on touch-first devices to avoid out-of-memory crashes.
- Split atlases into individual props before detailed geometry cleanup when possible.
- Mobile renderer uses reduced pixel ratio, disables multisample anti-aliasing, limits idle to ~30 FPS, and keeps fewer Undo snapshots on heavy scenes.
- Avoid importing multiple huge atlases at once; export individual GLB modules after editing.

## Development

```bash
npm install
npm run dev
npm run build
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```

Capacitor 8 needs **Node.js 22+**, Android SDK and JDK 21 for cloud builds. The GitHub Actions workflow supplies those automatically.

## Roadmap

1. Detect, preview and individually split disconnected 3D islands without freezing the UI (web workers).
2. Brush-driven mesh selection and remove/rebuild holes.
3. Geometric solid booleans and capped cuts.
4. UV editor + texture/normal/AO baking, texture atlas packing and LOD.
5. Module library with exact pivot/snapping rules, quarter-round corners, off-axis roof pieces and collision meshes for Godot.
6. Stable release signing for simple APK upgrades and local project files.

## Scene and camera — tablet improvements (0.1.2)

- Open **☷ Сцена** on tablet. Tap **Удалить набор** to remove a selected imported file as one group (with confirmation); or tap **×** beside its filename. **Очистить сцену** removes all assets (with confirmation). Undo restores the previous scene when available.
- Imported GLB, GLTF, OBJ and STL files are each grouped into their own top-level bundle so a single delete can remove the entire import.
- Above the view buttons, switch between **⟳ Вращать** and **✥ Сдвигать**. In pan mode a single finger moves the camera freely, no world-origin lock. Two fingers pan/zoom in either mode. **◎ К объекту** focuses selected set or mesh; **⌂ Вся сцена** resets to the complete scene.
- Desktop: right mouse drag pans in both modes; F focuses the current selection; H toggles camera navigation mode.

## Precise local cleanup and copy alongside (0.1.3)

- Select a mesh in the scene. Under **Правка → Геометрия** tap **Выбрать грани пальцем** and tap the affected faces. Gold highlighting shows what will be deleted. Increase brush size if necessary. Tap **Удалить отмеченное** to remove ONLY those polygons; all other faces, UVs and material slots are preserved. The selected mesh's triangles may develop **open holes**; no automatic fill is claimed. Use **Снять отметки** to cancel.
- Under **Правка → Копирование детали**, select **Справа/Слева/Вперёд/Назад**, then **Копировать рядом**. Copies are independent editable meshes or whole groups, preserve textures, are positioned beside the world's axis-aligned bounding box, and can be moved with the normal transform gizmo.
- Imported bundles are groups; to delete one small part rather than copy everything, select its mesh by tapping on the 3D model or choosing it from the scene list.
- For plane-cut, the original trim tool still trims only the selected mesh (not all meshes). It is an approximate face-centroid cut without cap. Manual face selection is the safer option for a local repair.

## Assembly workflow / Construction bake (v0.1.4)

1. **Модули → Конструктор сборок → Создать сборку**; name it `Камин`, `Арка`, etc.
2. Create or import pieces, position each one, tap a piece on the scene and **Добавить выделенную деталь**. The original model is moved into the assembly without intentionally changing its world placement. You may add multiple parts (stone blocks, metal bars, trim, logos).
3. Select the active group in **Активная сборка**, press **Запечь в игровой модуль**. A separate game-ready static module appears beside the editable original. Transformation matrices become vertex coordinates, UVs and existing texture maps stay attached. If vertex attribute layouts are compatible, the parts are merged into a single mesh with multiple material slots. Otherwise meshes remain separate under the one module.
4. Select baked module and press **Сохранить выбранный GLB**. Export uses a local bottom-center pivot at (0,0,0), independent of its preview position; load it into Godot. Other scene contents do not contaminate the selected export.

**Not yet available:** creating a *new* PBR texture atlas from materials, lightmap/AO baking, automatic UV unwrapping, boolean sealing, automatic low-poly retopology, collision generation. GLB retains existing materials; a model with 15 materials may still have 15 material draw calls even when geometry is merged.

## Multi-floor house assembly (v0.1.5)

Under **Модули → Дом и этажи**:
- Create a named house and specify story height (default 3.0 m, supported 1.8–10 m). Each story is an editable independent group under the house. Add or duplicate stories (up to 12).
- Choose active floor. Create a wall, floor, corner, window opening, door opening, column, roof slope, or arch. New presets automatically appear adjacent to the previous parts along X, aligned to a 0.25 m grid; use the transform gizmo and existing dimensions to make a full floor plan. Or choose an already imported detail and select **Деталь на этаж**: it is moved into the selected floor, with its bounding-box bottom aligned to story elevation.
- **Показывать только активный этаж** makes working on internal rooms easier; **К этажу** focuses the camera.
- **Сохранить этаж GLB** exports only the chosen story relative to its own story origin.
- **Сохранить весь дом GLB** exports the editable full house hierarchy (each floor and component remain separate) and includes hidden storeys. Opening this GLB should preserve the arrangement without relying on a runtime server. It is NOT a baked low-poly whole-house mesh.
- Prefer baking subsections (static decor, furniture, facades) individually instead of baking a large house to a single mesh. Large projects may exceed memory on 4 GB tablets, so export often. Automated collisions, door logic, navmesh, UV atlas and semantic roofing are not part of this release.

The House module adds basic building assembly within QDQR; it does not replace Phoenix World Builder's dedicated architectural construction workflow.

## Fix for separate textured wall vs image (v0.1.6)

In the tablet's **Инструменты → Декор → Текстуры и отделка стен**:

**A. Apply an image directly to the selected wall**
1. Select the wall (or an entire group of connected wall modules).
2. Choose *Одно изображение на всю выбранную стену* to stretch a painting/graffiti/panorama across its entire width, or *Повторять по метрам* for seamless masonry/wood/tile.
3. Press *Наложить изображение НА стену*, choose a PNG/JPEG/WebP. The image is assigned to the selected mesh(es) as GLB material with face UV coordinates. No extra separate plane is created.
4. Choose *Сохранить выбранный GLB* in the Modules tab to export just the textured wall, or use the new *Сохранить стену вместе с декором* button.

**B. Attach a previously imported textured plane to a plain wall**
1. Select the plain wall object, press *Запомнить выбранную стену*.
2. Select the separately imported texture/decal/stone panel object. Choose *Растянуть накладку на всю стену* (default) and press *Прикрепить выбранную накладку*.
3. The panel is now a child of the wall; save the wall as one selected GLB. Materials/UVs remain on both parts, so both display on reimport. The new attachment is editable separately in the hierarchy; no texture atlas is generated.

Caveat: if imported meshes have unusual orientations or complex topology, auto-fit may need manual adjustment. The preview has no native GLB reimport smoke test on a physical device. The output stores PBR texture images and geometry in a single GLB binary when supported by Three.js exporter.

## Door, window and arched opening tool (v0.1.7)

1. Select one wall or a group of adjacent solid wall sections, then open **Проёмы**.
2. Choose **Дверь / Окно / Арка**, press **Разметить проём**. A golden translucent cutter preview appears over the wall. Tap or drag across the wall to position it. Optional **Точные размеры** controls width/height; the editor estimates wall thickness and aligns to floor/window sill.
3. Choose an optional simple frame or door leaf/window glass, then press **Вырезать и установить**.
4. CSG subtraction removes the opening from each affected wall mesh. The resulting 3D meshes have actual holes, not an overlay. Undo reverts a cut. Use **Модули → Сохранить выбранный GLB** on the wall to export just the wall with its new frame, or save the entire house in GLB.

**Supported:** closed, static watertight meshes, such as wall boxes, some imported wall sections. Multi-mesh groups are cut per intersecting mesh. Per-part textures are retained where original UV faces survive; new reveal/jamb triangles receive a matching default material and may need a texture adjustment. Simple generated frames/leaves are game previews, not automatic positioning of arbitrary imported door assets.

**Restrictions:** Complex open or non-manifold meshes may fail a boolean, so the editor refuses the cut without changing the wall. For safety, the operation limits dense triangles on Android. Pan/orbit camera mode is paused while positioning a cutout and restored on commit/cancel. Use Undo to reposition after applying the cut; editing an applied cut as a live parametric modifier is not yet supported. Collision meshes in Godot must be regenerated to respect the new opening.

## Gothic stained glass workflow (v0.1.8)

Select an imported window frame, then open **Декор → Стекло в оконную раму**. Tap **Найти отверстия** to generate a silhouette mask and detect enclosed empty regions. The scan uses a small WebGL render-to-texture in a direction orthogonal to the model's thinnest bounding-box dimension, avoiding costly CPU raycasting on dense ornaments.

Detected sections are shown in an overlay **without changing the stone frame**. Choose **Прозрачное / Тонированное / Витраж**, a color, and transparency. Use **Заполнить все секции** or switch it off and tap individual highlighted glass panes to toggle them. Press **Вставить стекло** to put independent, named, editable glass meshes inside the selected frame. **Сохранить окно со стеклом GLB** exports the frame and attached glass together (not other scene objects).

Stained glass mode adds deterministic multi-colored Voronoi fragments separated by simulated dark lead lines. Color, transparency, palette, and fragment size are simple controls. Material is transparent in game engine standard PBR with no actual refraction; material appearance varies by renderer.

The recognition is automatic but cannot guarantee every section in arbitrary/open/damaged meshes: only bounded holes in the projected silhouette are recognized. Thin breaks can connect interior black pixels to exterior and prevent detection. Non-planar freeform 3D surfaces are not automatically pane-filled. Geometry is triangulated from pixel-contour outlines at moderate mask resolution, which may require higher precision/cleanup for production window assets. Existing glass generated by the tool can be replaced by re-scanning the frame.

For Android performance, preview masks are capped at moderate resolution and at most 64 detected panes. Triangles, materials, glass, and existing frame are all saved together in a standard GLB.

## Wall-centerline & socket snapping (v0.1.9)

- All stock wall-like construction modules (**wall, rounded 90° corner, window opening, door opening**) have a shared construction axis running exactly through the center of the 0.25 m wall thickness. Straight/window/door segments are 3 m long, with socket points at ±1.5 m X. The curved corner is a quarter-annulus with radii 1.0 and 1.25 m and centerline radius 1.125 m, and its **pivot is moved to the first centerline socket**. Tangent-aligned connections use the endpoint tangent, not the bounding-box extremity.
- **Модули → Дом и этажи → Автостыковка стен и углов** defaults on. Newly placed compatible walls attach to the most recent free endpoint. During gizmo movement, when a moved compatible module approaches an unoccupied socket within 0.55 m, it snaps and rotates to match. Disable to position it freely. **Состыковать выбранное** uses a 1.2 m threshold. Socket metadata is stored in GLB extras and is compatible with cloned modules.
- Existing imported walls and decorative assets remain editable and do not automatically snap: their geometry has no trustworthy authored endpoint sockets.
- Stock **door/window** modules already have physical open recesses and exactly the same wall centerline as a straight wall. Select an imported door/window/frame and use **Вставить выбранную раму / дверь в проём** on an active house floor to size and align the selected import to the nearest preset opening. This is positioning/scaling only: no CSG is needed for these preset modules. For a solid wall use the **Проёмы** cutter first.
- Saving a full house, single floor, or selected assembly preserves all transforms. Complex curved/reprofiled meshes may require manual correction; fitting arbitrary imported assets cannot guarantee their artistic orientation.

## Texture mapping on every construction module (v0.1.10)

In **Декор → Текстуры для всех модулей**, select an individual module or a group of
walls/arches/floors/ceilings/roof pieces, then **Нанести текстуру на выбранное**.
The image modifies diffuse materials directly, not module dimensions or extra geometry.
The existing two modes still work: **one image** (stretch over the selected surface)
or **repeating texture** with user-entered meters per tile. GLB export preserves both
geometry and material maps.

The new surface-aware UV mapper projects onto each triangular face:
- vertical faces: natural XY or ZY depending on their orientation;
- floors, ceilings, underside of roof and horizontal slabs: XZ;
- sloping roof faces: XZ corrected for true length along the slope;
- built-in rounded 90-degree corner: angular distance around the centerline,
  with radial UV on caps and XZ UV for the horizontal top/bottom.

This eliminates zero-area UV triangles from projecting horizontal floors onto XY,
the main cause of the brushed/smeared image observed on those modules. The original
mesh geometry is never scaled. The chosen image is shared across a multi-module
selection. Existing paintings, decals and stained glass are excluded from replacing
the structural texture.

Limitations: UV unwrapping is still automatic planar/arc projection; arbitrary
organic 3D objects and joints spanning different plane orientations may exhibit
seams. 'One image' stretches independently within each orientation group; for
seamless stone on multiple surfaces prefer **Repeat by meters**. Very large
textures or densely triangulated models can exceed Android GPU memory.

## Android black 3D viewport diagnostics and protection (v0.1.11)

The UI can remain responsive while Android silently drops the WebGL context;
in that case all models and the ground grid vanish together. QDQR now detects
`webglcontextlost`, `webglcontextrestored` and exceptions during the render
loop. Rather than silently showing an empty canvas, it displays a diagnostic
overlay with **Восстановить 3D** and **Сохранить сцену GLB** so content can
still be rescued. The graphics engine remains in place and recovers when the
browser supplies a valid restored context. Errors in rendering do not remove
the models from the editable scene.

The import pipeline now validates finite model bounds before camera reset,
prevents concurrent file loads and rejects excessive total polygon counts
on memory-limited tablets. Large imported textures are downscaled to 1024px
maximum only on mobile, without changing the source GLB on disk, its
materials/UVs or scene geometry. Textures from mobile-model imports at 512px
are untouched. High-poly imports use lightweight structural undo checkpoints
to avoid cloning all existing vertex arrays in RAM.

The provided forge door-frame and door each contain one high-poly mesh:
~146k and ~165k triangles, respectively. Together they load ~311k triangles.
The saved stone corner has 196 triangles but embeds a ~1254px PNG. Merely
importing those files is not by itself proof of a GPU context loss: the warning
is a diagnostic mechanism to distinguish WebGL failure from camera or scene
problems on the actual device. This is not an automatic optimizer or mesh
decimator; it does not reduce geometry detail.

## Native Save As on Android (v0.1.12)

**Save / Export** now uses Android's Storage Access Framework ACTION_CREATE_DOCUMENT.
This opens the real Android file picker, where the user can select Downloads,
Documents, removable storage or any configured document provider, edit the
suggested filename and explicitly save GLB, glTF, OBJ, STL and PNG exports.
Telegram is no longer needed as an intermediate storage destination.

The exported file is staged to app-private cache via Capacitor Filesystem and
stream-copied to the chosen Android document Uri by the native
NativeFileSavePlugin, registered in MainActivity during CI Android generation.
This does not require broad filesystem permissions. The user can cancel safely
and retry; **Поделиться готовым файлом** still provides the older sharing
workflow for users who intentionally want Telegram/Drive/other apps.
Web versions continue using standard browser downloads.
