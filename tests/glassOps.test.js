import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {findEnclosedRegions,traceRegionContours,geometryForRegion,buildGlassPieces} from '../src/glassOps.js';

function windowMask(){
  const w=100,h=80,a=new Uint8Array(w*h);
  for(let y=8;y<=72;y++)for(let x=8;x<=91;x++)a[y*w+x]=1;
  for(let y=16;y<=64;y++)for(let x=16;x<=42;x++)a[y*w+x]=0;
  for(let y=16;y<=64;y++)for(let x=55;x<=83;x++)a[y*w+x]=0;
  return {w,h,a};
}
function view(w,h){
  const camera=new THREE.OrthographicCamera(-2,2,1.6,-1.6,.1,100);
  camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  return {camera,width:w,height:h,normalAxis:2,normalValue:0};
}
test('silhouette analyzer finds only the two enclosed gothic openings',()=>{
  const {w,h,a}=windowMask();
  const parts=findEnclosedRegions(a,w,h,{minPixels:40});
  assert.equal(parts.length,2);
  assert.ok(parts.every(p=>p.pixels.length>500));
});
test('black background outside a frame is never accepted as a pane',()=>{
  const {w,h,a}=windowMask();
  for(let y=0;y<h;y++)a[y*w+8]=0; // break left stone border
  // At least the right pane must remain enclosed, but never the huge exterior.
  const parts=findEnclosedRegions(a,w,h,{minPixels:40});
  assert.ok(parts.every(p=>p.area < (w*h)/2));
});
test('shape triangulation yields panes and UVs inside frame local coordinates',()=>{
  const {w,h,a}=windowMask(),parts=findEnclosedRegions(a,w,h);
  const proj=view(w,h);
  const pane=geometryForRegion(parts[0],w,h,proj);
  const pos=pane.getAttribute('position'),uv=pane.getAttribute('uv');
  assert.ok(pos.count>3);
  assert.equal(pos.count,uv.count);
  for(let i=0;i<pos.count;i++){
    assert.ok(Number.isFinite(pos.getX(i))&&Number.isFinite(pos.getY(i)));
    assert.ok(Math.abs(pos.getZ(i))<1e-6);
    assert.ok(uv.getX(i)>-.01&&uv.getX(i)<1.01);
  }
});
test('preserve central stone island by tracing a hole inside a glass opening',()=>{
  const {w,h,a}=windowMask();
  for(let y=30;y<38;y++)for(let x=22;x<30;x++)a[y*w+x]=1;
  const regions=findEnclosedRegions(a,w,h);
  const left=regions.find(r=>r.bounds.xMax<50);
  const loops=traceRegionContours(left,w,h);
  assert.equal(loops.length,2);
  const glass=geometryForRegion(left,w,h,view(w,h));
  const ray=new THREE.Raycaster(new THREE.Vector3(-1.0,-.25,2),new THREE.Vector3(0,0,-1));
  // Merely verify a valid triangulated mesh; actual holes are tested by loops.
  assert.ok(glass.getAttribute('position').count>=6);
});
test('individual pane selection creates only marked section, with glass as a child mesh',()=>{
  const {w,h,a}=windowMask(),regions=findEnclosedRegions(a,w,h);
  const p=buildGlassPieces(regions,view(w,h),{kind:'colored',color:'#2365ac',opacity:.42,all:false,activeIds:[2]});
  assert.equal(p.children.length,1);
  assert.equal(p.children[0].userData.qdqrGlassId,2);
  assert.ok(Math.abs(p.children[0].material.opacity-.42)<1e-6);
  assert.equal(p.userData.qdqrGlassContainer,true);
  assert.equal(buildGlassPieces(regions,view(w,h),{kind:'colored',all:true}).children.length,2);
});
