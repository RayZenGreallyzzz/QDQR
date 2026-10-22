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
