import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createOpeningGeometry,getWallBounds,defaultOpening,cutWallOpening,makeOpeningTrim} from '../src/openingOps.js';

const material=()=>new THREE.MeshStandardMaterial({color:'#a5a09b',side:THREE.DoubleSide});
const wall=(w=4,h=3,t=.3)=>{
 const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,t),material());
 m.position.y=h/2;m.name='Стена';return m;
};
function shoot(model,x,y,z=4){
 model.updateWorldMatrix(true,true);
 const ray=new THREE.Raycaster(new THREE.Vector3(x,y,z),new THREE.Vector3(0,0,-1),0,10);
 return ray.intersectObject(model,true).filter(hit=>!hit.object.userData?.qdqrOpeningTrim).length;
}
test('door cut forms an actual through-hole, not transparent overlay',()=>{
 const m=wall();
 const def=defaultOpening('door',m);
 assert.ok(Math.abs(def.centerY-(def.bbox.min.y+def.height/2))<1e-5);
 assert.ok(shoot(m,0,1)>0);
 const out=cutWallOpening(m,def);
 assert.equal(out.count,1);
 assert.equal(shoot(m,0,1),0,'Ray must pass through open door');
 assert.ok(shoot(m,1.7,1)>0,'Stone remains beside hole');
});
test('window CSG opens only at window height; masonry remains underneath',()=>{
 const m=wall();
 const def=defaultOpening('window',m);
 const out=cutWallOpening(m,def);
 assert.equal(out.count,1);
 assert.equal(shoot(m,0,def.centerY+m.position.y),0);
 assert.ok(shoot(m,0,.1)>0);
 assert.ok(shoot(m,1.8,1.4)>0);
});
test('opening across two adjacent wall sections changes both meshes',()=>{
 const group=new THREE.Group();
 const left=wall(2,3,.3),right=wall(2,3,.3);
 left.position.x=-1;right.position.x=1;
 group.add(left,right);
 const def=defaultOpening('door',group);
 def.width=1.2;
 const result=cutWallOpening(group,def);
 assert.equal(result.count,2);
 assert.equal(shoot(group,0,1),0);
 assert.ok(shoot(group,1.8,1)>0);
});
test('arch geometry contains curved top, trim is separately grouped',()=>{
 const cutter=createOpeningGeometry('arch',2,2.5,1);
 cutter.computeBoundingBox();
 assert.ok(Math.abs(cutter.boundingBox.max.y-1.25)<1e-3);
 const spec={kind:'arch',width:2,height:2.5,centerX:0,centerY:1.25,centerZ:0,thickness:1};
 const trim=makeOpeningTrim(spec,{addFrame:true});
 assert.equal(trim.userData.qdqrOpeningTrim,true);
 assert.ok(trim.children.some(x=>x.name==='Арочное обрамление'));
});
test('rotated wall can be cut in wall local frame',()=>{
 const root=new THREE.Group();
 root.position.set(7,1,-4);root.rotation.y=.45;
 const m=wall();root.add(m);
 const def=defaultOpening('door',m);
 const res=cutWallOpening(m,def);
 assert.equal(res.count,1);
 m.updateWorldMatrix(true,true);
 const point=m.localToWorld(new THREE.Vector3(0,def.centerY,4));
 const dir=new THREE.Vector3(0,0,-1).transformDirection(m.matrixWorld);
 const hits=new THREE.Raycaster(point,dir,0,10).intersectObject(m,true);
 assert.equal(hits.length,0);
});
