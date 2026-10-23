import * as THREE from 'three';
import {createConstruction} from './meshOps.js';
import {dockNewModule} from './wallSnap.js';

export function getFloors(house){
  if(!house?.userData?.qdqrHouse)return [];
  return house.children.filter(o=>o.isGroup&&o.userData?.qdqrFloor).sort((a,b)=>a.userData.floorNumber-b.userData.floorNumber);
}

export function createFloor(house){
  if(!house?.userData?.qdqrHouse)throw new Error('Сначала создайте дом');
  const floors=getFloors(house);
  if(floors.length>=12)throw new Error('Максимум 12 этажей в одном доме');
  const n=floors.length?Math.max(...floors.map(x=>x.userData.floorNumber))+1:1;
  const height=Number(house.userData.floorHeight);
  if(!Number.isFinite(height)||height<1.8||height>10)throw new Error('Неверная высота этажа');
  const floor=new THREE.Group();
  floor.name='Этаж '+n;
  floor.userData.qdqrFloor=true;
  floor.userData.floorNumber=n;
  floor.position.y=(n-1)*height;
  house.add(floor);
  return floor;
}
export function createHouse(name='Новый дом',floorHeight=3){
  if(!Number.isFinite(floorHeight)||floorHeight<1.8||floorHeight>10)
    throw new Error('Высота этажа: от 1,8 до 10 метров');
  const house=new THREE.Group();
  house.name=String(name||'Новый дом').trim().slice(0,72)||'Новый дом';
  house.userData.qdqrHouse=true;
  house.userData.floorHeight=floorHeight;
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
  if(seat){
    const box=new THREE.Box3().setFromObject(obj);
    if(!box.isEmpty()){
      const desired=floor.getWorldPosition(new THREE.Vector3()).y;
      const offset=desired-box.min.y;
      const local0=floor.worldToLocal(new THREE.Vector3(0,0,0));
      const local1=floor.worldToLocal(new THREE.Vector3(0,offset,0));
      obj.position.add(local1.sub(local0));
    }
  }
  obj.updateWorldMatrix(true,true);
  return obj;
}

export function addPresetToFloor(floor,type,material,snap=.25,{preferred=null,autoDock=true}={}){
  if(!floor?.userData?.qdqrFloor)throw new Error('Выберите этаж');
  if(!Number.isFinite(snap)||snap<=0)throw new Error('Неверный шаг привязки');
  const module=createConstruction(type,material);
  const others=floor.children.filter(o=>o.visible);
  floor.add(module);
  floor.updateWorldMatrix(true,true);
  // Actual wall centerline sockets are authoritative. No BBox edge snap for
  // straight walls, doors/windows and 90-degree curved corners.
  if(module.userData.qdqrWallSockets && autoDock){
    const join=dockNewModule(module,floor,{preferred});
    if(join){
      module.userData.qdqrLastJoin={
        targetName:join.anchor.name,
        error:join.error
      };
      return module;
    }
    if(!others.length)return module;
  }
  const ownBox=new THREE.Box3().setFromObject(module);
  const localMin=floor.worldToLocal(ownBox.min.clone());
  const localMax=floor.worldToLocal(ownBox.max.clone());
  if(others.length){
    let maxX=-Infinity;
    for(const obj of others){
      const bounds=new THREE.Box3().setFromObject(obj);
      if(bounds.isEmpty())continue;
      maxX=Math.max(maxX,floor.worldToLocal(bounds.max.clone()).x);
    }
    if(Number.isFinite(maxX)){
      const shift=Math.ceil((maxX-localMin.x)/snap)*snap;
      module.position.x+=shift;
    }
  }else{
    // Keep the first module near the house origin.
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
  if(insert.userData?.qdqrWallSockets||insert.userData?.qdqrHouse||insert.userData?.qdqrFloor)
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
