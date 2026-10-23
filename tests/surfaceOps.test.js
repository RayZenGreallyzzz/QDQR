import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {projectTextureToWall,projectTextureToModule,attachDecorToWall,localGeometryBounds} from '../src/surfaceOps.js';
import {bakeStaticAssembly} from '../src/assemblyOps.js';
import {createConstruction} from '../src/meshOps.js';

const image=()=>{
 const data=new Uint8Array([244,210,160,255,90,110,130,255,40,40,40,255,220,190,120,255]);
 const t=new THREE.DataTexture(data,2,2,THREE.RGBAFormat);
 t.needsUpdate=true;
 return t;
};

test('one image covers a wall mesh and original geometry stays independent',()=>{
 const geometry=new THREE.BoxGeometry(3,2.5,.25);
 const wall=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#b1a18e'}));
 const originalPositions=geometry.getAttribute('position').count;
 const result=projectTextureToWall(wall,image(),{mode:'stretch'});
 assert.equal(result.meshes,1);
 assert.equal(result.width,3);
 assert.equal(result.height,2.5);
 assert.notEqual(wall.geometry,geometry);
 assert.equal(geometry.getAttribute('position').count,originalPositions);
 assert.equal(wall.material.map.isTexture,true);
 assert.equal(wall.material.color.getHex(),0xffffff);
 const uv=wall.geometry.getAttribute('uv');
 let min=Infinity,max=-Infinity;
 for(let i=0;i<uv.count;i++){min=Math.min(min,uv.getX(i));max=Math.max(max,uv.getX(i));}
 assert.ok(min>=-1e-6&&max<=1.00001);
});

test('full-facade UV projection spans two meshes without restarting per wall',()=>{
 const group=new THREE.Group();
 const first=new THREE.Mesh(new THREE.BoxGeometry(2,2,.2),new THREE.MeshStandardMaterial());
 const second=new THREE.Mesh(new THREE.BoxGeometry(2,2,.2),new THREE.MeshStandardMaterial());
 first.position.x=-1;second.position.x=1;
 group.add(first,second);
 const result=projectTextureToWall(group,image(),{mode:'stretch'});
 assert.equal(result.meshes,2);
 assert.ok(Math.abs(result.width-4)<1e-5);
 const a=first.geometry.getAttribute('uv'),b=second.geometry.getAttribute('uv');
 // Front faces still share the same projection over both panels.
 // Side and top faces now receive their OWN noncollapsed UVs instead of XY.
 let maxA=-Infinity,minB=Infinity;
 function frontU(mesh){
   const pos=mesh.geometry.getAttribute('position'),uv=mesh.geometry.getAttribute('uv');
   const result=[];
   for(let i=0;i<pos.count;i+=3){
     if(Math.abs(pos.getZ(i)-.1)>.0001||
        Math.abs(pos.getZ(i+1)-.1)>.0001||
        Math.abs(pos.getZ(i+2)-.1)>.0001)continue;
     for(let k=0;k<3;k++)result.push(uv.getX(i+k));
   }
   return result;
 }
 for(const u of frontU(first))maxA=Math.max(maxA,u);
 for(const u of frontU(second))minB=Math.min(minB,u);
 assert.ok(Math.abs(maxA-.5)<1e-4);
 assert.ok(Math.abs(minB-.5)<1e-4);
});

test('separate textured plane attaches to original wall and bakes as one module',()=>{
 const scene=new THREE.Group();
 const wall=new THREE.Mesh(new THREE.BoxGeometry(3,2,.25),new THREE.MeshStandardMaterial());
 wall.name='Обычная стена';wall.position.set(4,1,0);
 const panel=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshStandardMaterial({map:image()}));
 panel.name='Каменная накладка';panel.position.set(7,1,0);
 scene.add(wall,panel);
 const output=attachDecorToWall(wall,panel,{fit:true});
 assert.equal(output.decor.parent,wall);
 assert.equal(scene.children.length,1);
 assert.equal(panel.userData.qdqrAttachedDecor,true);
 assert.equal(panel.material.map.isTexture,true);
 const panelBox=new THREE.Box3().setFromObject(panel);
 const wallBox=new THREE.Box3().setFromObject(wall);
 assert.ok(Math.abs(panelBox.max.x-panelBox.min.x-3)<1e-4);
 assert.ok(Math.abs(panelBox.max.y-panelBox.min.y-2)<1e-4);
 assert.ok(panel.position.z>.125);
 const baked=bakeStaticAssembly(wall,{merge:false});
 assert.equal(baked.children.length,2);
 assert.ok(baked.children.some(c=>c.material?.map?.isTexture));
 assert.equal(baked.userData.qdqrBakedModule,true);
});

