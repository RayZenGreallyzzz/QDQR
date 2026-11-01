import * as THREE from 'three';

const P=e=>new THREE.Vector3(e[0],e[1],e[2]);
const TOL=.055;

export function moduleSockets(module){
  const list=module?.userData?.qdqrWallSockets;
  if(!Array.isArray(list)||list.length!==2)return [];
  module.updateWorldMatrix(true,false);
  return list.map((s,index)=>({
    index,id:s.id,
    point:P(s.point).applyMatrix4(module.matrixWorld),
    outward:P(s.outward).transformDirection(module.matrixWorld),
    thickness:Number(s.thickness)||.25,
    module
  }));
}
export function isWallModule(module){
  return moduleSockets(module).length===2;
}
export function isStackableModule(module){
  return !!module?.userData?.qdqrStackClass;
}
function allWallModules(container){
  const items=[];
  container?.traverse(x=>{if(x!==container && isWallModule(x))items.push(x);});
  return items;
}
function allStackableModules(container){
  const items=[];
  container?.traverse(x=>{if(x!==container && isStackableModule(x))items.push(x);});
  return items;
}
function occupyingSocket(target,modules,except){
  for(const other of modules){
    if(other===target.module||other===except)continue;
    for(const candidate of moduleSockets(other)){
      if(candidate.point.distanceTo(target.point)<TOL&&
         candidate.outward.dot(target.outward)<-.85)return true;
    }
  }
  return false;
}
function alignSockets(movable,source,target){
  if(!movable.parent)throw new Error('У новой детали нет родителя');
  movable.updateWorldMatrix(true,false);
  const desired=target.outward.clone().negate();
  const angle=Math.atan2(source.outward.z,source.outward.x)-Math.atan2(desired.z,desired.x);
  const qYaw=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle);
  const worldQuat=movable.getWorldQuaternion(new THREE.Quaternion());
  const parentQuat=movable.parent.getWorldQuaternion(new THREE.Quaternion());
  movable.quaternion.copy(parentQuat.invert().multiply(qYaw).multiply(worldQuat));
  movable.updateWorldMatrix(true,false);
  const moved=moduleSockets(movable)[source.index];
  const parent=movable.parent;
  const a=parent.worldToLocal(target.point.clone());
  const b=parent.worldToLocal(moved.point.clone());
  movable.position.add(a.sub(b));
  movable.updateWorldMatrix(true,false);
  return {
    kind:'horizontal',
    at:target.point.clone(),
    socket:source.index,
    anchor:target.module,
    error:moduleSockets(movable)[source.index].point.distanceTo(target.point)
  };
}

function worldDeltaToParentLocal(parent,delta){
  const a=parent.worldToLocal(new THREE.Vector3(0,0,0));
  const b=parent.worldToLocal(delta.clone());
  return b.sub(a);
}
function copyWorldOrientation(movable,target){
  if(!movable.parent)throw new Error('У новой детали нет родителя');
  target.updateWorldMatrix(true,false);
  const targetWorld=target.getWorldQuaternion(new THREE.Quaternion());
  const parentWorld=movable.parent.getWorldQuaternion(new THREE.Quaternion());
  movable.quaternion.copy(parentWorld.invert().multiply(targetWorld));
  movable.updateWorldMatrix(true,false);
}
function verticalCompatible(movable,target){
  const a=movable?.userData?.qdqrStackClass;
  const b=target?.userData?.qdqrStackClass;
  return !!a&&a===b;
}

// Stack one construction module directly on the top face of another.
// Alignment is based on actual world geometry: no 2.6m/3m story constant is used.
export function stackModuleOn(movable,target,{supportY=null}={}){
  if(!movable?.parent||!target||movable===target||!verticalCompatible(movable,target))return null;
  copyWorldOrientation(movable,target);
  movable.updateWorldMatrix(true,true);
  target.updateWorldMatrix(true,true);
  const targetBox=new THREE.Box3().setFromObject(target);
  const movingBox=new THREE.Box3().setFromObject(movable);
  if(targetBox.isEmpty()||movingBox.isEmpty())return null;
  const targetOrigin=target.getWorldPosition(new THREE.Vector3());
  const movingOrigin=movable.getWorldPosition(new THREE.Vector3());
  const desiredBottom=Number.isFinite(Number(supportY))?Number(supportY):targetBox.max.y;
  const delta=new THREE.Vector3(
    targetOrigin.x-movingOrigin.x,
    desiredBottom-movingBox.min.y,
    targetOrigin.z-movingOrigin.z
  );
  movable.position.add(worldDeltaToParentLocal(movable.parent,delta));
  movable.updateWorldMatrix(true,true);
  const after=new THREE.Box3().setFromObject(movable);
  return {
    kind:'vertical',
    anchor:target,
    at:new THREE.Vector3(targetOrigin.x,desiredBottom,targetOrigin.z),
    error:Math.abs(after.min.y-desiredBottom)
  };
}

