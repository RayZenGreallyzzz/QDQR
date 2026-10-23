import * as THREE from 'three';

// Pixel-array segmentation is independent of WebGL, so it can be regression
// tested without running Android or a graphics context.
export function findEnclosedRegions(occupied,width,height,{minPixels=26,maxRegions=64}={}){
  if(!occupied || occupied.length!==width*height)throw new Error('Неверные данные силуэта');
  if(width<8||height<8)throw new Error('Слишком низкое разрешение');
  const seen=new Uint8Array(width*height);
  const dirs=[1,-1,width,-width],queue=new Int32Array(width*height);
  function fill(seed,keep){
    let head=0,tail=0;
    queue[tail++]=seed;seen[seed]=1;
    const pixels=keep?[]:null;
    let xMin=width,yMin=height,xMax=-1,yMax=-1;
    while(head<tail){
      const n=queue[head++],x=n%width,y=(n-x)/width;
      if(keep){pixels.push(n);xMin=Math.min(xMin,x);xMax=Math.max(xMax,x);yMin=Math.min(yMin,y);yMax=Math.max(yMax,y);}
      if(x>0){const m=n-1;if(!occupied[m]&&!seen[m]){seen[m]=1;queue[tail++]=m;}}
      if(x<width-1){const m=n+1;if(!occupied[m]&&!seen[m]){seen[m]=1;queue[tail++]=m;}}
      if(y>0){const m=n-width;if(!occupied[m]&&!seen[m]){seen[m]=1;queue[tail++]=m;}}
      if(y<height-1){const m=n+width;if(!occupied[m]&&!seen[m]){seen[m]=1;queue[tail++]=m;}}
    }
    return keep?{pixels,bounds:{xMin,yMin,xMax,yMax},area:pixels.length}:null;
  }
  // Flood from the image border to remove empty space outside the frame.
  for(let y=0;y<height;y++)for(const x of [0,width-1]){
    const n=y*width+x;if(!occupied[n]&&!seen[n])fill(n,false);
  }
  for(let x=0;x<width;x++)for(const y of [0,height-1]){
    const n=y*width+x;if(!occupied[n]&&!seen[n])fill(n,false);
  }
  const regions=[];
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const n=y*width+x;if(occupied[n]||seen[n])continue;
    const r=fill(n,true);
    if(r.area>=minPixels)regions.push(r);
  }
  regions.sort((a,b)=>b.area-a.area);
  if(regions.length>maxRegions)regions.length=maxRegions;
  return regions.map((r,i)=>({...r,id:i+1}));
}
function signedArea(pts){
  let area=0;
  for(let i=0;i<pts.length;i++){
    const p=pts[i],q=pts[(i+1)%pts.length];
    area+=p[0]*q[1]-q[0]*p[1];
  }
  return area*.5;
}
function removeCollinear(loop){
  if(loop.length<4)return loop;
  const points=loop.filter((p,i)=>i===0||p[0]!==loop[i-1][0]||p[1]!==loop[i-1][1]);
  return points.filter((p,i)=>{
    const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];
    const cross=(p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]);
    return Math.abs(cross)>1e-6;
  });
}
export function traceRegionContours(region,width,height){
  const inside=new Set(region.pixels),startMap=new Map();
  const stride=width+1;
  const add=(a,b)=>{
    let out=startMap.get(a);
    if(!out){out=[];startMap.set(a,out);}
    out.push(b);
  };
  for(const n of region.pixels){
    const x=n%width,y=(n-x)/width;
    const bottom=y*stride+x,top=(y+1)*stride+x;
    if(y===0||!inside.has(n-width))add(bottom,bottom+1);
    if(x===width-1||!inside.has(n+1))add(bottom+1,top+1);
    if(y===height-1||!inside.has(n+width))add(top+1,top);
    if(x===0||!inside.has(n-1))add(top,bottom);
  }
  const taken=new Set(),loops=[];
  const decode=id=>[id%stride,Math.floor(id/stride)];
  for(const [start,ends] of startMap){
    for(const end of ends){
      const edge=start+','+end;
      if(taken.has(edge))continue;
      const loop=[decode(start)];
      let cur=start,next=end,iterations=0;
      while(iterations++ < region.pixels.length*5+100){
        taken.add(cur+','+next);
        if(next===start)break;
        loop.push(decode(next));
        const candidates=startMap.get(next)||[];
        const c=candidates.find(x=>!taken.has(next+','+x));
        if(c===undefined)break;
        cur=next;next=c;
      }
      if(next!==start||loop.length<3)continue;
      const clean=removeCollinear(loop);
      if(clean.length>=3&&Math.abs(signedArea(clean))>=1)loops.push(clean);
    }
  }
  loops.sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)));
  return loops;
}
function drawContour(path,points){
  path.moveTo(points[0][0],points[0][1]);
  for(let i=1;i<points.length;i++)path.lineTo(points[i][0],points[i][1]);
  path.closePath();
}
export function geometryForRegion(region,width,height,projection){
  const loops=traceRegionContours(region,width,height);
  if(!loops.length)throw new Error('Не удалось построить границу секции');
  const shape=new THREE.Shape();
  // Boundary of a black component is CCW, occupied stone islands inside are CW.
  drawContour(shape,loops[0]);
  for(const loop of loops.slice(1)){
    const hole=new THREE.Path();drawContour(hole,loop);shape.holes.push(hole);
  }
  const g=new THREE.ShapeGeometry(shape);
  const p=g.getAttribute('position');
  const uv=new Float32Array(p.count*2),world=new THREE.Vector3();
  const b=region.bounds;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i);
    world.set(x/width*2-1,y/height*2-1,0).unproject(projection.camera);
    world.setComponent(projection.normalAxis,projection.normalValue);
    p.setXYZ(i,world.x,world.y,world.z);
    uv[i*2]=(x-b.xMin)/Math.max(1,b.xMax+1-b.xMin);
    uv[i*2+1]=(y-b.yMin)/Math.max(1,b.yMax+1-b.yMin);
  }
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
  return g;
}
export function buildGlassPieces(regions,projection,{
  kind='colored',color='#7399c6',opacity=.52,all=true,activeIds=[],
  palette='mixed',fragments='small'
}={}){
  const selected=new Set(activeIds);
  const group=new THREE.Group();
  group.name='Стекло · '+(kind==='stained'?'витраж':kind==='clear'?'прозрачное':'цветное');
  group.userData.qdqrGlassContainer=true;
  group.userData.qdqrGlassKind=kind;
  const base=new THREE.Color(color);
  let count=0;
  for(const region of regions){
    if(!all&&!selected.has(region.id))continue;
    const geom=geometryForRegion(region,projection.width,projection.height,projection);
    let map=null,glassColor=base;
    if(kind==='stained'){
      map=createStainedTexture(region.id,palette,fragments);
      glassColor=new THREE.Color(0xffffff);
    } else if(kind==='clear')glassColor=new THREE.Color('#e7f4ff');
    const material=new THREE.MeshStandardMaterial({
      color:glassColor,map,transparent:true,
      opacity:kind==='clear'?Math.min(opacity,.38):opacity,
      metalness:.08,roughness:kind==='stained'?.38:.15,
      depthWrite:false,side:THREE.DoubleSide
    });
    const mesh=new THREE.Mesh(geom,material);
    mesh.name='Стекло · секция '+region.id;
    mesh.userData={qdqrGlassPane:true,qdqrGlassId:region.id};
    mesh.renderOrder=1;
    group.add(mesh);count++;
  }
  group.userData.qdqrGlassCount=count;
  return group;
}
export function createStainedTexture(seed=1,palette='mixed',fragments='small'){
  if(typeof document==='undefined')throw new Error('Для создания витража нужен браузер');
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=192;
  const context=canvas.getContext('2d',{willReadFrequently:false});
  if(!context)throw new Error('Нет графического контекста для витража');
  const count=fragments==='large'?14:42;
  const rng=mulberry32(seed*0x9e3779b1);
  const seeds=Array.from({length:count},()=>({x:rng()*192,y:rng()*192,c:Math.floor(rng()*5)}));
  const palettes={
    mixed:['#8c2140','#20589e','#b78a23','#278176','#6a448a'],
    blue:['#0d3978','#3167aa','#589ace','#173862','#7bb9d4'],
    red:['#a12b3a','#dc6e4c','#802949','#bf8b33','#e2b970'],
    green:['#205f48','#47965f','#80b073','#9b953d','#287b8b'],
    amber:['#8d512a','#d69935','#d9b660','#a83932','#f1d38c']
  };
  // Canvas ImageData stores sRGB bytes. Do not use THREE.Color's linear
  // channels as bytes, or stained glass looks much darker than requested.
  const rgba=(palettes[palette]||palettes.mixed).map(hex=>{
    const n=Number.parseInt(hex.slice(1),16);
    return [(n>>16)&255,(n>>8)&255,n&255];
  });
  const image=context.createImageData(192,192);
  for(let y=0;y<192;y++)for(let x=0;x<192;x++){
    let best=Infinity,second=Infinity,choice=0;
    for(let k=0;k<count;k++){
      const p=seeds[k],dist=(x-p.x)**2+(y-p.y)**2;
      if(dist<best){second=best;best=dist;choice=p.c;}
      else if(dist<second)second=dist;
    }
    // About 2px dark cames on neighboring Voronoi cells.
    const lead=(second-best)<100;
    const i=(y*192+x)*4;
    const shade=1-.14*Math.abs(Math.sin(x*.083+y*.064+seed));
    const col=lead?[24,22,34]:rgba[choice];
    image.data[i]=col[0]*shade;image.data[i+1]=col[1]*shade;
    image.data[i+2]=col[2]*shade;image.data[i+3]=255;
  }
  context.putImageData(image,0,0);
  const tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=THREE.ClampToEdgeWrapping;tex.wrapT=THREE.ClampToEdgeWrapping;
  return tex;
}
function mulberry32(seed){return function(){let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}

// Render a silhouette to a small offscreen texture. GPU projection avoids
// O(pixels * triangles) CPU raycasts on Android for dense Meshy ornament.
export function captureFrameSilhouette(renderer,source,{longSide=384}={}){
  if(!source?.isObject3D)throw new Error('Выбери оконную раму');
  // Clone structure but reuse immutable vertex buffers to save tablet RAM.
  const subject=source.clone(true);
  subject.position.set(0,0,0);subject.quaternion.identity();subject.scale.set(1,1,1);
  const maskMaterial=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,depthTest:true,depthWrite:true});
  let count=0;
  subject.traverse(o=>{
    if(!o.isMesh)return;
    let decorative=false;
    for(let p=o;p;p=p.parent){
      if(p.userData?.qdqrGlassPane || p.userData?.qdqrGlassContainer ||
        p.userData?.qdqrAttachedDecor){decorative=true;break;}
      if(p===subject)break;
    }
    if(decorative){o.visible=false;return;}
    o.material=maskMaterial;o.visible=true;count++;
  });
  if(!count)throw new Error('В выбранной раме нет видимой геометрии');
  subject.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(subject);
  if(bounds.isEmpty())throw new Error('Не удалось определить размеры рамы');
  const dimensions=bounds.getSize(new THREE.Vector3());
  const axes=['x','y','z'],axis=axes.reduce((v,a)=>dimensions[a]<dimensions[v]?a:v,'z');
  const center=bounds.getCenter(new THREE.Vector3());
  let horizontal,vertical,direction,up;
  if(axis==='z'){horizontal=dimensions.x;vertical=dimensions.y;direction=new THREE.Vector3(0,0,1);up=new THREE.Vector3(0,1,0);}
  else if(axis==='x'){horizontal=dimensions.z;vertical=dimensions.y;direction=new THREE.Vector3(1,0,0);up=new THREE.Vector3(0,1,0);}
  else {horizontal=dimensions.x;vertical=dimensions.z;direction=new THREE.Vector3(0,1,0);up=new THREE.Vector3(0,0,-1);}
  if(horizontal<=.001||vertical<=.001)throw new Error('Рама должна быть плоской, с открытыми секциями');
  const pad=1.1,u=horizontal*pad,v=vertical*pad;
  const scale=longSide/Math.max(u,v);
  const width=Math.max(64,Math.round(u*scale)),height=Math.max(64,Math.round(v*scale));
  const depth=Math.max(dimensions.x,dimensions.y,dimensions.z,1)*4;
  const camera=new THREE.OrthographicCamera(-u/2,u/2,v/2,-v/2,.01,depth*3);
  camera.position.copy(center).addScaledVector(direction,depth);
  camera.up.copy(up);camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x000000);scene.add(subject);
  const renderTarget=new THREE.WebGLRenderTarget(width,height,{
    type:THREE.UnsignedByteType,format:THREE.RGBAFormat,depthBuffer:true,stencilBuffer:false
  });
  const pixels=new Uint8Array(width*height*4),occupied=new Uint8Array(width*height);
  const before=renderer.getRenderTarget(),tone=renderer.toneMapping,exposure=renderer.toneMappingExposure;
  try{
    renderer.toneMapping=THREE.NoToneMapping;
    renderer.toneMappingExposure=1;
    renderer.setRenderTarget(renderTarget);
    renderer.clear(true,true,true);
    renderer.render(scene,camera);
    renderer.readRenderTargetPixels(renderTarget,0,0,width,height,pixels);
    for(let i=0;i<occupied.length;i++)occupied[i]=pixels[i*4]>100?1:0;
  }finally{
    renderer.setRenderTarget(before);renderer.toneMapping=tone;renderer.toneMappingExposure=exposure;
    renderTarget.dispose();maskMaterial.dispose();
  }
  const regions=findEnclosedRegions(occupied,width,height,{
    minPixels:Math.max(20,Math.floor(width*height*.00032)),maxRegions:64
  });
  if(!regions.length)throw new Error('Замкнутые отверстия не найдены. Проверь раму или её ориентацию.');
  return {regions,width,height,occupied,projection:{
    camera,width,height,normalAxis:axes.indexOf(axis),
    normalValue:center.getComponent(axes.indexOf(axis)),bounds
  }};
}
