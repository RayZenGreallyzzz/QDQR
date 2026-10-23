import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

export function createOpeningGeometry(kind,width,height,depth){
  if(!['door','window','arch'].includes(kind))throw new Error('Неизвестный тип проёма');
  if(![width,height,depth].every(Number.isFinite)||width<.3||height<.4||depth<.1)
    throw new Error('Недопустимые размеры проёма');
  if(kind!=='arch')return new THREE.BoxGeometry(width,height,depth);
  const r=Math.min(width/2,height*.48);
  const shoulder=height/2-r;
  const s=new THREE.Shape();
  s.moveTo(-width/2,-height/2);
  s.lineTo(width/2,-height/2);
  s.lineTo(width/2,shoulder);
  // Smooth curved semicircular top: from right spring point across top to left.
  s.absarc(0,shoulder,r,0,Math.PI,false);
  s.lineTo(-width/2,-height/2);
  s.closePath();
  const geom=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,steps:1,curveSegments:24});
  geom.translate(0,0,-depth/2);
  return geom;
}

export function getWallBounds(target){
  if(!target?.isObject3D)throw new Error('Выбери стену');
  target.updateWorldMatrix(true,true);
  const inv=target.matrixWorld.clone().invert(),b=new THREE.Box3().makeEmpty();
  const v=new THREE.Vector3();
  let meshes=0;
  target.traverse(obj=>{
    if(!obj.isMesh || obj.userData?.qdqrOpeningTrim || !obj.geometry?.getAttribute('position'))return;
    const g=obj.geometry,m=inv.clone().multiply(obj.matrixWorld);
    g.computeBoundingBox();
    const box=g.boundingBox;
    if(!box)return;
    for(const x of [box.min.x,box.max.x])
      for(const y of [box.min.y,box.max.y])
        for(const z of [box.min.z,box.max.z])
          b.expandByPoint(v.set(x,y,z).applyMatrix4(m));
    meshes++;
  });
  if(!meshes||b.isEmpty())throw new Error('В выбранной стене нет геометрии');
  return b;
}
export function defaultOpening(kind,wall){
  const b=getWallBounds(wall),sz=b.getSize(new THREE.Vector3());
  if(sz.x<.4||sz.y<.65)throw new Error('Стену нужно ориентировать вертикально по осям X/Y');
  const width=Math.min(kind==='window'?1.25:1.1,sz.x*.8);
  const height=Math.min(kind==='window'?1.2:2.15,sz.y*.9);
  const sill=kind==='window'?Math.min(.9,Math.max(.1,(sz.y-height)/2)):0;
  return {
    kind,width,height,
    centerX:b.getCenter(new THREE.Vector3()).x,
    centerY:b.min.y+sill+height/2,
    centerZ:b.getCenter(new THREE.Vector3()).z,
    thickness:Math.max(.2,sz.z)+.6,
    bbox:b,
  };
}

// Cut each affected closed wall mesh in its own coordinates. CSG expects
// manifold/watertight solids. The operation is atomic: meshes are changed
// only if *all* cuts succeed. Existing material groups and UVs stay on
// original faces; the cut jamb receives the second stone-like material.
export function cutWallOpening(wall,spec,{maxTotalFaces=120000}={}){
  if(!wall?.isObject3D || !spec)throw new Error('Выбери стену и проём');
  if(spec.width<=0||spec.height<=0)throw new Error('Ширина и высота должны быть больше нуля');
  wall.updateWorldMatrix(true,true);
  const cutterGeo=createOpeningGeometry(spec.kind,spec.width,spec.height,spec.thickness);
  const cutter=new THREE.Mesh(cutterGeo,new THREE.MeshStandardMaterial({
    color:'#aba092',roughness:.94,side:THREE.DoubleSide
  }));
  cutter.position.set(spec.centerX,spec.centerY,spec.centerZ);
  wall.add(cutter);cutter.updateWorldMatrix(true,true);
  const cutterBBox=new THREE.Box3().setFromObject(cutter);
  let total=0;const changes=[];let touched=0;
  try{
    const meshes=[];
    wall.traverse(obj=>{
      if(obj===cutter || !obj.isMesh || obj.userData?.qdqrOpeningTrim || !obj.visible)return;
      if(obj.isSkinnedMesh)throw new Error('Нельзя вырезать отверстие в риггированной модели');
      const geo=obj.geometry;
      if(!geo?.getAttribute('position'))return;
      if(Object.keys(geo.morphAttributes||{}).length)throw new Error('Морф-анимации не поддерживаются для проёмов');
      const bounds=new THREE.Box3().setFromObject(obj);
      if(!bounds.intersectsBox(cutterBBox))return;
      const faces=(geo.index?.count??geo.getAttribute('position').count)/3;
      total+=faces;
      if(total>maxTotalFaces)throw new Error('Слишком много полигонов. Раздели большую стену на секции перед вырезанием.');
      meshes.push(obj);
    });
    if(!meshes.length)throw new Error('Контур вне стены. Сдвинь проём на стену.');
    const evaluator=new Evaluator();
    evaluator.attributes=['position','normal','uv'];
    evaluator.useGroups=true;
    for(const mesh of meshes){
      // All parts are evaluated in wall-local coordinates, even when walls
      // have children with their own rotations, scaling, and parents.
      const wallInverse=wall.matrixWorld.clone().invert();
      const meshToWall=wallInverse.clone().multiply(mesh.matrixWorld);
      const wallToMesh=meshToWall.clone().invert();
      const brushA=new Brush(mesh.geometry.clone(),mesh.material);
      brushA.geometry=brushA.geometry.index?brushA.geometry.toNonIndexed():brushA.geometry;
      if(!brushA.geometry.getAttribute('normal'))brushA.geometry.computeVertexNormals();
      if(!brushA.geometry.getAttribute('uv')){
        const count=brushA.geometry.getAttribute('position').count;
        brushA.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(count*2),2));
      }
      brushA.updateMatrixWorld(true);
      const brushB=new Brush(cutterGeo.clone(),cutter.material);
      const transform=wallToMesh.clone().multiply(cutter.matrix);
      transform.decompose(brushB.position,brushB.quaternion,brushB.scale);
      brushB.updateMatrixWorld(true);
      const result=evaluator.evaluate(brushA,brushB,SUBTRACTION);
      const g=result.geometry;
      // The evaluator can leave a short drawRange; truncate it so a GLB
      // exporter never includes unused buffer triangles.
      const sanitized=compactResult(g);
      const tri=Math.floor((sanitized.index?.count??sanitized.getAttribute('position')?.count??0)/3);
      if(!tri)throw new Error('Проём полностью удалил деталь; уменьши размеры');
      if(!Number.isFinite(tri)||tri>240000)throw new Error('Результат слишком тяжёлый');
      changes.push({mesh,geometry:sanitized,material:result.material});
      touched++;
    }
    if(!changes.length)throw new Error('Под выбранным проёмом нет подходящих стен');
    for(const {mesh,geometry,material} of changes){
      mesh.geometry=geometry;
      mesh.material=Array.isArray(material)?material:material||mesh.material;
      mesh.userData.qdqrCutWall=true;
    }
    return {count:touched,triangles:changes.reduce((n,c)=>n+Math.floor(c.geometry.getAttribute('position').count/3),0)};
  }finally{
    cutter.removeFromParent();
    cutterGeo.dispose();
  }
}