// Magnet for the top/bottom story seam. It only engages when the module is
// already close in X/Z and its bottom is near the target's actual top face.
export function snapVerticalModule(module,container,{verticalThreshold=.7,horizontalThreshold=.8,supportY=null}={}){
  if(!isStackableModule(module)||!container)return null;
  module.updateWorldMatrix(true,true);
  const movingBox=new THREE.Box3().setFromObject(module);
  if(movingBox.isEmpty())return null;
  const movingOrigin=module.getWorldPosition(new THREE.Vector3());
  let best=null;
  for(const target of allStackableModules(container)){
    if(target===module||!verticalCompatible(module,target))continue;
    // Never stack a parent onto its own descendant or vice versa.
    let related=false;
    for(let p=target;p;p=p.parent)if(p===module)related=true;
    for(let p=module;p;p=p.parent)if(p===target)related=true;
    if(related)continue;
    target.updateWorldMatrix(true,true);
    const box=new THREE.Box3().setFromObject(target);
    if(box.isEmpty())continue;
    const origin=target.getWorldPosition(new THREE.Vector3());
    const horizontal=Math.hypot(movingOrigin.x-origin.x,movingOrigin.z-origin.z);
    if(horizontal>horizontalThreshold)continue;
    const desiredBottom=Number.isFinite(Number(supportY))?Number(supportY):box.max.y;
    const vertical=Math.abs(movingBox.min.y-desiredBottom);
    if(vertical>verticalThreshold)continue;
    const score=vertical+horizontal*.35;
    if(!best||score<best.score)best={target,score,desiredBottom};
  }
  return best?stackModuleOn(module,best.target,{supportY:best.desiredBottom}):null;
}

// Build a new wall-like segment at the next free end of an existing module.
export function dockNewModule(module,floor,{preferred=null}={}){
  if(!isWallModule(module))return null;
  const candidates=allWallModules(floor).filter(x=>x!==module);
  const ordered=preferred&&candidates.includes(preferred)
    ?[preferred,...candidates.filter(c=>c!==preferred).reverse()]
    :candidates.reverse();
  for(const m of ordered){
    const sockets=moduleSockets(m);
    for(const s of [sockets[1],sockets[0]]){
      if(occupyingSocket(s,candidates,module))continue;
      const own=moduleSockets(module)[0];
      if(Math.abs(s.thickness-own.thickness)>.03)continue;
      return alignSockets(module,own,s);
    }
  }
  return null;
}

export function locateWallModule(object){
  for(let p=object;p;p=p.parent){
    if(p.userData?.qdqrWallSockets && p.isGroup)return p;
  }
  return null;
}
export function locateBuildModule(object){
  for(let p=object;p;p=p.parent){
    if((p.userData?.qdqrStackClass||p.userData?.qdqrWallSockets)&&p.isGroup)return p;
  }
  return null;
}

// Non-building modules still spawn beside the current workpiece. Cross-story
// wall stacking is deliberately NOT handled here; use stackModuleOn().
export function placeAdjacentTo(module,reference,{gap=.08}={}){
  if(!module?.parent || !reference || module===reference)return false;
  module.parent.updateWorldMatrix(true,true);
  reference.updateWorldMatrix(true,true);
  const a=new THREE.Box3().setFromObject(reference);
  const b=new THREE.Box3().setFromObject(module);
  if(a.isEmpty()||b.isEmpty())return false;
  const moveWorld=new THREE.Vector3(
    a.max.x-b.min.x+gap,
    a.min.y-b.min.y,
    a.getCenter(new THREE.Vector3()).z-b.getCenter(new THREE.Vector3()).z
  );
  module.position.add(worldDeltaToParentLocal(module.parent,moveWorld));
  module.updateWorldMatrix(true,true);
  return true;
}

export function snapNearbyModule(module,container,{threshold=.48}={}){
  if(!isWallModule(module))return null;
  const candidates=allWallModules(container).filter(x=>x!==module);
  let best=null;
  for(const current of moduleSockets(module)){
    for(const targetModule of candidates){
      for(const anchor of moduleSockets(targetModule)){
        const d=current.point.distanceTo(anchor.point);
        if(d>threshold || (best && d>=best.d))continue;
        if(occupyingSocket(anchor,candidates,module))continue;
        if(Math.abs(anchor.thickness-current.thickness)>.03)continue;
        best={current,anchor,d};
      }
    }
  }
  return best?alignSockets(module,best.current,best.anchor):null;
}
export function socketsConnectionError(a,b){
  const ap=moduleSockets(a),bp=moduleSockets(b);
  let closest=Infinity,heading=1;
  for(const x of ap)for(const y of bp){
    const d=x.point.distanceTo(y.point);
    if(d<closest){closest=d;heading=x.outward.dot(y.outward);}
  }
  return {distance:closest,alignment:heading};
}
