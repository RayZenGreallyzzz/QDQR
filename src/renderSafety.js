import * as THREE from 'three';

const MIB=1024*1024;
const GLB_MAGIC=0x46546c67;
const GLB_JSON=0x4e4f534a;
const GLB_BIN=0x004e4942;
const COMPONENT_BYTES={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
const TYPE_COMPONENTS={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};

// Kept as a compatibility export for callers that only need the mobile texture target.
// Triangle counts are intentionally NOT hard limits anymore; memory is measured instead.
export const ANDROID_LIMITS={textureSide:1024};

function finitePositive(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>0?n:null;
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}

export function createRuntimeProfile({
  isAndroid=false,
  coarsePointer=false,
  deviceMemoryGiB=null,
  jsHeapLimitBytes=null,
  maxTextureSize=4096
}={}){
  const memoryGiB=finitePositive(deviceMemoryGiB);
  const heapBytes=finitePositive(jsHeapLimitBytes);
  const heapMiB=heapBytes?heapBytes/MIB:null;
  const mobile=!!isAndroid||!!coarsePointer;
  // "coarse pointer" alone no longer means "4 GB device".
  // Unknown Android memory still gets conservative rendering/texture settings,
  // but it does not receive an arbitrary triangle hard-stop.
  const constrained=!!isAndroid && (memoryGiB===null || memoryGiB<=4);
  const maxTexture=finitePositive(maxTextureSize)||4096;
  const requestedTextureSide=mobile?(constrained?1024:2048):4096;
  const textureSide=Math.max(256,Math.min(requestedTextureSide,maxTexture));

  // Resource budget is derived from information the runtime actually exposes.
  // If neither RAM nor JS heap limit is available, no hard memory gate is guessed.
  const candidates=[];
  if(memoryGiB)candidates.push(memoryGiB*1024*0.14);
  if(heapMiB)candidates.push(heapMiB*0.28);
  const resourceBudgetMiB=candidates.length
    ?clamp(Math.min(...candidates),192,isAndroid?768:1536)
    :null;

  return {
    isAndroid:!!isAndroid,
    mobile,
    constrained,
    deviceMemoryGiB:memoryGiB,
    jsHeapLimitMiB:heapMiB,
    maxTextureSize:maxTexture,
    textureSide,
    resourceBudgetMiB
  };
}

function typedArrayStorageBytes(attribute,seenBuffers){
  const array=attribute?.isInterleavedBufferAttribute?attribute.data?.array:attribute?.array;
  const buffer=array?.buffer;
  if(!buffer||seenBuffers.has(buffer))return 0;
  seenBuffers.add(buffer);
  return buffer.byteLength||array.byteLength||0;
}

function materialTextures(material){
  const textures=[];
  if(!material)return textures;
  for(const value of Object.values(material))if(value?.isTexture)textures.push(value);
  return textures;
}

function textureDimensions(texture){
  const source=texture?.image||texture?.source?.data;
  if(Array.isArray(source)){
    const face=source.find(x=>x?.width&&x?.height);
    return face?{width:face.width,height:face.height,layers:source.length}:null;
  }
  if(source?.width&&source?.height)return {width:source.width,height:source.height,layers:1};
  return null;
}

export function measureScene(object){
  let triangles=0,meshes=0,texturePixels=0,geometryBytes=0,textureBytes=0;
  const geometries=new Set(),textures=new Set(),buffers=new Set();
  object?.traverse(o=>{
    if(!o.isMesh)return;
    meshes++;
    const g=o.geometry,p=g?.getAttribute('position');
    if(p)triangles+=Math.floor((g.index?.count??p.count)/3);
    if(g&&!geometries.has(g)){
      geometries.add(g);
      if(g.index)geometryBytes+=typedArrayStorageBytes(g.index,buffers);
      for(const attr of Object.values(g.attributes||{}))geometryBytes+=typedArrayStorageBytes(attr,buffers);
      for(const attrs of Object.values(g.morphAttributes||{}))
        for(const attr of attrs||[])geometryBytes+=typedArrayStorageBytes(attr,buffers);
    }
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const mat of mats)for(const texture of materialTextures(mat)){
      if(textures.has(texture))continue;
      textures.add(texture);
      const dimensions=textureDimensions(texture);
      if(!dimensions)continue;
      const pixels=dimensions.width*dimensions.height*dimensions.layers;
      texturePixels+=pixels;
      // Most glTF textures use mipmaps. 4/3 approximates the full mip chain.
      const mipFactor=texture.generateMipmaps===false?1:4/3;
      textureBytes+=pixels*4*mipFactor;
    }
    const boneTexture=o.skeleton?.boneTexture;
    if(boneTexture&&!textures.has(boneTexture)){
      textures.add(boneTexture);
      const dimensions=textureDimensions(boneTexture);
      if(dimensions){
        const pixels=dimensions.width*dimensions.height*(dimensions.layers||1);
        texturePixels+=pixels;textureBytes+=pixels*4;
      }
    }
  });
  return {
    triangles,meshes,textures:textures.size,texturePixels,
    geometryBytes,textureBytes,gpuBytes:geometryBytes+textureBytes
  };
}

