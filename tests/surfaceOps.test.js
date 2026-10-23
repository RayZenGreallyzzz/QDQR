import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {projectTextureToWall,attachDecorToWall,localGeometryBounds} from '../src/surfaceOps.js';
import {bakeStaticAssembly} from '../src/assemblyOps.js';

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
 let maxA=-Infinity,minB=Infinity;
 for(let i=0;i<a.count;i++)maxA=Math.max(maxA,a.getX(i));
 for(let i=0;i<b.count;i++)minB=Math.min(minB,b.getX(i));
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
