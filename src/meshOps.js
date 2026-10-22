
import * as THREE from 'three';

// Geometry editing uses non-indexed triangles. It deliberately leaves cut surfaces open;
// we never call a destructive operation a watertight boolean.
export function toTriangles(geometry) {
  return geometry.index ? geometry.toNonIndexed() : geometry.clone();
}
export function filterFaces(geometry, predicate) {
  const src = toTriangles(geometry);
  const pos = src.getAttribute('position');
  if (!pos) throw new Error('Mesh does not contain positions');
  const kept = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < pos.count / 3; f++) {
    a.fromBufferAttribute(pos, f * 3);
    b.fromBufferAttribute(pos, f * 3 + 1);
    c.fromBufferAttribute(pos, f * 3 + 2);
    if (predicate(a, b, c, f)) kept.push(f);
  }
  const dst = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    // Preserve texture UVs, colors, normals, skin attributes, etc.
    if (attr.isInterleavedBufferAttribute) throw new Error('Interleaved geometry not supported for this tool');
    const Typed = attr.array.constructor;
    const values = new Typed(kept.length * 3 * attr.itemSize);
    let out = 0;
    for (const f of kept) {
      const start = f * 3 * attr.itemSize;
      values.set(attr.array.subarray(start, start + attr.itemSize * 3), out);
      out += attr.itemSize * 3;
    }
    dst.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize, attr.normalized));
  }
  if (dst.getAttribute('position')?.count) dst.computeVertexNormals();
  dst.computeBoundingBox();
  dst.computeBoundingSphere();
  src.dispose();
  return { geometry: dst, before: Math.floor(pos.count / 3), after: kept.length };
}
export function cleanDegenerate(geometry) {
  return filterFaces(geometry, (a,b,c) => {
    const ab = new THREE.Vector3().subVectors(b,a);
    const ac = new THREE.Vector3().subVectors(c,a);
    return ab.cross(ac).lengthSq() > 1e-14;
  });
}
export function cropGeometry(geometry, axis, threshold, side) {
  return filterFaces(geometry, (a,b,c) => {
    const centroid = (a[axis] + b[axis] + c[axis]) / 3;
    return side === 'above' ? centroid <= threshold : centroid >= threshold;
  });
}
export function removeSmallIslands(geometry, minFaces = 30) {
  const src = toTriangles(geometry), pos = src.getAttribute('position');
  const faces = Math.floor((pos?.count || 0) / 3);
  if (faces > 110000) { src.dispose(); throw new Error('Слишком плотная сетка (>110 тыс. треугольников). Разделите её на части.'); }
  if (!faces) { src.dispose(); throw new Error('Нет треугольников'); }
  const parent = new Int32Array(faces), rank = new Uint8Array(faces);
  for (let i=0;i<faces;i++) parent[i]=i;
  function find(x) { while(parent[x]!==x) { parent[x]=parent[parent[x]];x=parent[x]; } return x; }
  function union(a,b) { a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++; }
  const owner = new Map(), epsilon=1e-4;
  for(let face=0;face<faces;face++){
    for(let k=0;k<3;k++) {
      const ix=face*3+k;
      const key = Math.round(pos.getX(ix)/epsilon)+','+Math.round(pos.getY(ix)/epsilon)+','+Math.round(pos.getZ(ix)/epsilon);
      if(owner.has(key)) union(face,owner.get(key)); else owner.set(key,face);
    }
  }
  const counts = new Map();
  for(let f=0;f<faces;f++){const r=find(f);counts.set(r,(counts.get(r)||0)+1);}
  const big = [...counts.values()].some(n=>n>=minFaces);
  const largest = Math.max(...counts.values());
  const mask = new Uint8Array(faces);
  for(let f=0;f<faces;f++)mask[f] = big ? Number(counts.get(find(f))>=minFaces) : Number(counts.get(find(f))===largest);
  src.dispose();
  let islandsRemoved = 0;
  for(const n of counts.values()) if(n < minFaces)islandsRemoved++;
  const result=filterFaces(geometry, (a,b,c,face)=>mask[face]===1);
  return { ...result, islandsRemoved, totalIslands: counts.size };
}
export function bendGeometry(geometry, degrees) {
  const g=toTriangles(geometry), p=g.getAttribute('position');
  g.computeBoundingBox();
  const bb=g.boundingBox;
  const width=Math.max(0.001,bb.max.x-bb.min.x);
  const theta=THREE.MathUtils.degToRad(degrees);
  if(Math.abs(theta) < 0.0001) return g;
  const radius=width/theta, cx=(bb.max.x+bb.min.x)/2;
  const x0=cx;
  for(let i=0;i<p.count;i++){
    const ox=p.getX(i)-cx, oz=p.getZ(i);
    const angle=ox/radius;
    const px = radius*Math.sin(angle) + oz*Math.sin(angle);
    const pz = radius*(1-Math.cos(angle)) + oz*Math.cos(angle);
    p.setXYZ(i, px+x0,p.getY(i),pz);
  }
  p.needsUpdate=true;
  g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
  return g;
}
export function countTriangles(root) {
  let triangles=0, meshes=0;
  root.traverse(o=>{
    if(!o.isMesh) return;
    meshes++;
    const g=o.geometry;
    if(g){triangles += Math.floor((g.index ? g.index.count : (g.getAttribute('position')?.count || 0))/3);}
  });
  return {triangles,meshes};
}
export function createConstruction(type, material){
  const group=new THREE.Group();group.name='Модуль · '+type;
  const box=(n,w,h,d,x=0,y=0,z=0)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material.clone());
    m.name=n;m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;
  };
  switch(type){
    case 'wall': box('Стена',3,2.6,.25,0,1.3); break;
    case 'floor': box('Пол',3,.18,3,0,.09); break;
    case 'corner': {
      // Quarter curved wall: ring-sector footprint extruded to height.
      const inner=1.0,outer=1.25,s=new THREE.Shape();
      for(let i=0;i<=24;i++){const a=(Math.PI/2)*i/24; const x=outer*Math.cos(a),y=outer*Math.sin(a);if(i===0)s.moveTo(x,y);else s.lineTo(x,y);}
      for(let i=24;i>=0;i--){const a=(Math.PI/2)*i/24;s.lineTo(inner*Math.cos(a),inner*Math.sin(a));}
      s.closePath();
      const g=new THREE.ExtrudeGeometry(s,{depth:2.6,bevelEnabled:false,curveSegments:24,steps:1});
      g.rotateX(-Math.PI/2);
      // after rotation extrusion z becomes +y
      g.computeVertexNormals();
      const m=new THREE.Mesh(g,material.clone());m.name='Закруглённый угол 90°';m.castShadow=true;m.receiveShadow=true;group.add(m);
      break;
    }
    case 'window':box('Низ под окном',3,1.05,.25,0,.525);box('Верх над окном',3,.65,.25,0,2.275);box('Левая часть',.8,.9,.25,-1.1,1.5);box('Правая часть',.8,.9,.25,1.1,1.5);break;
    case 'door':box('Стена слева',.9,2.6,.25,-1.05,1.3);box('Стена справа',.9,2.6,.25,1.05,1.3);box('Перемычка',1.2,.55,.25,0,2.325);break;
    case 'column':{const m=new THREE.Mesh(new THREE.CylinderGeometry(.28,.33,2.7,16),material.clone());m.name='Колонна';m.position.y=1.35;group.add(m);box('База',.85,.19,.85,0,.095);box('Капитель',.8,.19,.8,0,2.8);break;}
    case 'roof':{const m=box('Скат А',2.2,.16,3,-.8,2,0);m.rotation.z=Math.PI/5;const n=box('Скат Б',2.2,.16,3,.8,2,0);n.rotation.z=-Math.PI/5;break;}
    case 'arch':box('Левая колонна',.45,2.6,.5,-1.2,1.3);box('Правая колонна',.45,2.6,.5,1.2,1.3);box('Верхняя балка',2.85,.45,.5,0,2.8);break;
  }
  return group;
}