export function validateSceneBounds(object){
  if(!object)throw new Error('Нет модели');
  const box=new THREE.Box3().setFromObject(object);
  if(box.isEmpty())throw new Error('В файле нет геометрии');
  const size=box.getSize(new THREE.Vector3());
  const center=box.getCenter(new THREE.Vector3());
  const values=[...box.min,...box.max,...size,...center];
  if(values.some(v=>!Number.isFinite(v)))
    throw new Error('Повреждены координаты модели (NaN или Infinity)');
  const maxSize=Math.max(size.x,size.y,size.z);
  const maxAbs=Math.max(...[...box.min,...box.max].map(Math.abs));
  if(maxSize>100000)throw new Error('Модель слишком большая по координатам');
  // Huge world offsets destroy float precision in WebGL even when the mesh itself is small.
  if(maxAbs>10000000)throw new Error('Модель находится слишком далеко от центра координат');
  return {box,size,center,maxAbs};
}

function statsBytes(stats){
  const geometryBytes=Number(stats?.geometryBytes)||0;
  const textureBytes=Number(stats?.textureBytes)||
    ((Number(stats?.texturePixels)||0)*4*4/3);
  return {geometryBytes,textureBytes,gpuBytes:geometryBytes+textureBytes};
}

export function mobileSceneBudget(previous,incoming,profile={}){
  const p=statsBytes(previous),n=statsBytes(incoming);
  const total=(Number(previous?.triangles)||0)+(Number(incoming?.triangles)||0);
  const geometryBytes=p.geometryBytes+n.geometryBytes;
  const textureBytes=p.textureBytes+n.textureBytes;
  const gpuBytes=geometryBytes+textureBytes;
  const budgetMiB=finitePositive(profile?.resourceBudgetMiB);
  const approximateGpuMiB=gpuBytes/MIB;
  return {
    total,
    geometryBytes,
    textureBytes,
    approximateTextureMiB:textureBytes/MIB,
    approximateGeometryMiB:geometryBytes/MIB,
    approximateGpuMiB,
    budgetMiB,
    softLimitExceeded:!!budgetMiB&&approximateGpuMiB>budgetMiB*0.70,
    hardLimitExceeded:!!budgetMiB&&approximateGpuMiB>budgetMiB
  };
}

function asBytes(buffer){
  if(buffer instanceof Uint8Array)return buffer;
  if(buffer instanceof ArrayBuffer)return new Uint8Array(buffer);
  if(ArrayBuffer.isView(buffer))return new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength);
  throw new Error('Ожидался бинарный GLB');
}
function readU32LE(bytes,offset){
  return new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0,true);
}
function readU32BE(bytes,offset){
  return new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0,false);
}
function align4(value){return (value+3)&~3;}

