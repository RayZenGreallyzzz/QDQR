import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createRuntimeProfile,
  measureScene,
  mobileSceneBudget,
  validateSceneBounds,
  inspectGlb,
  optimizeGlbTextures,
  disposeDetachedResources
} from '../src/renderSafety.js';

function mesh(triangles){
  const vertices=new Float32Array(triangles*3*3);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  return new THREE.Mesh(g,new THREE.MeshStandardMaterial());
}
function fakePng(width,height){
  const b=new Uint8Array(24);
  b.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],0);
  b.set([0,0,0,13,0x49,0x48,0x44,0x52],8);
  const v=new DataView(b.buffer);
  v.setUint32(16,width,false);v.setUint32(20,height,false);
  return b;
}
function align4(n){return (n+3)&~3;}
function buildGlb(json,bin){
  const encoder=new TextEncoder();
  const jsonBytes=encoder.encode(JSON.stringify(json));
  const jp=align4(jsonBytes.length),bp=align4(bin.length);
  const total=12+8+jp+8+bp;
  const out=new Uint8Array(total),view=new DataView(out.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
  view.setUint32(12,jp,true);view.setUint32(16,0x4e4f534a,true);
  out.fill(0x20,20,20+jp);out.set(jsonBytes,20);
  const bo=20+jp;
  view.setUint32(bo,bp,true);view.setUint32(bo+4,0x004e4942,true);
  out.set(bin,bo+8);
  return out.buffer;
}
function sampleGlb(width=4096,height=2048){
  const image=fakePng(width,height);
  const json={
    asset:{version:'2.0'},
    buffers:[{byteLength:image.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:image.length}],
    accessors:[
      {componentType:5126,count:300,type:'VEC3'},
      {componentType:5125,count:300,type:'SCALAR'}
    ],
    images:[{bufferView:0,mimeType:'image/png'}],
    textures:[{source:0}],
    materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],
    nodes:[{mesh:0}],
    scenes:[{nodes:[0]}],
    scene:0
  };
  return buildGlb(json,image);
}

test('runtime profile does not classify every coarse-pointer device as 4 GB',()=>{
  const tablet8=createRuntimeProfile({
    isAndroid:true,coarsePointer:true,deviceMemoryGiB:8,maxTextureSize:8192
  });
  assert.equal(tablet8.constrained,false);
  assert.equal(tablet8.textureSide,2048);

  const tablet4=createRuntimeProfile({
    isAndroid:true,coarsePointer:true,deviceMemoryGiB:4,maxTextureSize:8192
  });
  assert.equal(tablet4.constrained,true);
  assert.equal(tablet4.textureSide,1024);

  const desktopTouch=createRuntimeProfile({
    isAndroid:false,coarsePointer:true,deviceMemoryGiB:8,maxTextureSize:16384
  });
  assert.equal(desktopTouch.constrained,false);
});

test('scene measurement counts actual geometry and decoded texture storage',()=>{
  const geometry=new THREE.BoxGeometry(1,1,1);
  const tex=new THREE.DataTexture(new Uint8Array(1024*1024*4),1024,1024,THREE.RGBAFormat);
  const material=new THREE.MeshStandardMaterial({map:tex});
  const obj=new THREE.Mesh(geometry,material);
  const measured=measureScene(obj);
  assert.equal(measured.meshes,1);
  assert.equal(measured.textures,1);
  assert.equal(measured.texturePixels,1024*1024);
  assert.ok(measured.geometryBytes>0);
  assert.ok(measured.textureBytes>=1024*1024*4);
  assert.equal(measured.gpuBytes,measured.geometryBytes+measured.textureBytes);
});

test('triangle count alone no longer triggers a fake hard stop',()=>{
  const profile={resourceBudgetMiB:256};
  const budget=mobileSceneBudget(
    {triangles:800000,geometryBytes:40*1024*1024,textureBytes:20*1024*1024},
    {triangles:500000,geometryBytes:35*1024*1024,textureBytes:15*1024*1024},
    profile
  );
  assert.equal(budget.total,1300000);
  assert.equal(budget.hardLimitExceeded,false);
  assert.equal(budget.softLimitExceeded,false);
});

test('measured GPU resource pressure can trigger a real memory stop',()=>{
  const profile={resourceBudgetMiB:200};
  const budget=mobileSceneBudget(
    {triangles:100000,geometryBytes:70*1024*1024,textureBytes:80*1024*1024},
    {triangles:100000,geometryBytes:30*1024*1024,textureBytes:40*1024*1024},
    profile
  );
  assert.equal(budget.hardLimitExceeded,true);
  assert.ok(budget.approximateGpuMiB>200);
});

test('camera bounds reject NaN and precision-destroying world offsets',()=>{
  assert.throws(()=>validateSceneBounds(new THREE.Group()),/геометрии/);

  const bad=new THREE.BufferGeometry();
  bad.setAttribute('position',new THREE.Float32BufferAttribute([NaN,0,0,3,1,0,0,1,0],3));
  const root=new THREE.Group();
  root.add(new THREE.Mesh(bad,new THREE.MeshStandardMaterial()));
  assert.throws(()=>validateSceneBounds(root),/координаты|геометрии/);

  const far=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());
  far.position.x=20_000_000;
  assert.throws(()=>validateSceneBounds(far),/центра координат/);
});

test('GLB preflight counts geometry and plans 4K texture reduction before Three.js parse',()=>{
  const glb=sampleGlb(4096,2048);
  const info=inspectGlb(glb,{maxTextureSide:1024});
  assert.equal(info.triangles,100);
  assert.equal(info.meshes,1);
  assert.equal(info.oversizedImages,1);
  assert.equal(info.images[0].targetWidth,1024);
  assert.equal(info.images[0].targetHeight,512);
  assert.equal(info.projectedTexturePixels,1024*512);
  assert.ok(info.geometryBytes>0);
});

test('GLB texture optimizer rewrites image bufferView before loader sees it',async()=>{
  const glb=sampleGlb(4096,2048);
  const result=await optimizeGlbTextures(glb,{
    maxSide:1024,
    resizeImage:async(_bytes,{targetWidth,targetHeight})=>fakePng(targetWidth,targetHeight)
  });
  assert.equal(result.resized,1);
  const info=inspectGlb(result.buffer,{maxTextureSide:1024});
  assert.equal(info.oversizedImages,0);
  assert.equal(info.images[0].width,1024);
  assert.equal(info.images[0].height,512);
});

test('detached resources are disposed without destroying resources still used by live scene',()=>{
  const sharedGeometry=new THREE.BoxGeometry(1,1,1);
  const sharedTexture=new THREE.Texture();
  const sharedMaterial=new THREE.MeshStandardMaterial({map:sharedTexture});
  const detached=new THREE.Mesh(sharedGeometry,sharedMaterial);
  const keep=new THREE.Group();
  keep.add(new THREE.Mesh(sharedGeometry,sharedMaterial));

  let gd=0,md=0,td=0;
  sharedGeometry.addEventListener('dispose',()=>gd++);
  sharedMaterial.addEventListener('dispose',()=>md++);
  sharedTexture.addEventListener('dispose',()=>td++);

  disposeDetachedResources(detached,keep);
  assert.deepEqual([gd,md,td],[0,0,0]);

  disposeDetachedResources(detached,null);
  assert.deepEqual([gd,md,td],[1,1,1]);
});
