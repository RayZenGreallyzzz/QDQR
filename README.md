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