function parseGlb(buffer){
  const bytes=asBytes(buffer);
  if(bytes.byteLength<20||readU32LE(bytes,0)!==GLB_MAGIC)throw new Error('Некорректный заголовок GLB');
  const version=readU32LE(bytes,4);
  if(version!==2)throw new Error('Поддерживается GLB версии 2');
  const declared=readU32LE(bytes,8);
  if(declared>bytes.byteLength||declared<20)throw new Error('Повреждён размер GLB');
  let offset=12;const chunks=[];
  while(offset+8<=declared){
    const length=readU32LE(bytes,offset),type=readU32LE(bytes,offset+4);
    const start=offset+8,end=start+length;
    if(end>declared)throw new Error('Повреждён chunk GLB');
    chunks.push({type,bytes:bytes.subarray(start,end),headerOffset:offset,dataOffset:start});
    offset=end;
  }
  const jsonChunk=chunks.find(c=>c.type===GLB_JSON);
  if(!jsonChunk)throw new Error('GLB не содержит JSON chunk');
  const jsonText=new TextDecoder().decode(jsonChunk.bytes).replace(/[\u0000\s]+$/g,'');
  let json;
  try{json=JSON.parse(jsonText);}catch{throw new Error('Повреждён JSON внутри GLB');}
  const binChunk=chunks.find(c=>c.type===GLB_BIN)||null;
  return {bytes,json,chunks,binChunk};
}

function jpegDimensions(bytes){
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  let i=2;
  while(i+8<bytes.length){
    while(i<bytes.length&&bytes[i]!==0xff)i++;
    while(i<bytes.length&&bytes[i]===0xff)i++;
    if(i>=bytes.length)break;
    const marker=bytes[i++];
    if(marker===0xd8||marker===0xd9)continue;
    if(i+1>=bytes.length)break;
    const length=(bytes[i]<<8)|bytes[i+1];
    if(length<2||i+length>bytes.length)break;
    const sof=(marker>=0xc0&&marker<=0xc3)||(marker>=0xc5&&marker<=0xc7)||
      (marker>=0xc9&&marker<=0xcb)||(marker>=0xcd&&marker<=0xcf);
    if(sof&&length>=7){
      const height=(bytes[i+3]<<8)|bytes[i+4];
      const width=(bytes[i+5]<<8)|bytes[i+6];
      return width&&height?{width,height}:null;
    }
    i+=length;
  }
  return null;
}
function webpDimensions(bytes){
  if(bytes.length<30)return null;
  const text=(i,n)=>String.fromCharCode(...bytes.subarray(i,i+n));
  if(text(0,4)!=='RIFF'||text(8,4)!=='WEBP')return null;
  const type=text(12,4);
  if(type==='VP8X'){
    const width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);
    const height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);
    return {width,height};
  }
  if(type==='VP8L'&&bytes[20]===0x2f){
    const bits=bytes[21]|(bytes[22]<<8)|(bytes[23]<<16)|(bytes[24]<<24);
    return {width:(bits&0x3fff)+1,height:((bits>>14)&0x3fff)+1};
  }
  return null;
}
export function encodedImageDimensions(input,mimeType=''){
  const bytes=asBytes(input);
  if(bytes.length>=24&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)
    return {width:readU32BE(bytes,16),height:readU32BE(bytes,20),mimeType:'image/png'};
  const jpeg=jpegDimensions(bytes);
  if(jpeg)return {...jpeg,mimeType:'image/jpeg'};
  const webp=webpDimensions(bytes);
  if(webp)return {...webp,mimeType:'image/webp'};
  return null;
}

function accessorElementBytes(accessor){
  const component=COMPONENT_BYTES[accessor?.componentType]||0;
  const components=TYPE_COMPONENTS[accessor?.type]||0;
  const count=Number(accessor?.count)||0;
  return component*components*count;
}
function primitiveCount(primitive,json){
  const accessorIndex=Number.isInteger(primitive?.indices)?primitive.indices:primitive?.attributes?.POSITION;
  const count=Number(json.accessors?.[accessorIndex]?.count)||0;
  const mode=primitive?.mode??4;
  if(mode===4)return Math.floor(count/3);
  if(mode===5||mode===6)return Math.max(0,count-2);
  return 0;
}
function collectPrimitiveAccessors(primitive,set){
  if(Number.isInteger(primitive?.indices))set.add(primitive.indices);
  for(const index of Object.values(primitive?.attributes||{}))if(Number.isInteger(index))set.add(index);
  for(const target of primitive?.targets||[])
    for(const index of Object.values(target||{}))if(Number.isInteger(index))set.add(index);
}
function activeNodeIndices(json){
  const scene=json.scenes?.[json.scene??0];
  const roots=scene?.nodes;
  if(!Array.isArray(roots))return new Set((json.nodes||[]).map((_,i)=>i));
  const visited=new Set();
  const visit=index=>{
    if(!Number.isInteger(index)||visited.has(index))return;
    visited.add(index);
    for(const child of json.nodes?.[index]?.children||[])visit(child);
  };
  for(const root of roots)visit(root);
  return visited;
}

