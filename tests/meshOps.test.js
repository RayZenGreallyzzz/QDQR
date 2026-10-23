import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cleanDegenerate,cropGeometry,removeSmallIslands,bendGeometry,splitGeometryIslands,countTriangles,createConstruction} from '../src/meshOps.js';

function geometry(points) {
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  return g;
}
test('remove degenerate faces without modifying input',()=>{
  const g=geometry([0,0,0, 1,0,0, 0,1,0, 4,0,0, 4,0,0, 4,0,0]);
  const out=cleanDegenerate(g);
  assert.equal(out.before,2);assert.equal(out.after,1);
  assert.equal(g.getAttribute('position').count,6);
});
test('cut keeps only faces below threshold',()=>{
  const g=geometry([0,0,0, 1,0,0, 0,1,0, 0,2,0, 1,2,0, 0,3,0]);
  const result=cropGeometry(g,'y',1,'above');
  assert.equal(result.after,1);
});
test('clean small disconnected islands',()=>{
  const g=geometry([
     0,0,0, 1,0,0, 0,1,0,
     1,0,0, 1,1,0, 0,1,0,
     9,0,0, 10,0,0, 9,1,0
  ]);
  const result=removeSmallIslands(g,2);
  assert.equal(result.totalIslands,2);
  assert.equal(result.after,2);
});
test('bend modifies geometry in a predictable way',()=>{
  const g=new THREE.BoxGeometry(3,2,.2);
  const b=bendGeometry(g,45);
  assert.equal(b.getAttribute('position').count,36);
  assert.ok(b.boundingBox.max.z!==g.boundingBox?.max.z);
});
test('all construction presets generate meshes',()=>{
  for(const type of ['wall','floor','corner','window','door','column','roof','arch']){
    const o=createConstruction(type,new THREE.MeshStandardMaterial());
    assert.ok(countTriangles(o).triangles>0,type);
  }
});

test('split indexed mesh atlas into isolated pieces without losing triangles',()=>{
  const g=geometry([0,0,0, 1,0,0, 0,1,0,  10,0,0, 11,0,0, 10,1,0]);
  g.setIndex([0,1,2,3,4,5]);
  const split=splitGeometryIslands(g,{maxParts:2,minFaces:1});
  assert.equal(split.totalIslands,2);
  assert.equal(split.parts.length,2);
  assert.equal(split.parts.reduce((n,p)=>n+p.faces,0),2);
});

test('preserve materials after filtering and island split',()=>{
  const g=geometry([
    0,0,0,1,0,0,0,1,0,
    1,0,0,1,1,0,0,1,0,
    9,0,0,10,0,0,9,1,0
  ]);
  g.addGroup(0,6,0);g.addGroup(6,3,1);
  const result=cleanDegenerate(g).geometry;
  assert.equal(result.groups.length,2);
  assert.deepEqual(result.groups.map(x=>x.materialIndex),[0,1]);
  const split=splitGeometryIslands(g,{minFaces:1});
  assert.equal(split.totalIslands,2);
  assert.deepEqual(split.parts.flatMap(p=>p.geometry.groups.map(x=>x.materialIndex)).sort(),[0,1]);
});
test('UV-seam duplicate positions still count as one island',()=>{
  const g=geometry([0,0,0,1,0,0,0,1,0, 1,0,0,1,1,0,0,1,0]);
  g.setIndex([0,1,2,3,4,5]);
  const x=splitGeometryIslands(g,{minFaces:1});
  assert.equal(x.totalIslands,1);
});
