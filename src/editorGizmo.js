import * as THREE from 'three';

// TransformControls manipulates this centered proxy, not an imported mesh's
// arbitrary authoring origin or a curved wall's connection socket.
export function selectionGizmoPose(object){
  if(!object?.parent)throw new Error('Выбери объект, принадлежащий сцене');
  object.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(object);
  const center=box.isEmpty()
    ?object.getWorldPosition(new THREE.Vector3())
    :box.getCenter(new THREE.Vector3());
  return {
    position:center,
    quaternion:object.getWorldQuaternion(new THREE.Quaternion())
  };
}
export function applyCenteredGizmo(object,currentPivotMatrix,initialPivotMatrix,initialObjectMatrix,parentInverse){
  if(!object?.parent)throw new Error('Выбранный объект больше не находится в сцене');
  const delta=currentPivotMatrix.clone().multiply(initialPivotMatrix.clone().invert());
  const local=parentInverse.clone().multiply(delta).multiply(initialObjectMatrix);
  local.decompose(object.position,object.quaternion,object.scale);
  object.updateWorldMatrix(true,true);
  return object;
}
