import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHouse,createFloor,getFloors,putOnFloor,addPresetToFloor,setFloorVisibility} from '../src/houseOps.js';

test('house contains named independent story groups with configured vertical spacing',()=>{
 const house=createHouse('Каменный дом',3.25);
 assert.equal(house.userData.qdqrHouse,true);
 assert.equal(getFloors(house).length,1);
 const second=createFloor(house);
 const third=createFloor(house);
 assert.equal(second.position.y,3.25);
 assert.equal(third.position.y,6.5);
 assert.equal(second.name,'Этаж 2');
});

test('wall presets are placed next to each other instead of overlapping',()=>{
 const house=createHouse('Дом',3);
 const floor=getFloors(house)[0];
 const material=new THREE.MeshStandardMaterial();
 const a=addPresetToFloor(floor,'wall',material);
 const b=addPresetToFloor(floor,'wall',material);
 house.updateWorldMatrix(true,true);
 const b1=new THREE.Box3().setFromObject(a);
 const b2=new THREE.Box3().setFromObject(b);
 assert.ok(b2.min.x>=b1.max.x-1e-5);
 assert.ok(Math.abs(b.position.x/.25-Math.round(b.position.x/.25))<1e-6);
});

test('place an imported object on selected story while preserving shape',()=>{
 const house=createHouse('Дом',3);
 const floor=createFloor(house);
 const model=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshStandardMaterial());
 model.position.set(5,1,2);
 const root=new THREE.Group();root.add(house,model);
 const startX=new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()).x;
 putOnFloor(floor,model);
 const box=new THREE.Box3().setFromObject(model);
 assert.equal(model.parent,floor);
 assert.ok(Math.abs(box.min.y-3)<1e-5);
 assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x-startX)<1e-5);
});

test('floor-only preview is reversible and does not remove components',()=>{
 const house=createHouse('Дом');
 const floor1=getFloors(house)[0],floor2=createFloor(house);
 floor1.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));
 setFloorVisibility(house,floor2,{isolate:true});
 assert.equal(floor1.visible,false);
 assert.equal(floor2.visible,true);
 setFloorVisibility(house,floor2,{isolate:false});
 assert.equal(floor1.visible,true);
 assert.equal(floor1.children.length,1);
});
test('prevent putting house inside its own floor',()=>{
 const house=createHouse('Дом');
 const floor=getFloors(house)[0];
 assert.throws(()=>putOnFloor(floor,house),/родительскую/);
});
