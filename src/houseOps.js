import * as THREE from 'three';
import {createConstruction} from './meshOps.js';

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

export function addPresetToFloor(floor,type,material,snap=.25){
  if(!floor?.userData?.qdqrFloor)throw new Error('Выберите этаж');
  if(!Number.isFinite(snap)||snap<=0)throw new Error('Неверный шаг привязки');
  const module=createConstruction(type,material);
  const others=floor.children.filter(o=>o.visible);
  floor.add(module);
  floor.updateWorldMatrix(true,true);
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

export function setFloorVisibility(house,chosen,{isolate=false}={}){
  const floors=getFloors(house);
  if(!floors.includes(chosen))throw new Error('Этаж не относится к этому дому');
  for(const floor of floors)floor.visible=(!isolate||floor===chosen);
  return floors;
}