test('cannot attach an object to itself or its descendants',()=>{
 const wall=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
 assert.throws(()=>attachDecorToWall(wall,wall),/отдельно/);
});

test('reject nonimage input instead of creating empty mesh',()=>{
 const wall=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());
 assert.throws(()=>projectTextureToWall(wall,{}),/изображение/);
});


function uvArea(uv,index){
 const u1=uv.getX(index),v1=uv.getY(index);
 const u2=uv.getX(index+1),v2=uv.getY(index+1);
 const u3=uv.getX(index+2),v3=uv.getY(index+2);
 return Math.abs((u2-u1)*(v3-v1)-(u3-u1)*(v2-v1))*.5;
}
function assertFacesUnfolded(node){
 let count=0;
 node.traverse(obj=>{
   if(!obj.isMesh||!obj.geometry)return;
   const geom=obj.geometry,pos=geom.getAttribute('position'),uv=geom.getAttribute('uv');
   assert.ok(uv,'missing UV');
   assert.equal(pos.count,uv.count);
   for(let i=0;i<pos.count;i+=3){
     const a=new THREE.Vector3().fromBufferAttribute(pos,i);
     const b=new THREE.Vector3().fromBufferAttribute(pos,i+1);
     const c=new THREE.Vector3().fromBufferAttribute(pos,i+2);
     const faceArea=b.sub(a).cross(c.sub(a)).length();
     if(faceArea<1e-7)continue;
     const area=uvArea(uv,i);
     assert.ok(Number.isFinite(area)&&area>1e-8,
       'Collapsed texture triangle in '+obj.name+' at '+i+': '+area);
     count++;
   }
 });
 assert.ok(count>0);
}
test('texture maps floor BOTH top and underside without thin brush strokes',()=>{
 const group=createConstruction('floor',new THREE.MeshStandardMaterial());
 const size=new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
 const original=group.children[0].geometry;
 const out=projectTextureToModule(group,image(),{mode:'stretch'});
 assert.equal(out.meshes,1);
 assertFacesUnfolded(group);
 assert.equal(group.children[0].material.map.isTexture,true);
 assert.notEqual(group.children[0].geometry,original);
 const afterwards=new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
 assert.ok(size.distanceTo(afterwards)<1e-5,'Module geometry resized!');
});
test('rounded corner UV uses angular arc length on curved faces, not flat XY',()=>{
 const arc=createConstruction('corner',new THREE.MeshStandardMaterial());
 projectTextureToModule(arc,image(),{mode:'tile',tileMeters:1});
 assertFacesUnfolded(arc);
 const g=arc.children[0].geometry;
 const pos=g.getAttribute('position'),uv=g.getAttribute('uv');
 let checked=0;
 for(let i=0;i<pos.count;i+=3){
   const a=new THREE.Vector3().fromBufferAttribute(pos,i);
   const b=new THREE.Vector3().fromBufferAttribute(pos,i+1);
   const c=new THREE.Vector3().fromBufferAttribute(pos,i+2);
   const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
   if(Math.abs(n.y)>.45)continue;
   const phi=[a,b,c].map(p=>Math.atan2(-p.z,p.x+1.125));
   if(Math.max(...phi)-Math.min(...phi)<.002)continue; // radial endcaps
   const u=[uv.getX(i),uv.getX(i+1),uv.getX(i+2)];
   for(let k=0;k<3;k++)assert.ok(Math.abs(u[k]-phi[k]*1.125)<.0001);
   checked++;
 }
 assert.ok(checked>10,'Expected curved outer and inner wall triangles');
});
test('roof receives complete UV coordinates on sloped faces and side caps',()=>{
 const roof=createConstruction('roof',new THREE.MeshStandardMaterial());
 projectTextureToModule(roof,image(),{mode:'tile',tileMeters:1.25});
 assertFacesUnfolded(roof);
 for(const slab of roof.children)assert.equal(slab.material.map.isTexture,true);
});
test('selected mixed modules preserve all meshes and assign UV by each face',()=>{
 const group=new THREE.Group();
 group.add(createConstruction('wall',new THREE.MeshStandardMaterial()));
 const floor=createConstruction('floor',new THREE.MeshStandardMaterial());
 floor.position.set(2,0,0);group.add(floor);
 const roof=createConstruction('roof',new THREE.MeshStandardMaterial());
 roof.position.set(0,2.5,0);group.add(roof);
 const oldBox=new THREE.Box3().setFromObject(group);
 const before=group.children.map(x=>x.position.clone());
 const result=projectTextureToModule(group,image(),{mode:'tile',tileMeters:2});
 assert.ok(result.meshes>=4);
 assertFacesUnfolded(group);
 assert.ok(new THREE.Box3().setFromObject(group).equals(oldBox));
 for(let i=0;i<group.children.length;i++)assert.ok(group.children[i].position.equals(before[i]));
});
test('texture is limited to construction, not existing attached decorative overlays',()=>{
 const wall=createConstruction('wall',new THREE.MeshStandardMaterial());
 const overlay=new THREE.Mesh(new THREE.PlaneGeometry(.8,.7),
   new THREE.MeshStandardMaterial({color:0xff0000}));
 overlay.userData.qdqrAttachedDecor=true;wall.add(overlay);
 const glass=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
   new THREE.MeshStandardMaterial({color:0x11bbcc}));
 glass.userData.qdqrGlassPane=true;wall.add(glass);
 projectTextureToModule(wall,image(),{mode:'stretch'});
 assert.equal(overlay.material.map,null);
 assert.equal(glass.material.map,null);
 assert.ok(wall.children[0].material.map);
});
test('UV projection does not alter source geometry when adding texture to a group',()=>{
 const mat=new THREE.MeshStandardMaterial();
 const slab=createConstruction('floor',mat);
 const old=slab.children[0].geometry;
 const originalX=old.getAttribute('position').array.slice();
 projectTextureToModule(slab,image());
 assert.deepEqual(Array.from(old.getAttribute('position').array),Array.from(originalX));
 assert.notEqual(slab.children[0].geometry,old);
});