// Separate large atlas-like meshes by true topological connected components.
// A component is not guaranteed to correspond to a complete semantic object:
// desks, chests or characters may each consist of many separate pieces.
export function splitGeometryIslands(geometry,{maxParts=80,minFaces=5}={}) {
  const pos=geometry.getAttribute('position');
  if(!pos)throw new Error('Нет вершин');
  if(Object.keys(geometry.morphAttributes||{}).length)throw new Error('Сначала удалите морф-цели');
  const idx=geometry.index,faceCount=Math.floor((idx?idx.count:pos.count)/3);
  if(faceCount>550000)throw new Error('Слишком тяжёлая сетка (>550 тыс. трис).');
  if(!faceCount)throw new Error('Пустая сетка');
  const parents=new Int32Array(faceCount),rank=new Uint8Array(faceCount);
  for(let i=0;i<faceCount;i++)parents[i]=i;
  const find=x=>{while(parents[x]!==x){parents[x]=parents[parents[x]];x=parents[x];}return x;};
  const union=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(rank[a]<rank[b])[a,b]=[b,a];parents[b]=a;if(rank[a]===rank[b])rank[a]++;};
  const owners=idx?new Int32Array(pos.count).fill(-1):new Map();
  const getVertex=fk=>idx?idx.getX(fk):fk;
  const eps=0.00005;
  for(let face=0;face<faceCount;face++){
    for(let k=0;k<3;k++){
      const vi=getVertex(face*3+k);
      if(idx){
        const previous=owners[vi];
        if(previous<0)owners[vi]=face;else union(face,previous);
      } else {
        const key=Math.round(pos.getX(vi)/eps)+','+Math.round(pos.getY(vi)/eps)+','+Math.round(pos.getZ(vi)/eps);
        const previous=owners.get(key);
        if(previous===undefined)owners.set(key,face);else union(face,previous);
      }
    }
  }
  const components=new Map();
  for(let face=0;face<faceCount;face++){
    const r=find(face);
    if(!components.has(r))components.set(r,[]);
    components.get(r).push(face);
  }
  const sorted=[...components.values()].sort((a,b)=>b.length-a.length);
  // Small isolated components stay in the "Other fragments" mesh; no geometry
  // is thrown away by the split action.
  const chosen=sorted.filter(a=>a.length>=minFaces).slice(0,maxParts);
  const remainder=sorted.slice();
  const chosenSet=new Set(chosen);
  const rest=remainder.filter(a=>!chosenSet.has(a)).flat();
  const faceSets=chosen.slice();
  if(rest.length)faceSets.push(rest);
  const parts=[];
  for(let i=0;i<faceSets.length;i++){
    const faceIds=faceSets[i];
    const output=new THREE.BufferGeometry();
    for(const [name,attr] of Object.entries(geometry.attributes)){
      if(attr.isInterleavedBufferAttribute)throw new Error('Interleaved buffer unsupported');
      const Typed=attr.array.constructor;
      const data=new Typed(faceIds.length*3*attr.itemSize);
      let cursor=0;
      for(const face of faceIds)for(let k=0;k<3;k++){
        const vi=getVertex(face*3+k);
        for(let j=0;j<attr.itemSize;j++)data[cursor++]=attr.getComponent(vi,j);
      }
      output.setAttribute(name,new THREE.BufferAttribute(data,attr.itemSize,attr.normalized));
    }
    output.computeBoundingBox();output.computeBoundingSphere();
    const isRemainder=i>=chosen.length;
    parts.push({geometry:output,faces:faceIds.length,name:isRemainder?'Прочие мелкие фрагменты':'Фрагмент '+(i+1)});
  }
  return {parts,totalIslands:sorted.length,faceCount};
}