function embeddedImageBytes(parsed,image){
  if(!Number.isInteger(image?.bufferView)||!parsed.binChunk)return null;
  const view=parsed.json.bufferViews?.[image.bufferView];
  if(!view||(view.buffer??0)!==0)return null;
  const start=Number(view.byteOffset)||0,length=Number(view.byteLength)||0;
  if(start<0||length<=0||start+length>parsed.binChunk.bytes.length)return null;
  return parsed.binChunk.bytes.subarray(start,start+length);
}

export function inspectGlb(buffer,{maxTextureSide=Infinity}={}){
  const parsed=parseGlb(buffer),json=parsed.json;
  const meshTriangles=(json.meshes||[]).map(mesh=>
    (mesh.primitives||[]).reduce((sum,p)=>sum+primitiveCount(p,json),0));
  const nodes=activeNodeIndices(json);
  let triangles=0,meshes=0;
  const usedMeshIndices=new Set(),usedAccessors=new Set();
  for(const index of nodes){
    const node=json.nodes?.[index];
    if(!Number.isInteger(node?.mesh))continue;
    usedMeshIndices.add(node.mesh);
    triangles+=meshTriangles[node.mesh]||0;
    meshes+=(json.meshes?.[node.mesh]?.primitives||[]).length;
  }
  for(const meshIndex of usedMeshIndices)
    for(const primitive of json.meshes?.[meshIndex]?.primitives||[])collectPrimitiveAccessors(primitive,usedAccessors);
  let geometryBytes=0;
  for(const accessorIndex of usedAccessors)geometryBytes+=accessorElementBytes(json.accessors?.[accessorIndex]);

  const images=[];let texturePixels=0,projectedTexturePixels=0,oversizedImages=0;
  for(let i=0;i<(json.images||[]).length;i++){
    const image=json.images[i],encoded=embeddedImageBytes(parsed,image);
    const dims=encoded?encodedImageDimensions(encoded,image.mimeType):null;
    if(!dims){images.push({index:i,width:null,height:null,mimeType:image.mimeType||null,embedded:!!encoded});continue;}
    const max=Math.max(dims.width,dims.height);
    const scale=Number.isFinite(maxTextureSide)&&maxTextureSide>0?Math.min(1,maxTextureSide/max):1;
    const targetWidth=Math.max(1,Math.round(dims.width*scale));
    const targetHeight=Math.max(1,Math.round(dims.height*scale));
    if(scale<1)oversizedImages++;
    texturePixels+=dims.width*dims.height;
    projectedTexturePixels+=targetWidth*targetHeight;
    images.push({
      index:i,width:dims.width,height:dims.height,mimeType:dims.mimeType||image.mimeType||null,
      embedded:!!encoded,targetWidth,targetHeight,resize:scale<1
    });
  }
  const textureBytes=projectedTexturePixels*4*4/3;
  return {
    triangles,meshes,geometryBytes,
    texturePixels,
    projectedTexturePixels,
    textureBytes,
    gpuBytes:geometryBytes+textureBytes,
    images,
    oversizedImages
  };
}

