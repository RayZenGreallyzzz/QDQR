import * as THREE from 'three';
import {createConstruction} from './meshOps.js';
import {dockNewModule,stackModuleOn,snapVerticalModule,isStackableModule} from './wallSnap.js';

export function getFloors(house){
  if(!house?.userData?.qdqrHouse)return [];
  return house.children.filter(o=>o.isGroup&&o.userData?.qdqrFloor).sort((a,b)=>a.userData.floorNumber-b.userData.floorNumber);
}

export function findFloorOf(object){
  for(let p=object;p;p=p.parent)if(p.userData?.qdqrFloor)return p;
  return null;
}

function boundsInSpace(object,space){
  const box=new THREE.Box3().makeEmpty();
  if(!object||!space)return box;
  object.updateWorldMatrix(true,true);space.updateWorldMatrix(true,false);
  const inv=space.matrixWorld.clone().invert(),corner=new THREE.Vector3();
  object.traverse(o=>{
    if(!o.isMesh||!o.geometry?.getAttribute('position'))return;
    o.updateWorldMatrix(true,false);
    if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
    const b=o.geometry.boundingBox;if(!b)return;
    const matrix=inv.clone().multiply(o.matrixWorld);
    for(const x of [b.min.x,b.max.x])
      for(const y of [b.min.y,b.max.y])
        for(const z of [b.min.z,b.max.z])
          box.expandByPoint(corner.set(x,y,z).applyMatrix4(matrix));
  });
  return box;
}

export function floorStructuralTop(floor){
  if(!floor?.userData?.qdqrFloor)return null;
  let top=-Infinity;
  for(const child of floor.children){
    if(!child.userData?.qdqrStructural||child.userData?.qdqrStructuralCap)continue;
    const b=boundsInSpace(child,floor);
    if(!b.isEmpty())top=Math.max(top,b.max.y);
  }
  return Number.isFinite(top)?top:null;
}

export function floorBaseInHouse(floor){
  const house=floor?.parent;
  if(!house?.userData?.qdqrHouse)return null;
  const p=floor.localToWorld(new THREE.Vector3(0,0,0));
  return house.worldToLocal(p).y;
}

function topInHouse(floor){
  const localTop=floorStructuralTop(floor);
  if(localTop===null)return null;
  const house=floor.parent;
  const p=floor.localToWorld(new THREE.Vector3(0,localTop,0));
  return house.worldToLocal(p).y;
}

function overlapXZ(a,b){
  return Math.min(a.max.x,b.max.x)>Math.max(a.min.x,b.min.x)+1e-5 &&
    Math.min(a.max.z,b.max.z)>Math.max(a.min.z,b.min.z)+1e-5;
}

export function supportTopForModule(floor,module){
  if(!floor?.userData?.qdqrFloor)return null;
  floor.updateWorldMatrix(true,true);module?.updateWorldMatrix?.(true,true);
  const box=module?new THREE.Box3().setFromObject(module):null;
  let top=-Infinity;
  for(const child of floor.children){
    if(child===module||!child.userData?.qdqrSupportSurface)continue;
    const b=new THREE.Box3().setFromObject(child);
    if(b.isEmpty())continue;
    if(box&&!box.isEmpty()&&!overlapXZ(box,b))continue;
    top=Math.max(top,b.max.y);
  }
  if(Number.isFinite(top))return top;
  return floor.getWorldPosition(new THREE.Vector3()).y;
}

function moveBottomToWorldY(module,worldY){
  const box=new THREE.Box3().setFromObject(module);
  if(box.isEmpty()||!module.parent)return false;
  const delta=worldY-box.min.y;
  const parent=module.parent;
  const a=parent.worldToLocal(new THREE.Vector3(0,0,0));
  const b=parent.worldToLocal(new THREE.Vector3(0,delta,0));
  module.position.add(b.sub(a));module.updateWorldMatrix(true,true);
  return true;
}

export function createFloor(house){
  if(!house?.userData?.qdqrHouse)throw new Error('Сначала создайте дом');
  const floors=getFloors(house);
  if(floors.length>=12)throw new Error('Максимум 12 этажей в одном доме');
  const n=floors.length?Math.max(...floors.map(x=>x.userData.floorNumber))+1:1;
  let baseY=0;
  if(floors.length){
    const previous=floors[floors.length-1];
    const top=topInHouse(previous);
    if(top===null)
      throw new Error('Предыдущий этаж пуст. Сначала добавь пол, стены или другую конструкцию — высота следующего этажа берётся из реальной геометрии.');
    baseY=top;
  }
  const floor=new THREE.Group();
  floor.name='Этаж '+n;
  floor.userData.qdqrFloor=true;
  floor.userData.floorNumber=n;
  floor.userData.qdqrBaseMode='geometry';
  floor.position.y=baseY;
  house.add(floor);
  return floor;
}
export function createHouse(name='Новый дом'){
  const house=new THREE.Group();
  house.name=String(name||'Новый дом').trim().slice(0,72)||'Новый дом';
  house.userData.qdqrHouse=true;
  house.userData.qdqrStoryPlacement='geometry';
  createFloor(house);
  return house;
}

