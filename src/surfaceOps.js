import * as THREE from 'three';

function staticMeshList(node,{skipDecor=true}={}){
  if(!node?.isObject3D)throw new Error('Выбери стену или группу стен');
  const found=[];
  node.traverse(o=>{
    if(!o.isMesh)return;
    if(o.isSkinnedMesh)throw new Error('Текстуры стен нельзя применять к скелетной модели');
    if(skipDecor){
      for(let p=o;p;p=p.parent){
        if(p.userData?.qdqrAttachedDecor||p.userData?.qdqrGlassPane||
           p.userData?.qdqrGlassContainer||p.userData?.qdqrInstalledInOpening)return;
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

const EPS=1e-7;
function enclosingRoundedCorner(mesh,selected){
  for(let p=mesh;p;p=p.parent){
    // Metadata is preserved for stock presets. Saved/baked GLB files can
    // lose that metadata, but retain the descriptive mesh/module name.
    if(p.userData?.qdqrBuildType==='corner' ||
       /(?:\bcorner\b|закругл[её]нн?ый\s+угол)/i.test(p.name||''))return p;
    if(p===selected)break;
  }
  return null;
}
function sampleArcPoints(node){
  const points=[],matrixInv=node.matrixWorld.clone().invert();
  const point=new THREE.Vector3();
  node.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))return;
    mesh.updateWorldMatrix(true,false);
    const transform=matrixInv.clone().multiply(mesh.matrixWorld);
    const pos=mesh.geometry.getAttribute('position');
    const stride=Math.max(1,Math.ceil(pos.count/500));
    for(let i=0;i<pos.count;i+=stride){
      point.fromBufferAttribute(pos,i).applyMatrix4(transform);
      points.push([point.x,point.z]);
    }
  });
  return points;
}
function arcDescriptor(node){
  node.updateWorldMatrix(true,true);
  if(node.userData?.qdqrBuildType==='corner')
    return {inverse:node.matrixWorld.clone().invert(),centerX:-1.125,
      centerZ:0,radius:1.125,phase:0};
  const pts=sampleArcPoints(node);
  if(pts.length<20)return null;
  const minX=Math.min(...pts.map(p=>p[0])),maxX=Math.max(...pts.map(p=>p[0]));
  const minZ=Math.min(...pts.map(p=>p[1])),maxZ=Math.max(...pts.map(p=>p[1]));
  let best=null;
  for(const centerX of [minX,maxX]){
    for(const centerZ of [minZ,maxZ]){
      const rr=pts.map(p=>Math.hypot(p[0]-centerX,p[1]-centerZ))
        .sort((a,b)=>a-b);
      const inner=rr[Math.floor(rr.length*.25)],outer=rr[Math.floor(rr.length*.75)];
      if(inner<.001 || outer-inner<.001)continue;
      const score=rr.reduce((sum,r)=>sum+Math.min(Math.abs(r-inner),Math.abs(r-outer)),0) /
        (rr.length*outer);
      const angles=pts.map(p=>Math.atan2(centerZ-p[1],p[0]-centerX));
      const sumSin=angles.reduce((n,v)=>n+Math.sin(v),0),sumCos=angles.reduce((n,v)=>n+Math.cos(v),0);
      const phase=Math.atan2(sumSin,sumCos);
      const adjusted=angles.map(x=>Math.atan2(Math.sin(x-phase),Math.cos(x-phase)));
      const spread=Math.max(...adjusted)-Math.min(...adjusted);
      if(spread<.4||spread>3.2)continue;
      if(!best||score<best.score)best={score,centerX,centerZ,
        radius:(inner+outer)*.5,phase};
    }
  }
  if(!best||best.score>.05)return null;
  return {inverse:node.matrixWorld.clone().invert(),...best};
}
function curvatureData(point,corner){
  const local=point.clone().applyMatrix4(corner.inverse);
  const x=local.x-corner.centerX,z=local.z-corner.centerZ;
  const raw=Math.atan2(-z,x);
  const angle=Math.atan2(Math.sin(raw-corner.phase),Math.cos(raw-corner.phase));
  return {angle,radial:Math.hypot(x,z)};
}
/** Project a triangle to UV coordinates using the geometry's actual surface.
 *  Vertical faces get vertical coordinates; floor/ceiling use XZ, sloped roofs
 *  are measured along the slope, and rounded corners follow their arc length.
 *  No face of the object is resized or flattened to an XY painting plane.
 */
function faceCoordinates(a,b,c,{corner=null}={}){
  const normal=new THREE.Vector3().subVectors(b,a)
    .cross(new THREE.Vector3().subVectors(c,a)).normalize();
  if(normal.lengthSq()<EPS)return {kind:'xy',pairs:[a,b,c].map(p=>[p.x,p.y])};
  const pts=[a,b,c];
  if(Math.abs(normal.y)>.55){
    // XZ maps ceiling undersides and top faces identically. On sloped roofs,
    // compensate the surface distance (arc length over slope vs its shadow).
    const pitch=Math.hypot(normal.x,normal.y)>EPS
      ?Math.hypot(normal.x,normal.y)/Math.max(Math.abs(normal.y),.02):1;
    return {kind:'xz',pairs:pts.map(p=>[p.x*pitch,p.z])};
  }
  if(corner){
    const polar=pts.map(p=>curvatureData(p,corner));
    const angleRange=Math.max(...polar.map(p=>p.angle))-Math.min(...polar.map(p=>p.angle));
    const radialRange=Math.max(...polar.map(p=>p.radial))-Math.min(...polar.map(p=>p.radial));
    if(angleRange<.002 && radialRange>.001){
      return {kind:'cap',pairs:pts.map((p,i)=>[polar[i].radial,p.y])};
    }
    // One continuous U axis over the quarter circle. The original mesh can
    // have many separate side triangles, but they all use the same arc length.
    return {kind:'arc',pairs:pts.map((p,i)=>[polar[i].angle*corner.radius,p.y])};
  }
  if(Math.abs(normal.x)>Math.abs(normal.z))
    return {kind:'zy',pairs:pts.map(p=>[p.z,p.y])};
  return {kind:'xy',pairs:pts.map(p=>[p.x,p.y])};
}
function flattenFaces(node,meshes){
  const origin=node.matrixWorld.clone().invert();
  const batches=[];
  const extents=new Map();
  let triangles=0;
  for(const mesh of meshes){
    const input=mesh.geometry;
    const total=Math.floor((input.index?input.index.count:input.getAttribute('position').count)/3);
    triangles+=total;
    if(triangles>450000)throw new Error('Слишком много треугольников: выбери меньшую часть конструкции');
    const copy=input.index?input.toNonIndexed():input.clone();
    const position=copy.getAttribute('position');
    const toNode=origin.clone().multiply(mesh.matrixWorld);
    const cornerObject=enclosingRoundedCorner(mesh,node);
    const corner=cornerObject?arcDescriptor(cornerObject):null;
    // Projection points and positions are in the same local space as node.
    // The corner's ring is measured in the corner's own local coordinates.
    const trianglesUV=[];
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    // Never create a Vector3 per vertex: on a low-memory Android tablet a
    // million vectors would make an otherwise affordable GLB run out of RAM.
    for(let i=0;i<position.count;i+=3){
      a.fromBufferAttribute(position,i).applyMatrix4(toNode);
      b.fromBufferAttribute(position,i+1).applyMatrix4(toNode);
      c.fromBufferAttribute(position,i+2).applyMatrix4(toNode);
      // For convex pieces the chosen plane is shared by neighboring triangles
      // with the same surface normal; for corner mesh use the arc's frame.
      let tri=faceCoordinates(a,b,c,{corner:corner?{
        inverse:corner.inverse.clone().multiply(node.matrixWorld),
        centerX:corner.centerX,centerZ:corner.centerZ,
        radius:corner.radius,phase:corner.phase
      }:null});
      trianglesUV.push(tri);
      const range=extents.get(tri.kind)||{minU:Infinity,maxU:-Infinity,minV:Infinity,maxV:-Infinity};
      for(const [u,v] of tri.pairs){
        range.minU=Math.min(range.minU,u);range.maxU=Math.max(range.maxU,u);
        range.minV=Math.min(range.minV,v);range.maxV=Math.max(range.maxV,v);
      }
      extents.set(tri.kind,range);
    }
    batches.push({mesh,copy,trianglesUV});
  }
  return {batches,extents,triangles};
}
function finalizeUV({batches,extents},{mode,tileMeters,tex}){
  const changes=[];
  for(const {mesh,copy,trianglesUV} of batches){
    const uv=new Float32Array(trianglesUV.length*6);
    let ptr=0;
    for(const face of trianglesUV){
      const r=extents.get(face.kind);
      const spanU=Math.max(.00001,r.maxU-r.minU),spanV=Math.max(.00001,r.maxV-r.minV);
      for(const [u,v] of face.pairs){
        uv[ptr++]=(u-r.minU)/(mode==='tile'?tileMeters:spanU);
        uv[ptr++]=(v-r.minV)/(mode==='tile'?tileMeters:spanV);
      }
    }
    copy.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    const original=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    const materials=original.map(old=>{
      const mat=old?.clone?.()||new THREE.MeshStandardMaterial();
      mat.map=tex;
      if(mat.color)mat.color.set(0xffffff);
      if('metalness' in mat)mat.metalness=0;
      if('roughness' in mat)mat.roughness=.85;
      mat.side=THREE.DoubleSide;
      mat.needsUpdate=true;
      return mat;
    });
    changes.push({mesh,copy,material:Array.isArray(mesh.material)?materials:materials[0]});
  }
  return changes;
}
export function projectTextureToModule(target,texture,{mode='stretch',tileMeters=1}={}){
  if(!texture?.isTexture)throw new Error('Файл не распознан как изображение');
  if(!['stretch','tile'].includes(mode))throw new Error('Неизвестный режим текстуры');
  if(!Number.isFinite(tileMeters)||tileMeters<=0)throw new Error('Неверный размер повторения текстуры');
  const bounds=localGeometryBounds(target);
  const meshes=staticMeshList(target);
  // Map every normal-oriented surface instead of forcing an XY map onto
  // horizontal floors, roof slopes and rounded corners.
  const faces=flattenFaces(target,meshes);
  const changes=finalizeUV(faces,{mode,tileMeters,tex:texture});
  // Build all UVs first; mutate existing meshes only after successful mapping.
  for(const change of changes){
    change.mesh.geometry=change.copy;
    change.mesh.material=change.material;
    change.mesh.userData.qdqrSurfaceTextured=true;
  }
  target.userData.qdqrSurfaceTextured=true;
  target.userData.qdqrTextureMode=mode;
  target.userData.qdqrTextureProjection='surface';
  const width=bounds.max.x-bounds.min.x,height=bounds.max.y-bounds.min.y;
  target.userData.qdqrTextureWidthMeters=width;
  target.userData.qdqrTextureHeightMeters=height;
  return {meshes:changes.length,width,height,triangles:faces.triangles,projection:'surface'};
}
// Keep the old public API working with existing editor callers and GLB assets.
export function projectTextureToWall(target,texture,options={}){
  return projectTextureToModule(target,texture,options);
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
