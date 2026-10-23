import * as THREE from 'three';

function staticMeshList(node,{skipDecor=true}={}){
  if(!node?.isObject3D)throw new Error('Выбери стену или группу стен');
  const found=[];
  node.traverse(o=>{
    if(!o.isMesh)return;
    if(o.isSkinnedMesh)throw new Error('Текстуры стен нельзя применять к скелетной модели');
    if(skipDecor){
      for(let p=o;p;p=p.parent){
        if(p.userData?.qdqrAttachedDecor)return;
        if(p===node)break;
      }
    }
    if(!o.geometry?.getAttribute('position'))return;
    found.push(o);
  });
  if(!found.length)throw new Error('В выбранном объекте нет сетки стены');
  return found;
}

// Bounding box of mesh geometry in a parent object's local coordinate system,
// independent of parent translation/rotation and child transforms.
export function localGeometryBounds(parent,{skipDecor=true}={}){
  parent.updateWorldMatrix(true,true);
  const inverse=parent.matrixWorld.clone().invert();
  const bounds=new THREE.Box3().makeEmpty();
  const corners=new THREE.Vector3();
  for(const mesh of staticMeshList(parent,{skipDecor})){
    mesh.updateWorldMatrix(true,false);
    const attr=mesh.geometry.getAttribute('position');
    const toLocal=inverse.clone().multiply(mesh.matrixWorld);
    for(let i=0;i<attr.count;i++){
      corners.fromBufferAttribute(attr,i).applyMatrix4(toLocal);
      bounds.expandByPoint(corners);
    }
  }
  if(bounds.isEmpty())throw new Error('Нет геометрии для вычисления размеров');
  return bounds;
}

export function projectTextureToWall(target,texture,{mode='stretch',tileMeters=1}={}){
  if(!texture?.isTexture)throw new Error('Файл не распознан как изображение');
  if(!['stretch','tile'].includes(mode))throw new Error('Неизвестный режим текстуры');
  if(!(tileMeters>0))throw new Error('Неверный размер повторения текстуры');
  const bounds=localGeometryBounds(target);
  const width=Math.max(bounds.max.x-bounds.min.x,1e-5);
  const height=Math.max(bounds.max.y-bounds.min.y,1e-5);
  const origin=target.matrixWorld.clone().invert();
  const meshes=staticMeshList(target);
  const changes=[];
  let total=0;
  for(const mesh of meshes){
    const geometry=mesh.geometry;
    const estimated=Math.floor((geometry.index?geometry.index.count:geometry.getAttribute('position').count)/3);
    total+=estimated;
    if(total>450000)throw new Error('Для текстурирования огромной сцены разделите её на более мелкие стены');
    // Clone to keep unselected/imported originals independent.
    const copy=geometry.index?geometry.toNonIndexed():geometry.clone();
    const position=copy.getAttribute('position');
    const uv=new Float32Array(position.count*2);
    const transform=origin.clone().multiply(mesh.matrixWorld);
    const local=new THREE.Vector3();
    for(let i=0;i<position.count;i++){
      local.fromBufferAttribute(position,i).applyMatrix4(transform);
      // One image covers the whole facade across all meshes. UVs are baked in
      // mesh geometry and will travel with the module when it is moved later.
      const u=(local.x-bounds.min.x)/(mode==='tile'?tileMeters:width);
      const v=(local.y-bounds.min.y)/(mode==='tile'?tileMeters:height);
      uv[i*2]=u;uv[i*2+1]=v;
    }
    copy.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    const sourceMaterials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    const newMaterials=sourceMaterials.map(old=>{
      const mat=old?.clone?.()||new THREE.MeshStandardMaterial();
      mat.map=texture;
      // Do not tint the stone image by the old wall's beige/base color.
      if(mat.color)mat.color.set(0xffffff);
      if('metalness' in mat)mat.metalness=0;
      if('roughness' in mat)mat.roughness=.85;
      mat.side=THREE.DoubleSide;
      mat.needsUpdate=true;
      return mat;
    });
    changes.push({mesh,geometry:copy,material:Array.isArray(mesh.material)?newMaterials:newMaterials[0]});
  }
  for(const change of changes){
    change.mesh.geometry=change.geometry;
    change.mesh.material=change.material;
    change.mesh.userData.qdqrSurfaceTextured=true;
  }
  target.userData.qdqrSurfaceTextured=true;
  target.userData.qdqrTextureMode=mode;
  target.userData.qdqrTextureWidthMeters=width;
  target.userData.qdqrTextureHeightMeters=height;
  return {meshes:changes.length,width,height,triangles:total};
}

// Attach an existing textured mesh (for example the separate stone plane
// observed in the user's screen recording) to the wall with one-click fit.
// The two objects remain editable children but save as ONE selected GLB module.
function boundsRelativeTo(reference,object){
  reference.updateWorldMatrix(true,true);object.updateWorldMatrix(true,true);
  const inv=reference.matrixWorld.clone().invert();
  const box=new THREE.Box3().makeEmpty();
  const v=new THREE.Vector3();
  object.traverse(m=>{
    if(!m.isMesh || !m.geometry?.getAttribute('position'))return;
    const positions=m.geometry.getAttribute('position');
    const matrix=inv.clone().multiply(m.matrixWorld);
    for(let i=0;i<positions.count;i++){
      box.expandByPoint(v.fromBufferAttribute(positions,i).applyMatrix4(matrix));
    }
  });
  return box;
}

export function attachDecorToWall(wall,decor,{fit=true,gap=.012}={}){
  if(!wall?.isObject3D||!decor?.isObject3D||wall===decor)
    throw new Error('Нужно выбрать отдельно стену и изображение');
  if(!staticMeshList(decor,{skipDecor:false}).length)throw new Error('В декоре нет меша');
  for(let p=wall;p;p=p.parent)if(p===decor)
    throw new Error('Нельзя прикрепить родительский набор внутрь своей детали');
  const base=localGeometryBounds(wall);
  const w=base.max.x-base.min.x,h=base.max.y-base.min.y;
  if(w<1e-5||h<1e-5)throw new Error('Стена должна иметь ширину и высоту');
  const oldParent=decor.parent;
  wall.updateWorldMatrix(true,true);
  wall.attach(decor);
  if(fit){
    // Imported image/stone panel becomes wall-local rather than world oriented.
    decor.position.set(0,0,0);decor.quaternion.identity();
    const decorBox=boundsRelativeTo(wall,decor);
    const dw=Math.max(1e-5,decorBox.max.x-decorBox.min.x);
    const dh=Math.max(1e-5,decorBox.max.y-decorBox.min.y);
    decor.scale.x*=w/dw;
    decor.scale.y*=h/dh;
    decor.updateWorldMatrix(true,true);
    const updated=boundsRelativeTo(wall,decor);
    // Overlay's nearest face sits just past the wall front (+Z).
    decor.position.x+=(base.min.x+base.max.x-updated.min.x-updated.max.x)/2;
    decor.position.y+=(base.min.y+base.max.y-updated.min.y-updated.max.y)/2;
    decor.position.z+=base.max.z-updated.min.z+gap;
  }
  decor.userData.qdqrAttachedDecor=true;
  decor.userData.qdqrAttachedWallName=wall.name||'Стена';
  wall.userData.qdqrContainsDecor=true;
  return {wall,decor,oldParent};
}