// Group.attach preserves world-space placement when transferring a part from
// outside the building. Optionally seat its world-space bounding box onto
// the selected story floor. This does not alter the mesh's geometry or UVs.
export function putOnFloor(floor,obj,{seat=true}={}){
  if(!floor?.userData?.qdqrFloor || !obj?.isObject3D)throw new Error('Не выбран этаж или модуль');
  for(let p=floor;p;p=p.parent)if(p===obj)throw new Error('Нельзя вложить родительскую группу в её потомка');
  if(floor===obj)throw new Error('Нельзя поместить этаж в себя');
  floor.updateWorldMatrix(true,true);
  floor.attach(obj);
  if(seat)moveBottomToWorldY(obj,supportTopForModule(floor,obj));
  obj.updateWorldMatrix(true,true);
  return obj;
}

export function addPresetToFloor(floor,type,material,snap=.25,{preferred=null,autoDock=true,stackOn=null}={}){
  if(!floor?.userData?.qdqrFloor)throw new Error('Выберите этаж');
  if(!Number.isFinite(snap)||snap<=0)throw new Error('Неверный шаг привязки');
  const module=createConstruction(type,material);
  const others=floor.children.filter(o=>o.visible);
  const lateralOthers=others.filter(o=>!o.userData?.qdqrSupportSurface&&!o.userData?.qdqrStructuralCap);
  floor.add(module);
  floor.updateWorldMatrix(true,true);

  // Same-story wall chain still uses endpoint sockets.
  if(module.userData.qdqrWallSockets && autoDock){
    const localPreferred=preferred?.parent===floor?preferred:null;
    const join=dockNewModule(module,floor,{preferred:localPreferred});
    if(join){
      module.userData.qdqrLastJoin={kind:'horizontal',targetName:join.anchor.name,error:join.error};
      return module;
    }
  }

  // A selected wall from the story below is a vertical anchor, never an
  // instruction to place the new wall beside it.
  if(isStackableModule(module)&&stackOn){
    const targetBox=new THREE.Box3().setFromObject(stackOn);
    const support=supportTopForModule(floor,module);
    const desired=Math.max(targetBox.isEmpty()?-Infinity:targetBox.max.y,support??-Infinity);
    const join=stackModuleOn(module,stackOn,{supportY:Number.isFinite(desired)?desired:null});
    if(join){
      module.userData.qdqrLastJoin={kind:'vertical',targetName:join.anchor.name,error:join.error};
      return module;
    }
  }

  // First module on a new story can find the wall directly below by geometry.
  if(isStackableModule(module)&&floor.userData.floorNumber>1){
    const support=supportTopForModule(floor,module);
    const join=snapVerticalModule(module,floor.parent||floor,{
      verticalThreshold:.8,horizontalThreshold:1.0,supportY:support
    });
    if(join){
      module.userData.qdqrLastJoin={kind:'vertical',targetName:join.anchor.name,error:join.error};
      return module;
    }
  }

  // Floor slabs are support surfaces. Walls/columns added after a slab sit on
  // its real top face, including slab thickness.
  if(module.userData.qdqrStructural&&!module.userData.qdqrSupportSurface&&!module.userData.qdqrStructuralCap){
    moveBottomToWorldY(module,supportTopForModule(floor,module));
  }

  const ownBox=new THREE.Box3().setFromObject(module);
  const localMin=floor.worldToLocal(ownBox.min.clone());
  const localMax=floor.worldToLocal(ownBox.max.clone());
  if(lateralOthers.length){
    let maxX=-Infinity;
    for(const obj of lateralOthers){
      const bounds=new THREE.Box3().setFromObject(obj);
      if(bounds.isEmpty())continue;
      maxX=Math.max(maxX,floor.worldToLocal(bounds.max.clone()).x);
    }
    if(Number.isFinite(maxX)){
      const shift=Math.ceil((maxX-localMin.x)/snap)*snap;
      module.position.x+=shift;
    }
  }else{
    module.position.x=Math.round((-0.5*(localMin.x+localMax.x))/snap)*snap;
  }
  return module;
}