async function canvasBlob(canvas,mimeType){
  const type=['image/png','image/jpeg','image/webp'].includes(mimeType)?mimeType:'image/png';
  if(canvas.convertToBlob)return canvas.convertToBlob({type,quality:type==='image/png'?undefined:.9});
  return new Promise((resolve,reject)=>
    canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось перекодировать текстуру')),type,type==='image/png'?undefined:.9));
}
async function resizeEncodedImage(bytes,{mimeType,width,height,targetWidth,targetHeight}){
  if(typeof Blob==='undefined')throw new Error('В этом окружении нет Blob для обработки текстур');
  const blob=new Blob([bytes],{type:mimeType||'application/octet-stream'});
  let bitmap=null;
  try{
    if(typeof createImageBitmap==='function'){
      try{
        bitmap=await createImageBitmap(blob,{
          resizeWidth:targetWidth,resizeHeight:targetHeight,resizeQuality:'high',
          imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'
        });
      }catch{
        bitmap=await createImageBitmap(blob,{
          imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'
        });
      }
    }else if(typeof document!=='undefined'){
      const url=URL.createObjectURL(blob);
      try{
        const img=new Image();
        img.src=url;
        await img.decode();
        bitmap=img;
      }finally{URL.revokeObjectURL(url);}
    }else throw new Error('Нет декодера изображений');
    const canvas=typeof OffscreenCanvas!=='undefined'
      ?new OffscreenCanvas(targetWidth,targetHeight)
      :Object.assign(document.createElement('canvas'),{width:targetWidth,height:targetHeight});
    const context=canvas.getContext('2d',{alpha:true});
    if(!context)throw new Error('Нет 2D canvas для уменьшения текстуры');
    context.drawImage(bitmap,0,0,targetWidth,targetHeight);
    const output=await canvasBlob(canvas,mimeType);
    return new Uint8Array(await output.arrayBuffer());
  }finally{
    if(bitmap?.close)bitmap.close();
  }
}

function writeChunk(target,offset,type,bytes,padByte){
  const view=new DataView(target.buffer);
  view.setUint32(offset,bytes.length,true);
  view.setUint32(offset+4,type,true);
  target.set(bytes,offset+8);
  const padded=align4(bytes.length);
  if(padded>bytes.length)target.fill(padByte,offset+8+bytes.length,offset+8+padded);
  return offset+8+padded;
}
function rebuildGlb(json,binBytes,extraChunks=[]){
  const jsonBytes=new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded=align4(jsonBytes.length),binPadded=align4(binBytes.length);
  let total=12+8+jsonPadded+8+binPadded;
  for(const chunk of extraChunks)total+=8+align4(chunk.bytes.length);
  const out=new Uint8Array(total),view=new DataView(out.buffer);
  view.setUint32(0,GLB_MAGIC,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
  let offset=12;
  offset=writeChunk(out,offset,GLB_JSON,jsonBytes,0x20);
  offset=writeChunk(out,offset,GLB_BIN,binBytes,0x00);
  for(const chunk of extraChunks)offset=writeChunk(out,offset,chunk.type,chunk.bytes,0x00);
  return out.buffer;
}

export async function optimizeGlbTextures(buffer,{
  maxSide=1024,
  onProgress=null,
  resizeImage=resizeEncodedImage
}={}){
  const parsed=parseGlb(buffer);
  if(!parsed.binChunk)return {buffer:asBytes(buffer).slice().buffer,resized:0,skipped:0,inPlace:false};
  const inspection=inspectGlb(buffer,{maxTextureSide:maxSide});
  const targets=inspection.images.filter(x=>x.resize&&x.embedded);
  if(!targets.length)return {buffer:buffer instanceof ArrayBuffer?buffer:asBytes(buffer).slice().buffer,resized:0,skipped:inspection.oversizedImages,inPlace:true};

  const json=structuredClone(parsed.json);
  const patches=[];const appended=[];let extraLength=0,resized=0,skipped=0;
  for(let n=0;n<targets.length;n++){
    const item=targets[n],image=json.images[item.index];
    const originalView=json.bufferViews?.[image.bufferView];
    const encoded=embeddedImageBytes(parsed,parsed.json.images[item.index]);
    if(!encoded||!originalView){skipped++;continue;}
    try{
      onProgress?.({index:n+1,total:targets.length,width:item.width,height:item.height});
      const output=await resizeImage(encoded,{
        mimeType:item.mimeType||image.mimeType||'image/png',
        width:item.width,height:item.height,
        targetWidth:item.targetWidth,targetHeight:item.targetHeight
      });
      const bytes=asBytes(output);
      if((originalView.buffer??0)===0&&bytes.length<=originalView.byteLength){
        // Normal downscales are smaller than the source. Reuse the exact same
        // BIN range, so a 100 MB GLB does not need a second 100 MB ArrayBuffer.
        patches.push({
          offset:Number(originalView.byteOffset)||0,
          capacity:Number(originalView.byteLength)||0,
          bytes
        });
        originalView.byteLength=bytes.length;
      }else{
        const offset=align4(parsed.binChunk.bytes.length+extraLength);
        const pad=offset-(parsed.binChunk.bytes.length+extraLength);
        if(pad)appended.push(new Uint8Array(pad));
        extraLength+=pad;
        const viewIndex=json.bufferViews.length;
        json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});
        image.bufferView=viewIndex;
        appended.push(bytes);extraLength+=bytes.length;
      }
      image.mimeType=item.mimeType||image.mimeType;
      resized++;
    }catch(error){
      console.warn('QDQR texture pre-resize skipped',error);
      skipped++;
    }
  }
  if(!resized)return {buffer:buffer instanceof ArrayBuffer?buffer:asBytes(buffer).slice().buffer,resized:0,skipped,inPlace:true};

  // Apply image replacements only after every resize finished successfully.
  // Until this point the original GLB remains untouched and can still be used.
  for(const patch of patches){
    parsed.binChunk.bytes.set(patch.bytes,patch.offset);
    if(patch.capacity>patch.bytes.length)
      parsed.binChunk.bytes.fill(0,patch.offset+patch.bytes.length,patch.offset+patch.capacity);
  }

  const jsonBytes=new TextEncoder().encode(JSON.stringify(json));
  if(!appended.length&&jsonBytes.length<=parsed.chunks.find(x=>x.type===GLB_JSON).bytes.length){
    const jsonChunk=parsed.chunks.find(x=>x.type===GLB_JSON);
    jsonChunk.bytes.fill(0x20);jsonChunk.bytes.set(jsonBytes,0);
    return {
      buffer:buffer instanceof ArrayBuffer?buffer:parsed.bytes.slice().buffer,
      resized,skipped,inPlace:true
    };
  }

  const finalBin=new Uint8Array(parsed.binChunk.bytes.length+extraLength);
  finalBin.set(parsed.binChunk.bytes,0);
  let cursor=parsed.binChunk.bytes.length;
  for(const chunk of appended){finalBin.set(chunk,cursor);cursor+=chunk.length;}
  if(json.buffers?.[0])json.buffers[0].byteLength=finalBin.length;
  const extras=parsed.chunks.filter(c=>c.type!==GLB_JSON&&c.type!==GLB_BIN);
  return {buffer:rebuildGlb(json,finalBin,extras),resized,skipped,inPlace:false};
}

