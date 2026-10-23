import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ANDROID_LIMITS,measureScene,mobileSceneBudget,validateSceneBounds} from '../src/renderSafety.js';

function mesh(triangles){
  const vertices=new Float32Array(triangles*3*3);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  const m=new THREE.MeshStandardMaterial();
  return new THREE.Mesh(g,m);
}
test('three high-detail GLB models are measured as a combined scene, not one file',()=>{
  const scene=new THREE.Group();
  scene.add(mesh(164702),mesh(146148),mesh(196));
  const measure=measureScene(scene);
  assert.equal(measure.triangles,311046);
  assert.equal(measure.meshes,3);
  assert.equal(measure.textures,0);
  const budget=mobileSceneBudget({triangles:164702,texturePixels:0},{triangles:146148,texturePixels:0});
  assert.equal(budget.total,310850);
  assert.equal(budget.softLimitExceeded,false);
});
test('too many polygons trigger a safety stop before expensive third model import',()=>{
 const budget=mobileSceneBudget({triangles:800000,texturePixels:0},{triangles:190000,texturePixels:0});
 assert.ok(budget.hardLimitExceeded);
 assert.ok(budget.total>ANDROID_LIMITS.hardTriangles);
});
test('sample imported models have bounded 3D camera targets',()=>{
 const root=new THREE.Group(),door=mesh(12);
 door.geometry=new THREE.BoxGeometry(1.2,2.3,.3);
 root.add(door);
 door.position.set(50,8,-30);
 const o=validateSceneBounds(root);
 assert.ok(Math.abs(o.center.x-50)<.00001);
 assert.ok(o.size.y>2);
});
test('reject empty model rather than send NaN/Infinity into camera',()=>{
 assert.throws(()=>validateSceneBounds(new THREE.Group()),/геометрии/);
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute([NaN,0,0,3,1,0,0,1,0],3));
 const root=new THREE.Group();
 root.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial()));
 assert.throws(()=>validateSceneBounds(root),/координаты|геометрии/);
});
test('GPU texture budget uses decoded pixels not compressed glb file size',()=>{
 const tex=new THREE.DataTexture(new Uint8Array(1024*1024*4),1024,1024,THREE.RGBAFormat);
 const m=new THREE.MeshStandardMaterial({map:tex});
 const obj=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),m);
 const measured=measureScene(obj);
 assert.equal(measured.textures,1);
 assert.equal(measured.texturePixels,1024*1024);
 assert.ok(Math.abs(mobileSceneBudget(measured,{triangles:0,texturePixels:0}).approximateTextureMiB-4)<.001);
});
