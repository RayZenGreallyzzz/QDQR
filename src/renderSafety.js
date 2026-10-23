import * as THREE from 'three';

// A scene that approaches these limits on a 4GB Android tablet can cause the
// GPU driver to drop the WebGL context without a JavaScript exception.
export const ANDROID_LIMITS={softTriangles:450000,hardTriangles:850000,textureSide:1024};
export function measureScene(object){
  let triangles=0,meshes=0,texturePixels=0;
  const textures=new Set();
  object?.traverse(o=>{
    if(!o.isMesh)return;
    meshes++;
    const g=o.geometry,p=g?.getAttribute('position');
    if(p)triangles+=Math.floor((g.index?.count??p.count)/3);
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const mat of mats)if(mat)for(const value of Object.values(mat)){
      if(!value?.isTexture||textures.has(value))continue;
      textures.add(value);
      const image=value.image||value.source?.data;
      if(image?.width&&image?.height)texturePixels+=image.width*image.height;
    }
  });
  return {triangles,meshes,textures:textures.size,texturePixels};
}
export function validateSceneBounds(object){
  if(!object)throw new Error('Нет модели');
  const box=new THREE.Box3().setFromObject(object);
  if(box.isEmpty())throw new Error('В файле нет геометрии');
  const size=box.getSize(new THREE.Vector3());
  for(const v of [...box.min,...box.max,...size]){
    if(!Number.isFinite(v))throw new Error('Повреждены координаты модели (NaN или Infinity)');
  }
  if(size.length()>100000)throw new Error('Модель слишком большая по координатам');
  return {box,size,center:box.getCenter(new THREE.Vector3())};
}
export function mobileSceneBudget(previous,incoming,limits=ANDROID_LIMITS){
  const total=previous.triangles+incoming.triangles;
  return {
    total,
    hardLimitExceeded:total>limits.hardTriangles,
    softLimitExceeded:total>limits.softTriangles,
    // The projected decoded texture memory is far larger than glb file bytes.
    approximateTextureMiB:(previous.texturePixels+incoming.texturePixels)*4/1048576
  };
}
// Resize only large textures and only on memory-constrained devices.
// Material maps, color space, transforms and UV coordinates are preserved.
export function reduceImportedTextureFootprint(object,{maxSide=1024}={}){
  if(typeof document==='undefined')return {resized:0};
  const seen=new Set();let resized=0;
  object.traverse(o=>{
    if(!o.isMesh)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const mat of mats)if(mat)for(const value of Object.values(mat)){
      if(!value?.isTexture||seen.has(value))continue;
      seen.add(value);
      const image=value.image||value.source?.data;
      if(!image?.width||!image?.height||Math.max(image.width,image.height)<=maxSide)continue;
      const k=Math.min(1,maxSide/Math.max(image.width,image.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.width*k));
      canvas.height=Math.max(1,Math.round(image.height*k));
      const context=canvas.getContext('2d');
      if(!context)continue;
      try{
        context.drawImage(image,0,0,canvas.width,canvas.height);
        value.image=canvas;value.needsUpdate=true;resized++;
      }catch(e){console.warn('Texture resize skipped',e);}
    }
  });
  return {resized};
}
