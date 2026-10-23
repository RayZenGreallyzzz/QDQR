import * as THREE from 'three';

/**
 * Bake editable static components into a Godot-friendly group whose pivot sits
 * at the bottom center. Source geometry, materials, and object transforms are
 * never mutated. This does NOT bake texture atlases/lightmaps.
 */
export function bakeStaticAssembly(source,{merge=true,pivot='bottom-center',maxTriangles=240000}={}){
  if(!source?.isObject3D)throw new Error('Не выбрана конструкция');
  source.updateWorldMatrix(true,true);
  // Bake the current world-space appearance, including the top-level group's
  // scale and rotation, into the exported vertices.
  const inverse=new THREE.Matrix4();
  const baked=[];
  let triangles=0;
  source.traverse(obj=>{
    if(obj.isSkinnedMesh)throw new Error('Скелетные модели нельзя запечь как статическую конструкцию');
    if(!obj.isMesh)return;
    let visible=true;for(let p=obj;p;p=p.parent){if(!p.visible){visible=false;break;}}
    if(!visible)return;
    if(!obj.geometry?.getAttribute('position'))throw new Error('В одном из объектов нет вершин');
    if(Object.keys(obj.geometry.morphAttributes||{}).length)throw new Error('Морф-цели не поддерживаются для модульного запекания');
    const src=obj.geometry;
    const nonIndexed=src.index ? src.toNonIndexed() : src.clone();
    const relative=inverse.clone().multiply(obj.matrixWorld);
    nonIndexed.applyMatrix4(relative);
    const mats=(Array.isArray(obj.material)?obj.material:[obj.material]);
    if(mats.some(m=>!m))throw new Error('Отсутствует материал');
    triangles+=Math.floor(nonIndexed.getAttribute('position').count/3);
    if(triangles>maxTriangles){nonIndexed.dispose();throw new Error('Сборка слишком тяжёлая для безопасного запекания на планшете. Упростите её.');}
    baked.push({name:obj.name||'Деталь',geometry:nonIndexed,materials:mats});
  });
  if(!baked.length)throw new Error('В сборке нет видимой статической геометрии');
  const bbox=new THREE.Box3().makeEmpty();
  for(const item of baked){item.geometry.computeBoundingBox();bbox.union(item.geometry.boundingBox);}
  const center=bbox.getCenter(new THREE.Vector3());
  const pivotPoint=pivot==='origin' ? new THREE.Vector3() : new THREE.Vector3(center.x,bbox.min.y,center.z);
  for(const item of baked)item.geometry.translate(-pivotPoint.x,-pivotPoint.y,-pivotPoint.z);
  const output=new THREE.Group();
  output.name=(source.name||'Конструкция')+' · игровой модуль';
  output.userData={qdqrBakedModule:true,bakeType:'static-geometry-only',pivot,sourceParts:baked.length};
  let actuallyMerged=false;

  // A single BufferGeometry may have many material groups, so this retains
  // separate material texture maps without creating an atlas.
  const signature=g=>Object.entries(g.attributes).map(([k,a])=>[k,a.itemSize,a.normalized,a.array.constructor.name].join(':')).sort().join('|');
  const sameFormat=baked.every(i=>signature(i.geometry)===signature(baked[0].geometry));
  const fullyMerge=Boolean(merge && sameFormat);
  if(fullyMerge){
    const first=baked[0].geometry;
    const totalVerts=baked.reduce((sum,item)=>sum+item.geometry.getAttribute('position').count,0);
    const merged=new THREE.BufferGeometry();
    for(const [key,attr] of Object.entries(first.attributes)){
      const Typed=attr.array.constructor;
      const values=new Typed(totalVerts*attr.itemSize);
      let offset=0;
      for(const item of baked){
        const part=item.geometry.getAttribute(key);
        if(!part || part.isInterleavedBufferAttribute)throw new Error('Несовместимые вершинные атрибуты');
        values.set(part.array,offset);offset+=part.array.length;
      }
      merged.setAttribute(key,new THREE.BufferAttribute(values,attr.itemSize,attr.normalized));
    }
    const materials=[];
    let offset=0;
    for(const part of baked){
      // Groups refer to non-indexed vertex ranges after toNonIndexed().
      const groups=part.geometry.groups?.length ? part.geometry.groups :
        [{start:0,count:part.geometry.getAttribute('position').count,materialIndex:0}];
      const materialOffset=materials.length;
      for(const m of part.materials)materials.push(m.clone());
      for(const g of groups)merged.addGroup(offset+g.start,g.count,materialOffset+g.materialIndex);
      offset+=part.geometry.getAttribute('position').count;
    }
    merged.computeBoundingBox();merged.computeBoundingSphere();
    const m=new THREE.Mesh(merged,materials);
    m.name='Объединённая геометрия';m.castShadow=true;m.receiveShadow=true;
    output.add(m);actuallyMerged=true;
    baked.forEach(b=>b.geometry.dispose());
  }else{
    for(const part of baked){
      const materials=part.materials.map(m=>m.clone());
      const m=new THREE.Mesh(part.geometry,materials.length===1?materials[0]:materials);
      m.name=part.name;m.castShadow=true;m.receiveShadow=true;output.add(m);
    }
  }
  output.userData.merged=actuallyMerged;
  output.userData.triangles=triangles;
  output.userData.originalMaterials=baked.reduce((a,b)=>a+b.materials.length,0);
  return output;
}
