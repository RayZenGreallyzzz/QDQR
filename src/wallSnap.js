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
function allWallModules(container){
  const items=[];
  container.traverse(x=>{if(x!==container && isWallModule(x))items.push(x);});
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
  // Rotate about world Y so the socket normals face each other.
  movable.updateWorldMatrix(true,false);
  const desired=target.outward.clone().negate();
  // THREE positive Y rotation turns +X towards -Z, opposite to atan2(z,x).
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
    at:target.point.clone(),
    socket:source.index,
    anchor:target.module,
    error:moduleSockets(movable)[source.index].point.distanceTo(target.point)
  };
}
// Build a new wall-like segment at the next free end of an existing module.
// The mesh's centerline, not bounding-box outer edge, is aligned.
export function dockNewModule(module,floor,{preferred=null}={}){
  if(!isWallModule(module))return null;
  const candidates=allWallModules(floor).filter(x=>x!==module);
  const ordered=preferred&&candidates.includes(preferred)
    ?[preferred,...candidates.filter(c=>c!==preferred).reverse()]
    :candidates.reverse();
  for(const m of ordered){
    const sockets=moduleSockets(m);
    // Prefer the far/end socket (B) to extend the current chain.
    for(const s of [sockets[1],sockets[0]]){
      if(occupyingSocket(s,candidates,module))continue;
      // Every built-in module starts at socket A, including round corners.
      const own=moduleSockets(module)[0];
      if(Math.abs(s.thickness-own.thickness)>.03)continue;
      return alignSockets(module,own,s);
    }
  }
  return null;
}
// Dragged modules only snap when close to an unoccupied endpoint. No jumps
// across the scene, and no snapping non-building decor, imports or furniture.
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
