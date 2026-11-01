import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createHouse,createFloor,getFloors,putOnFloor,addPresetToFloor,
  setFloorVisibility,floorStructuralTop
} from '../src/houseOps.js';

const material=()=>new THREE.MeshStandardMaterial();
const near=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<tol,String(a)+' != '+String(b));
const bounds=obj=>{obj.updateWorldMatrix(true,true);return new THREE.Box3().setFromObject(obj);};

test('story bases are derived from real floor + wall geometry, not a fixed height',()=>{
  const house=createHouse('Каменный дом');
  const floor1=getFloors(house)[0];
  const slab1=addPresetToFloor(floor1,'floor',material());
  const wall1=addPresetToFloor(floor1,'wall',material());

  const s1=bounds(slab1),w1=bounds(wall1);
  near(s1.min.y,0);near(s1.max.y,.18);
  near(w1.min.y,.18);near(w1.max.y,2.78);
  near(floorStructuralTop(floor1),2.78);

  const floor2=createFloor(house);
  near(floor2.position.y,2.78);

  const slab2=addPresetToFloor(floor2,'floor',material());
  const wall2=addPresetToFloor(floor2,'wall',material());
  const s2=bounds(slab2),w2=bounds(wall2);
  near(s2.min.y,w1.max.y);
  near(s2.max.y,2.96);
  near(w2.min.y,s2.max.y);
  near(wall2.getWorldPosition(new THREE.Vector3()).x,wall1.getWorldPosition(new THREE.Vector3()).x);
  near(wall2.getWorldPosition(new THREE.Vector3()).z,wall1.getWorldPosition(new THREE.Vector3()).z);
  assert.equal(wall2.userData.qdqrLastJoin?.kind,'vertical');
});

test('empty previous story cannot invent a fake 3m height',()=>{
  const house=createHouse('Дом');
  assert.throws(()=>createFloor(house),/Предыдущий этаж пуст/);
});

test('wall presets on one story still dock horizontally without overlap',()=>{
  const house=createHouse('Дом');
  const floor=getFloors(house)[0];
  const a=addPresetToFloor(floor,'wall',material());
  const b=addPresetToFloor(floor,'wall',material());
  const aBox=bounds(a),bBox=bounds(b);
  assert.ok(bBox.min.x>=aBox.max.x-1e-5);
  assert.equal(b.userData.qdqrLastJoin?.kind,'horizontal');
});

test('place imported object on selected story and respect its floor slab thickness',()=>{
  const house=createHouse('Дом');
  const floor1=getFloors(house)[0];
  addPresetToFloor(floor1,'wall',material());
  const floor2=createFloor(house);
  const slab=addPresetToFloor(floor2,'floor',material());
  const model=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),material());
  model.position.set(5,1,2);
  const root=new THREE.Group();root.add(house,model);
  const startX=bounds(model).getCenter(new THREE.Vector3()).x;
  putOnFloor(floor2,model);
  const box=bounds(model),slabBox=bounds(slab);
  assert.equal(model.parent,floor2);
  near(box.min.y,slabBox.max.y);
  near(box.getCenter(new THREE.Vector3()).x,startX);
});

test('floor-only preview is reversible and does not remove components',()=>{
  const house=createHouse('Дом');
  const floor1=getFloors(house)[0];
  addPresetToFloor(floor1,'wall',material());
  const floor2=createFloor(house);
  setFloorVisibility(house,floor2,{isolate:true});
  assert.equal(floor1.visible,false);
  assert.equal(floor2.visible,true);
  setFloorVisibility(house,floor2,{isolate:false});
  assert.equal(floor1.visible,true);
  assert.ok(floor1.children.length>0);
});

test('prevent putting house inside its own floor',()=>{
  const house=createHouse('Дом');
  const floor=getFloors(house)[0];
  assert.throws(()=>putOnFloor(floor,house),/родительскую/);
});
