import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createConstruction} from '../src/meshOps.js';
import {selectionGizmoPose,applyCenteredGizmo} from '../src/editorGizmo.js';

const near=(a,b,tol=.00001)=>assert.ok(Math.abs(a-b)<tol,String(a)+' != '+String(b));
test('curved wall pivot follows its visible geometry center rather than socket at origin',()=>{
 const group=createConstruction('corner',new THREE.MeshStandardMaterial());
 group.position.set(35,0,-16);
 const root=new THREE.Group();root.add(group);
 const actual=new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
 const pose=selectionGizmoPose(group);
 near(pose.position.distanceTo(actual),0);
 assert.ok(pose.position.distanceTo(group.position)>.1,
   'The arc has an off-centre connection socket, so gizmo must be elsewhere');
});
test('drag centered proxy moves the selected wall and does not rewrite its geometry',()=>{
 const root=new THREE.Group(),module=createConstruction('corner',new THREE.MeshStandardMaterial());
 root.add(module);module.position.set(27,0,-8);
 const beforeBox=new THREE.Box3().setFromObject(module);
 const beforeGeometry=module.children[0].geometry;
 const initialWorld=module.matrixWorld.clone();
 const pose=selectionGizmoPose(module);
 const startPivot=new THREE.Matrix4().compose(pose.position,pose.quaternion,new THREE.Vector3(1,1,1));
 const endPivot=new THREE.Matrix4().makeTranslation(3,0,-2).multiply(startPivot);
 applyCenteredGizmo(module,endPivot,startPivot,initialWorld,root.matrixWorld.clone().invert());
 const afterBox=new THREE.Box3().setFromObject(module);
 const a=beforeBox.getCenter(new THREE.Vector3()),b=afterBox.getCenter(new THREE.Vector3());
 near(b.x-a.x,3);near(b.z-a.z,-2);
 assert.equal(module.children[0].geometry,beforeGeometry);
});
test('rotation around mesh center does not orbit a curved wall around its socket',()=>{
 const root=new THREE.Group(),module=createConstruction('corner',new THREE.MeshStandardMaterial());
 root.add(module);
 const originalBox=new THREE.Box3().setFromObject(module);
 const initialCentre=originalBox.getCenter(new THREE.Vector3());
 const pose=selectionGizmoPose(module);
 const start=new THREE.Matrix4().compose(pose.position,pose.quaternion,new THREE.Vector3(1,1,1));
 const turn=new THREE.Matrix4().makeTranslation(pose.position.x,pose.position.y,pose.position.z)
   .multiply(new THREE.Matrix4().makeRotationY(Math.PI/2))
   .multiply(new THREE.Matrix4().makeTranslation(-pose.position.x,-pose.position.y,-pose.position.z));
 applyCenteredGizmo(module,turn.clone().multiply(start),start,module.matrixWorld.clone(),root.matrixWorld.clone().invert());
 const shifted=new THREE.Box3().setFromObject(module).getCenter(new THREE.Vector3());
 near(shifted.x,initialCentre.x,1e-4);
 near(shifted.y,initialCentre.y,1e-4);
 near(shifted.z,initialCentre.z,1e-4);
});
test('drag works inside moved and rotated house parent without world/local drift',()=>{
 const root=new THREE.Group(),floor=new THREE.Group();root.add(floor);
 floor.position.set(25,5,-20);floor.rotation.y=.5;
 const module=createConstruction('wall',new THREE.MeshStandardMaterial());
 floor.add(module);module.position.x=2;
 const pose=selectionGizmoPose(module);
 const start=new THREE.Matrix4().compose(pose.position,pose.quaternion,new THREE.Vector3(1,1,1));
 const localStart=module.matrixWorld.clone();
 const parentInverse=floor.matrixWorld.clone().invert();
 const shift=new THREE.Matrix4().makeTranslation(1,0,2);
 applyCenteredGizmo(module,shift.clone().multiply(start),start,localStart,parentInverse);
 const updatedPose=selectionGizmoPose(module);
 near(updatedPose.position.x-pose.position.x,1);
 near(updatedPose.position.z-pose.position.z,2);
});
