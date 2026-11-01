import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createConstruction} from '../src/meshOps.js';
import {createHouse,getFloors,addPresetToFloor,fitInsertToOpening} from '../src/houseOps.js';
import {moduleSockets,dockNewModule,snapNearbyModule,snapVerticalModule,stackModuleOn,socketsConnectionError,locateWallModule,locateBuildModule,placeAdjacentTo} from '../src/wallSnap.js';

const material=()=>new THREE.MeshStandardMaterial({color:0xc5b8aa});
const near=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<tol,String(a)+' != '+String(b));
function bounds(obj){
 obj.updateWorldMatrix(true,true);
 return new THREE.Box3().setFromObject(obj);
}
function rayHits(obj,x,y){
 obj.updateWorldMatrix(true,true);
 const ray=new THREE.Raycaster(new THREE.Vector3(x,y,4),new THREE.Vector3(0,0,-1));
 return ray.intersectObject(obj,true).length;
}
test('wall and rounded corner share 25cm centerline, not mesh edge',()=>{
 const wall=createConstruction('wall',material());
 const arc=createConstruction('corner',material());
 for(const obj of [wall,arc]){
   assert.equal(obj.userData.qdqrWallAxis,'centerline');
   assert.equal(obj.userData.qdqrWallThickness,.25);
   const ss=moduleSockets(obj);
   assert.equal(ss.length,2);
   near(ss[0].thickness,.25);
 }
 const wbox=bounds(wall);
 near(wbox.min.z,-.125);near(wbox.max.z,.125);
 const sockets=moduleSockets(arc);
 near(sockets[0].point.x,0);near(sockets[0].point.z,0);
 near(sockets[1].point.x,-1.125);
 near(sockets[1].point.z,-1.125);
 const arcBounds=bounds(arc);
 assert.ok(arcBounds.min.x < 0 && arcBounds.max.x > 0,'Arc straddles its connection axis');
});
test('autodock wall to rounded corner, then door and window; no seam gaps',()=>{
 const house=createHouse('Крепость',3);
 const floor=getFloors(house)[0];
 const wall=addPresetToFloor(floor,'wall',material());
 const corner=addPresetToFloor(floor,'corner',material());
 const door=addPresetToFloor(floor,'door',material());
 const window=addPresetToFloor(floor,'window',material());
 const links=[[wall,corner],[corner,door],[door,window]];
 for(const [a,b] of links){
   const {distance,alignment}=socketsConnectionError(a,b);
   near(distance,0,.0001);
   assert.ok(alignment<-.999,'Socket tangent must face opposite directions');
 }
 assert.equal(floor.children.length,4);
});
test('window and door wall presets have true matching depth and aperture dimensions',()=>{
 const wall=createConstruction('wall',material());
 const door=createConstruction('door',material());
 const window=createConstruction('window',material());
 for(const v of [wall,door,window]){
   near(bounds(v).getSize(new THREE.Vector3()).z,.25);
   near(bounds(v).getSize(new THREE.Vector3()).x,3);
   near(bounds(v).getSize(new THREE.Vector3()).y,2.6);
 }
 near(door.userData.qdqrOpening.width,1.2);
 near(door.userData.qdqrOpening.height,2.05);
 near(window.userData.qdqrOpening.width,1.4);
 near(window.userData.qdqrOpening.height,.9);
 near(window.userData.qdqrOpening.centerY,1.5);
 assert.equal(rayHits(door,0,1.2),0);
 assert.ok(rayHits(door,1.4,1.2)>0);
 assert.equal(rayHits(window,0,1.5),0);
 assert.ok(rayHits(window,0,.5)>0);
});
test('snap a moved wall only when close to an unoccupied socket',()=>{
 const root=new THREE.Group();
 const a=createConstruction('wall',material());root.add(a);
 const b=createConstruction('wall',material());root.add(b);
 b.position.set(17,0,0);
 assert.equal(snapNearbyModule(b,root,{threshold:.45}),null);
 near(b.position.x,17);
 b.position.set(3.17,0,.12);
 const result=snapNearbyModule(b,root,{threshold:.5});
 assert.ok(result);near(result.error,0,.0001);
 near(socketsConnectionError(a,b).distance,0,.0001);
});
test('do not snap to an already occupied endpoint',()=>{
 const root=new THREE.Group();
 const a=createConstruction('wall',material());root.add(a);
 const b=createConstruction('wall',material());root.add(b);
 dockNewModule(b,root,{preferred:a});
 const c=createConstruction('wall',material());root.add(c);
 c.position.x=3.1;
 const result=snapNearbyModule(c,root,{threshold:.5});
 // The occupied a-B / b-A junction is forbidden, but the free b-B
 // socket is nearby and may be used instead.
 assert.ok(result);
 assert.equal(result.anchor,b);
 const connected=socketsConnectionError(b,c);
 near(connected.distance,0,.0001);
});
test('imported door / window frames can be fitted inside nearest ready wall opening',()=>{
 const house=createHouse('Дом',3),floor=getFloors(house)[0];
 const window=addPresetToFloor(floor,'window',material());
 const imported=new THREE.Group();
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.0,.03),material());
 imported.add(mesh);imported.position.set(3,0,0);
 const worldRoot=new THREE.Group();worldRoot.add(house,imported);
 const res=fitInsertToOpening(floor,imported);
 assert.equal(res.module,window);
 assert.equal(imported.parent,window);
 assert.ok(imported.userData.qdqrInstalledInOpening);
 const box=bounds(imported),actual=bounds(window);
 assert.ok(actual.containsBox(box)||Math.abs(box.max.z-actual.max.z)<.01);
});


