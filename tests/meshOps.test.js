import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cleanDegenerate,cropGeometry,removeSmallIslands,bendGeometry,countTriangles,createConstruction} from '../src/meshOps.js';

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