function compactResult(geometry){
  let g=geometry.index?geometry.toNonIndexed():geometry.clone();
  const position=g.getAttribute('position');
  if(!position)throw new Error('После вырезания не осталось вершин');
  const start=Math.max(0,g.drawRange?.start||0);
  const count=Math.min(g.drawRange?.count??Infinity,position.count-start);
  if(start || count<position.count){
    const out=new THREE.BufferGeometry();
    const n=Math.max(0,Math.floor(count/3)*3);
    for(const [name,attr] of Object.entries(g.attributes)){
      const values=new attr.array.constructor(n*attr.itemSize);
      for(let i=0;i<n;i++)for(let c=0;c<attr.itemSize;c++)values[i*attr.itemSize+c]=attr.getComponent(i+start,c);
      out.setAttribute(name,new THREE.BufferAttribute(values,attr.itemSize,attr.normalized));
    }
    for(const group of g.groups){
      const gstart=Math.max(group.start,start),gend=Math.min(group.start+group.count,start+n);
      if(gend>gstart)out.addGroup(gstart-start,gend-gstart,group.materialIndex);
    }
    g.dispose();g=out;
  }
  g.setDrawRange(0,Infinity);
  g.computeBoundingBox();g.computeBoundingSphere();
  return g;
}

export function makeOpeningTrim(spec,{addFrame=true,addLeaf=false}={}){
  const group=new THREE.Group();group.name=(spec.kind==='window'?'Окно':spec.kind==='arch'?'Арка':'Дверь')+' · обрамление';
  group.userData.qdqrOpeningTrim=true;
  const w=spec.width,h=spec.height;
  const t=Math.min(.13,w*.12);
  const trimMat=new THREE.MeshStandardMaterial({color:'#a99d84',roughness:.88});
  const putBox=(name,a,b,c,x,y,z=0)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(a,b,c),trimMat.clone());
    m.name=name;m.position.set(x,y,z);m.userData.qdqrOpeningTrim=true;group.add(m);
  };
  if(addFrame){
    if(spec.kind==='arch'){
      const r=Math.min(w/2,h*.48),shoulder=h/2-r;
      putBox('Косяк левый',t,h-r,t,-w/2,-r/2);
      putBox('Косяк правый',t,h-r,t,w/2,-r/2);
      const curve=new THREE.ArcCurve(0,shoulder,r,0,Math.PI,false);
      const pts=curve.getPoints(30).map(v=>new THREE.Vector3(v.x,v.y,0));
      const path=new THREE.CatmullRomCurve3(pts);
      const arch=new THREE.Mesh(new THREE.TubeGeometry(path,30,t/2,6,false),trimMat.clone());
      arch.name='Арочное обрамление';arch.userData.qdqrOpeningTrim=true;group.add(arch);
    }else{
      putBox('Левый косяк',t,h,t,-w/2,0);
      putBox('Правый косяк',t,h,t,w/2,0);
      putBox('Перемычка',w+t,t,t,0,h/2);
      if(spec.kind==='window')putBox('Подоконник',w+t,t,t,0,-h/2);
    }
  }
  if(addLeaf){
    if(spec.kind==='door'){
      putBox('Дверное полотно',w-.09,h-.08,.055,0,0,-.035);
      const leaf=group.children[group.children.length-1];
      leaf.material.color.set('#68472e');
    }else if(spec.kind==='window'){
      const glass=new THREE.Mesh(new THREE.PlaneGeometry(w-.07,h-.07),new THREE.MeshStandardMaterial({
        color:0x78bcd8,transparent:true,opacity:.42,metalness:.3,roughness:.15,side:THREE.DoubleSide
      }));
      glass.name='Оконное стекло';glass.userData.qdqrOpeningTrim=true;
      group.add(glass);
    }
  }
  group.position.set(spec.centerX,spec.centerY,spec.centerZ+spec.thickness*.16);
  return group;
}