test('choosing a child mesh resolves its wall module, not a detached polygon',()=>{
 const scene=new THREE.Group(),wall=createConstruction('corner',material());
 scene.add(wall);
 const child=wall.children[0];
 assert.equal(locateWallModule(child),wall);
 assert.equal(locateWallModule(wall),wall);
 assert.equal(locateWallModule(new THREE.Mesh(new THREE.BoxGeometry(),material())),null);
});
test('adding another module near a previously moved wall never returns to origin',()=>{
 const root=new THREE.Group();
 const first=createConstruction('wall',material());
 root.add(first);first.position.set(42,0,-31);
 const second=createConstruction('window',material());
 root.add(second);
 const join=dockNewModule(second,root,{preferred:first});
 assert.ok(join);
 assert.ok(second.position.x>39);
 assert.ok(second.position.z< -28);
 near(socketsConnectionError(first,second).distance,0,.0001);
});
test('generic module starts near current building piece instead of world origin',()=>{
 const root=new THREE.Group();
 const reference=createConstruction('wall',material());
 root.add(reference);reference.position.set(53,0,-47);
 const furniture=createConstruction('column',material());
 root.add(furniture);
 const placed=placeAdjacentTo(furniture,reference);
 assert.equal(placed,true);
 const a=bounds(reference),b=bounds(furniture);
 near(b.min.x,a.max.x+.08,.0001);
 near(b.min.y,a.min.y,.0001);
 assert.ok(Math.abs(b.getCenter(new THREE.Vector3()).z+47)<.1);
});
test('adjacent placement respects a rotated parent group in world coordinates',()=>{
 const world=new THREE.Group(),parent=new THREE.Group();
 world.add(parent);parent.position.set(26,0,11);parent.rotation.y=.6;
 const anchor=createConstruction('wall',material());parent.add(anchor);
 const next=createConstruction('column',material());parent.add(next);
 assert.equal(placeAdjacentTo(next,anchor),true);
 const a=bounds(anchor),b=bounds(next);
 near(b.min.x,a.max.x+.08,.0001);
});

test('upper-story wall snaps to actual top face of lower wall',()=>{
 const root=new THREE.Group();
 const lower=createConstruction('wall',material());root.add(lower);
 const upper=createConstruction('wall',material());root.add(upper);
 upper.position.set(.18,2.48,.12);
 const result=snapVerticalModule(upper,root,{verticalThreshold:.4,horizontalThreshold:.5});
 assert.ok(result);assert.equal(result.kind,'vertical');
 const a=bounds(lower),b=bounds(upper);
 near(b.min.y,a.max.y,.0001);
 const pa=lower.getWorldPosition(new THREE.Vector3()),pb=upper.getWorldPosition(new THREE.Vector3());
 near(pa.x,pb.x,.0001);near(pa.z,pb.z,.0001);
});

test('gable can stack directly on a straight wall and child mesh resolves build module',()=>{
 const root=new THREE.Group(),wall=createConstruction('wall',material()),gable=createConstruction('gable',material());
 root.add(wall,gable);
 const result=stackModuleOn(gable,wall);
 assert.ok(result);
 near(bounds(gable).min.y,bounds(wall).max.y,.0001);
 assert.equal(locateBuildModule(gable.children[0]),gable);
});
