import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {bakeStaticAssembly} from '../src/assemblyOps.js';

test('assembling two textured objects merges geometry without changing sources',()=>{
  const source=new THREE.Group();source.name='Камин';
  const stone=new THREE.Mesh(new THREE.BoxGeometry(3,2,.25),
    new THREE.MeshStandardMaterial({color:0xbbaa99}));
  stone.position.set(2,1,0);
  const iron=new THREE.Mesh(new THREE.BoxGeometry(.8,1,.2),
    new THREE.MeshStandardMaterial({color:0x555555,metalness:1}));
  iron.position.set(1.5,1,.2);
  source.add(stone,iron);
  const originalStoneX=stone.position.x;
  const beforeVertices=stone.geometry.getAttribute('position').count;
  const result=bakeStaticAssembly(source,{merge:true});
  assert.equal(result.userData.qdqrBakedModule,true);
  assert.equal(result.children.length,1);
  const merged=result.children[0];
  assert.equal(merged.material.length,2);
  assert.ok(merged.geometry.groups.length>=2); // One or more groups per part/material
  assert.ok(merged.geometry.groups.every(g=>g.materialIndex>=0 && g.materialIndex<merged.material.length)); 
  assert.ok(merged.geometry.getAttribute('uv'));
  assert.ok(Math.abs(new THREE.Box3().setFromObject(result).min.y)<1e-5);
  assert.equal(stone.position.x,originalStoneX);
  assert.equal(stone.geometry.getAttribute('position').count,beforeVertices);
});

test('incompatible vertex layouts keep separate meshes inside one baked module',()=>{
  const group=new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()));
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));
  const result=bakeStaticAssembly(group,{merge:true});
  assert.equal(result.children.length,2);
  assert.equal(result.userData.merged,false);
});

test('module baking includes world-space transform but not world-space position offset',()=>{
  const group=new THREE.Group();
  group.position.set(7,5,-3);
  group.scale.set(2,1.5,.5);
  group.rotation.y=Math.PI/4;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshStandardMaterial());
  mesh.position.set(1,1,0);
  group.add(mesh);
  const expected=new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  const result=bakeStaticAssembly(group);
  const actual=new THREE.Box3().setFromObject(result);
  const dims=actual.getSize(new THREE.Vector3());
  assert.ok(expected.distanceTo(dims)<1e-5);
  assert.ok(Math.abs(actual.min.y)<1e-5);
  assert.equal(result.position.lengthSq(),0);
});

test('cannot silently bake rigged mesh',()=>{
  const model=new THREE.SkinnedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());
  assert.throws(()=>bakeStaticAssembly(model),/Скелет/);
});

test('all invisible parts are excluded',()=>{
  const group=new THREE.Group();group.visible=false;
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()));
  assert.throws(()=>bakeStaticAssembly(group),/нет видимой/);
});