/** An imported door/window frame fits a ready wall opening without moving
 *  or deforming the stone segment. The imported model remains separately
 *  editable under the chosen door/window construction module.
 *  Exact model-relative orientation/oversized decorative projections may
 *  need manual adjustment afterward.
 */
export function fitInsertToOpening(floor,insert,{margin=.04}={}){
  if(!floor?.userData?.qdqrFloor||!insert?.isObject3D)
    throw new Error('Выбери этаж и вставляемую раму или дверь');
  if(insert.userData?.qdqrBuildType||insert.userData?.qdqrWallSockets||insert.userData?.qdqrHouse||insert.userData?.qdqrFloor)
    throw new Error('Выбери именно отдельную раму, дверь или оконную модель');
  const targets=[];
  floor.traverse(o=>{
    if(o.userData?.qdqrOpening && o!==insert)targets.push(o);
  });
  if(!targets.length)throw new Error('На этаже нет стены с готовым проёмом');
  const insertedBox=new THREE.Box3().setFromObject(insert);
  if(insertedBox.isEmpty())throw new Error('В выбранной модели нет геометрии');
  const center=insertedBox.getCenter(new THREE.Vector3());
  let target=null,best=Infinity;
  for(const module of targets){
    module.updateWorldMatrix(true,false);
    const meta=module.userData.qdqrOpening;
    const c=new THREE.Vector3(meta.centerX,meta.centerY,0).applyMatrix4(module.matrixWorld);
    const d=c.distanceTo(center);
    if(d<best){target=module;best=d;}
  }
  if(!target)throw new Error('Не найден проём');
  // Don't attach an ancestor to its own descendant.
  for(let p=target;p;p=p.parent)if(p===insert)throw new Error('Нельзя вставить здание в его собственную стену');
  target.attach(insert);
  // Reset group orientation to face the wall local XY plane.
  insert.quaternion.identity();
  insert.scale.set(1,1,1);
  insert.position.set(0,0,0);
  target.updateWorldMatrix(true,true);
  function relativeBounds(){
    const box=new THREE.Box3().makeEmpty(),inv=target.matrixWorld.clone().invert();
    const corner=new THREE.Vector3();
    insert.traverse(o=>{
      if(!o.isMesh||!o.geometry?.getAttribute('position'))return;
      o.updateWorldMatrix(true,false);
      o.geometry.computeBoundingBox();
      const b=o.geometry.boundingBox,m=inv.clone().multiply(o.matrixWorld);
      if(!b)return;
      for(const x of [b.min.x,b.max.x])
        for(const y of [b.min.y,b.max.y])
          for(const z of [b.min.z,b.max.z])
            box.expandByPoint(corner.set(x,y,z).applyMatrix4(m));
    });
    return box;
  }
  let box=relativeBounds();
  const sz=box.getSize(new THREE.Vector3());
  if(sz.x<.0001||sz.y<.0001)throw new Error('У рамы или двери неправильные габариты');
  // A frame made in the YZ plane is often imported side-on.
  if(sz.x<sz.z*.5){insert.rotation.y=Math.PI/2;insert.updateWorldMatrix(true,true);box=relativeBounds();}
  const dims=box.getSize(new THREE.Vector3()),opening=target.userData.qdqrOpening;
  const fit=Math.min((opening.width-margin)/Math.max(dims.x,.001),
    (opening.height-margin)/Math.max(dims.y,.001));
  if(!Number.isFinite(fit)||fit<=0)throw new Error('Размер проёма не подходит');
  insert.scale.multiplyScalar(fit);
  insert.updateWorldMatrix(true,true);
  box=relativeBounds();
  const pos=box.getCenter(new THREE.Vector3());
  insert.position.add(new THREE.Vector3(opening.centerX-pos.x,opening.centerY-pos.y,-pos.z));
  insert.name=insert.name||'Вставленная рама';
  insert.userData.qdqrInstalledInOpening=true;
  return {module:target,fit,error:new THREE.Vector2(
    opening.centerX,opening.centerY
  ).distanceTo(new THREE.Vector2(
    box.getCenter(new THREE.Vector3()).x+insert.position.x,
    box.getCenter(new THREE.Vector3()).y+insert.position.y
  ))};
}

export function setFloorVisibility(house,chosen,{isolate=false}={}){
  const floors=getFloors(house);
  if(!floors.includes(chosen))throw new Error('Этаж не относится к этому дому');
  for(const floor of floors)floor.visible=(!isolate||floor===chosen);
  return floors;
}