test('a reimported baked GLB rounded corner is recognized from its shape and name',()=>{
 // The user's GLB export drops qdqrBuildType metadata. The new import path
 // must identify a 90-degree curved ring even after the entire mesh is shifted.
 const original=createConstruction('corner',new THREE.MeshStandardMaterial());
 const baked=new THREE.Group();
 baked.name='Модуль · corner · игровой модуль';
 const clone=original.children[0].clone();
 clone.name='Закруглённый угол 90°';
 clone.geometry=clone.geometry.clone();
 clone.geometry.translate(4.7,0,-2.1);
 baked.add(clone);
 projectTextureToModule(baked,image(),{mode:'tile',tileMeters:1});
 assertFacesUnfolded(baked);
 const geom=clone.geometry,p=geom.getAttribute('position'),uv=geom.getAttribute('uv');
 // On a sidewall, UV-U must have the same change as true arc length.
 let curved=0;
 for(let i=0;i<p.count;i+=3){
   const a=new THREE.Vector3().fromBufferAttribute(p,i);
   const b=new THREE.Vector3().fromBufferAttribute(p,i+1);
   const c=new THREE.Vector3().fromBufferAttribute(p,i+2);
   const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
   if(Math.abs(n.y)>.5)continue;
   const phi=[a,b,c].map(q=>Math.atan2(-(q.z+2.1),q.x-(4.7-1.125)));
   if(Math.max(...phi)-Math.min(...phi)<.002)continue;
   const deltaUV=uv.getX(i+1)-uv.getX(i);
   const deltaArc=(phi[1]-phi[0])*1.125;
   assert.ok(Math.abs(deltaUV-deltaArc)<.001,
     'Baked corner must map texture along curve, not stretch planar XY');
   curved++;
 }
 assert.ok(curved>10);
});