// Fallback for OBJ/GLTF paths and image types that cannot be rewritten before load.
// GLB imports should use optimizeGlbTextures() first to avoid decoding all large maps at once.
export function reduceImportedTextureFootprint(object,{maxSide=1024}={}){
  if(typeof document==='undefined')return {resized:0};
  const seen=new Set();let resized=0;
  object.traverse(o=>{
    if(!o.isMesh)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const mat of mats)for(const value of materialTextures(mat)){
      if(seen.has(value))continue;
      seen.add(value);
      const image=value.image||value.source?.data;
      if(!image?.width||!image?.height||Math.max(image.width,image.height)<=maxSide)continue;
      const k=maxSide/Math.max(image.width,image.height);
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.width*k));
      canvas.height=Math.max(1,Math.round(image.height*k));
      const context=canvas.getContext('2d');
      if(!context)continue;
      try{
        context.drawImage(image,0,0,canvas.width,canvas.height);
        value.image=canvas;value.needsUpdate=true;resized++;
      }catch(error){console.warn('Texture resize skipped',error);}
    }
  });
  return {resized};
}

export function collectObjectResources(object){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  object?.traverse(o=>{
    if(o.geometry?.isBufferGeometry)geometries.add(o.geometry);
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const mat of mats){
      if(!mat)continue;
      materials.add(mat);
      for(const texture of materialTextures(mat))textures.add(texture);
    }
    if(o.skeleton?.boneTexture)textures.add(o.skeleton.boneTexture);
  });
  return {geometries,materials,textures};
}

export function disposeDetachedResources(object,keepObject=null){
  const doomed=collectObjectResources(object);
  const keep=collectObjectResources(keepObject);
  let geometries=0,materials=0,textures=0;
  for(const texture of doomed.textures)if(!keep.textures.has(texture)&&texture.dispose){texture.dispose();textures++;}
  for(const material of doomed.materials)if(!keep.materials.has(material)&&material.dispose){material.dispose();materials++;}
  for(const geometry of doomed.geometries)if(!keep.geometries.has(geometry)&&geometry.dispose){geometry.dispose();geometries++;}
  return {geometries,materials,textures};
}
