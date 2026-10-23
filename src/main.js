
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {OBJExporter} from 'three/addons/exporters/OBJExporter.js';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {bendGeometry, cleanDegenerate, cropGeometry, removeSmallIslands, splitGeometryIslands, removePickedFaces, countTriangles, createConstruction} from './meshOps.js';
import {bakeStaticAssembly} from './assemblyOps.js';
import {projectTextureToWall,attachDecorToWall} from './surfaceOps.js';
import {captureFrameSilhouette,buildGlassPieces} from './glassOps.js';
import {createOpeningGeometry,getWallBounds,defaultOpening,cutWallOpening,makeOpeningTrim} from './openingOps.js';
import {createHouse,createFloor,getFloors,putOnFloor,addPresetToFloor,setFloorVisibility,fitInsertToOpening} from './houseOps.js';
import {dockNewModule,snapNearbyModule,isWallModule,locateWallModule,placeAdjacentTo} from './wallSnap.js';

const $=id=>document.getElementById(id);
const viewport=$('viewport');
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x17202c);
const camera=new THREE.PerspectiveCamera(48,1,.03,1500);camera.position.set(6,4.4,7);
const lowMemoryMobile=window.matchMedia('(pointer: coarse)').matches;
const renderer=new THREE.WebGLRenderer({antialias:!lowMemoryMobile,preserveDrawingBuffer:true,powerPreference:lowMemoryMobile?'low-power':'high-performance'});
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.35;
renderer.setPixelRatio(Math.min(devicePixelRatio||1,lowMemoryMobile?1.1:1.7));
viewport.appendChild(renderer.domElement);
const orbit=new OrbitControls(camera,renderer.domElement);
orbit.enableDamping=true; orbit.dampingFactor=.09;
orbit.screenSpacePanning=true; orbit.enablePan=true; orbit.panSpeed=1.15; orbit.minDistance=.07; orbit.maxDistance=250;
let cameraNavMode='orbit';
function setCameraNavigation(mode){
 cameraNavMode=mode==='pan'?'pan':'orbit';
 orbit.mouseButtons.LEFT=cameraNavMode==='pan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;
 orbit.mouseButtons.MIDDLE=THREE.MOUSE.DOLLY;orbit.mouseButtons.RIGHT=THREE.MOUSE.PAN;
 orbit.touches.ONE=cameraNavMode==='pan'?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;
 orbit.touches.TWO=THREE.TOUCH.DOLLY_PAN;
 $('cameraOrbit').classList.toggle('active',cameraNavMode==='orbit');
 $('cameraPan').classList.toggle('active',cameraNavMode==='pan');
 $('cameraOrbit').setAttribute('aria-pressed',String(cameraNavMode==='orbit'));
 $('cameraPan').setAttribute('aria-pressed',String(cameraNavMode==='pan'));
 setStatus(cameraNavMode==='pan'?'Камера: перемещение одним пальцем · двумя масштаб':'Камера: вращение одним пальцем · двумя сдвиг и масштаб');
}
scene.add(new THREE.HemisphereLight(0xc2deff,0x4d382b,2.2));
const key=new THREE.DirectionalLight(0xffe4bd,3.2);key.position.set(7,12,9);scene.add(key);
const fill=new THREE.DirectionalLight(0x8baeea,1.2);fill.position.set(-7,6,-8);scene.add(fill);
const grid=new THREE.GridHelper(80,160,0x52647a,0x344254);grid.position.y=-.004;scene.add(grid);
const root=new THREE.Group();root.name='Редактируемые модели';scene.add(root);
const transform=new TransformControls(camera,renderer.domElement);
scene.add(transform.getHelper());
// The visible gizmo is NOT attached to the raw model origin. Curved wall
// origins are at their connection sockets and can be metres from the mesh.
const gizmoPivot=new THREE.Object3D();
gizmoPivot.name='Редактор · центр выделения';
scene.add(gizmoPivot);
let dragInitialPivot=null,dragInitialWorld=null,dragParentInverse=null;
let selected=null,selectionBox=new THREE.BoxHelper(new THREE.Object3D(),0xe5b965);
selectionBox.visible=false;scene.add(selectionBox);
const faceOverlay=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({
  color:0xf8bc54,transparent:true,opacity:.58,depthWrite:false,polygonOffset:true,
  polygonOffsetFactor:-3,side:THREE.DoubleSide
}));
faceOverlay.name='Редактор: выделенные грани';faceOverlay.visible=false;faceOverlay.renderOrder=999;
faceOverlay.matrixAutoUpdate=false;scene.add(faceOverlay);
let facePickEnabled=false,markedFaces=new Set();
let savedWallBase=null,imagePickMode='separate';
let glassSource=null,glassScan=null,glassPreview=null,glassKind='colored';
let glassSelectedIds=new Set();
let openingKind='door',openingTarget=null,openingSpec=null,openingActive=false,openingDragging=false;
const openingGhost=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({
  color:0xf0bd5c,opacity:.34,transparent:true,depthWrite:false,
  side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2
}));
openingGhost.renderOrder=999;
openingGhost.matrixAutoUpdate=false;openingGhost.visible=false;scene.add(openingGhost);
const openingEdges=new THREE.LineSegments(
  new THREE.EdgesGeometry(openingGhost.geometry),
  new THREE.LineBasicMaterial({color:0xffdc8b,depthTest:false})
);
openingGhost.add(openingEdges);
let mode='translate',fileBase='phoenix_module',history=[],future=[],isolate=false,dragged=false,busy=false;
const lastFiles=[];
const pointer=new THREE.Vector2(),raycaster=new THREE.Raycaster();
let toastTimer;
function notify(message,error=false){$('toast').textContent=message;$('toast').style.borderColor=error?'#df7676':'#719ac0';$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4300);}
function setStatus(s){$('status').textContent=s;}
function safeName(s){return (s||'phoenix_asset').replace(/[^a-zа-яё0-9_.-]+/gi,'_').slice(0,70);}
function mat(color='#8c7767'){return new THREE.MeshStandardMaterial({color,roughness:.75,metalness:.12,side:THREE.DoubleSide});}
function cloneDeep(obj) {
  const c=obj.clone(true);
  c.traverse(o=>{
    if(!o.isMesh)return;
    if(o.geometry)o.geometry=o.geometry.clone();
    if(Array.isArray(o.material))o.material=o.material.map(m=>m.clone());
    else if(o.material)o.material=o.material.clone();
  });
  return c;
}
function snapshot(){
  history.push(cloneDeep(root));const maxUndo=countTriangles(root).triangles>60000?2:6;if(history.length>maxUndo)history.splice(0,history.length-maxUndo);
  future=[];
}
function restore(snap){
  clearGlassPreview({hidePanel:true});
  if(openingActive)stopOpening({silent:true});
  setFacePickMode(false);markedFaces.clear();updateFaceOverlay();
  transform.detach();selected=null;root.clear();
  const c=cloneDeep(snap);while(c.children.length)root.add(c.children[0]);
  isolate=false;selectionBox.visible=false;
  refresh();
}
function undo(){if(!history.length)return notify('История пуста');future.push(cloneDeep(root));restore(history.pop());notify('Действие отменено');}
function redo(){if(!future.length)return notify('Нечего вернуть');history.push(cloneDeep(root));restore(future.pop());notify('Действие восстановлено');}
function fitCamera(){
  const box=new THREE.Box3().setFromObject(root);
  if(box.isEmpty()){orbit.target.set(0,1,0);camera.position.set(6,4.4,7);}
  else{
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const d=Math.max(size.x,size.y,size.z,.3);
    orbit.target.copy(center);
    camera.position.set(center.x+d*1.5,center.y+d*.95,center.z+d*1.8);
    camera.near=Math.max(.005,d/1000);camera.far=Math.max(200,d*100);camera.updateProjectionMatrix();
  }
  orbit.update();
}
function focusSelected(){
 if(!selected)return notify('Сначала выбери деталь или набор',true);
 const box=new THREE.Box3().setFromObject(selected);if(box.isEmpty())return;
 const center=box.getCenter(new THREE.Vector3()), offset=camera.position.clone().sub(orbit.target);
 offset.setLength(Math.max(box.getSize(new THREE.Vector3()).length()*1.15,.65));
 camera.position.copy(center).add(offset);orbit.target.copy(center);orbit.update();
 notify('Камера наведена на '+(selected.name||'объект'));
}
function view(axis) {
  const center=orbit.target.clone(),d=Math.max(camera.position.distanceTo(center),3);
  if(axis==='front')camera.position.set(center.x,center.y,center.z+d);
  if(axis==='side')camera.position.set(center.x+d,center.y,center.z);
  if(axis==='top')camera.position.set(center.x,center.y+d,center.z+.001);
  camera.lookAt(center);orbit.update();
}
function topLevelObject(obj){
 if(!obj||obj===root)return null;
 while(obj.parent&&obj.parent!==root)obj=obj.parent;
 return obj.parent===root?obj:null;
}
function pendingBatch(){
 const selectedBatch=topLevelObject(selected);
 if(selectedBatch)return selectedBatch;
 for(let i=root.children.length-1;i>=0;i--)if(root.children[i].userData?.importBatch)return root.children[i];
 return null;
}
function deleteBatch(batch=pendingBatch()){
 clearGlassPreview({hidePanel:true});
 if(openingActive)stopOpening({silent:true});
 if(!batch)return notify('Выбери набор в разделе «Сцена»',true);
 const label=batch.name||'Набор';
 if(!window.confirm('Удалить весь набор «'+label+'» со всеми деталями? Другие объекты останутся.'))return;
 setFacePickMode(false);clearMarkedFaces();
 snapshot();
 if(selected && (selected===batch||batch.getObjectById(selected.id))){
   transform.detach();selected=null;selectionBox.visible=false;
 }
 batch.removeFromParent();if(!root.children.length)fileBase='phoenix_module';
 fitCamera();refresh();notify('Удалён набор «'+label+'». Можно отменить.');
}
function refresh(){
  const stat=countTriangles(root);
  $('stats').textContent=stat.triangles.toLocaleString('ru-RU')+' трис · '+stat.meshes+' мешей';
  $('objectCount').textContent=String(stat.meshes);
  $('deleteBatchBtn').disabled=!pendingBatch();
  $('clearSceneBtn').disabled=!root.children.length;
  $('objectTree').replaceChildren();
  for(const batch of root.children){
    const row=document.createElement('div');row.className='tree-row';
    const b=document.createElement('button');b.className='node'+(batch===selected?' selected':'');
    b.textContent='▣ '+(batch.name||'Набор');
    b.title='Выбрать весь набор';b.onclick=()=>select(batch);row.append(b);
    const del=document.createElement('button');del.className='tree-delete warn';del.textContent='×';
    del.title='Удалить весь этот набор';
    del.setAttribute('aria-label','Удалить '+(batch.name||'набор'));
    del.onclick=()=>deleteBatch(batch);row.append(del);
    $('objectTree').append(row);
  }
  if(stat.meshes===0)$('objectTree').innerHTML='<div class="empty">Нажми «Импорт» или выбери модуль</div>';
  let idx=0;
  root.traverse(o=>{
    if(!o.isMesh)return;
    if(idx++>249)return;
    const b=document.createElement('button');
    b.className='node'+(o===selected?' selected':'');
    const name=document.createElement('span');name.textContent=o.name||'Mesh';
    const typ=document.createElement('span');typ.className='tag';typ.textContent=o.visible?'●':'○';
    b.append(name,typ);b.addEventListener('click',()=>select(o));
    $('objectTree').append(b);
  });
  if(idx>250){const p=document.createElement('div');p.className='hint';p.textContent='Показаны первые 250 объектов';$('objectTree').append(p);}
  updateProperties();
  refreshAssemblyTargets();
  refreshHouseTargets();
}
function syncSelectionGizmo({attach=true}={}){
  if(!selected || !selected.parent)return;
  selected.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(selected);
  if(box.isEmpty())selected.getWorldPosition(gizmoPivot.position);
  else box.getCenter(gizmoPivot.position);
  selected.getWorldQuaternion(gizmoPivot.quaternion);
  gizmoPivot.scale.set(1,1,1);
  gizmoPivot.updateMatrixWorld(true);
  if(attach&&!facePickEnabled&&!openingActive)transform.attach(gizmoPivot);
}
function select(obj){
  if(obj && !obj.isMesh && !obj.isGroup)return;
  if(selected!==obj){markedFaces.clear();updateFaceOverlay();}
  selected=obj;transform.detach();
  if(obj){
    syncSelectionGizmo();
    selectionBox.setFromObject(obj);selectionBox.visible=!facePickEnabled&&!openingActive;
  } else selectionBox.visible=false;
  updateFaceOverlay();refresh();
}
function updateProperties(){
  const o=selected;
  $('selectedName').textContent=o?(o.name||'Mesh'):'Ничего не выбрано';
  $('objectName').value=o?(o.name||'Mesh'):'';
  const fields=['posX','posY','posZ','scaleX','scaleY','scaleZ'];
  const values=o?[o.position.x,o.position.y,o.position.z,o.scale.x,o.scale.y,o.scale.z]:['','','','','',''];
  fields.forEach((f,i)=>$(f).value=values[i]===''?'':Number(values[i].toFixed(3)));
  if(o){
    const s=new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    ['dimX','dimY','dimZ'].forEach((name,i)=>$(name).value=Number(s.getComponent(i).toFixed(3)));
  }
}

function refreshAssemblyTargets(){
  const input=$('assemblyTarget');
  const previous=input.value;
  const candidates=root.children.filter(o=>o.userData?.qdqrAssembly && o.isGroup);
  input.replaceChildren();
  for(const assembly of candidates){
    const option=document.createElement('option');
    option.value=assembly.uuid;option.textContent=assembly.name;
    input.append(option);
  }
  if(candidates.length){
    const preferred=candidates.find(o=>o.uuid===previous)||candidates[candidates.length-1];
    input.value=preferred.uuid;
  }else{
    const option=document.createElement('option');option.value='';option.textContent='Сначала создай сборку';input.append(option);
  }
  $('addAssemblyBtn').disabled=!candidates.length;
  $('bakeAssemblyBtn').disabled=!candidates.length;
  $('saveModuleBtn').disabled=!selected;
}
function currentAssembly(){
  const uuid=$('assemblyTarget').value;
  return root.children.find(o=>o.uuid===uuid && o.userData?.qdqrAssembly)||null;
}
function createAssembly(){
  if(facePickEnabled)setFacePickMode(false);
  const name=$('assemblyName').value.trim()||'Новая конструкция';
  snapshot();
  const group=new THREE.Group();
  group.name=name;group.userData.qdqrAssembly=true;
  root.add(group);
  select(group);
  $('assemblyTarget').value=group.uuid;
  notify('Создана сборка «'+name+'». Выбери деталь, затем нажми «Добавить».');
}
function addToAssembly(){
  const target=currentAssembly(),obj=selected;
  if(!target)return notify('Сначала создай сборку',true);
  if(!obj)return notify('Сначала выбери деталь на сцене',true);
  if(obj===target)return notify('Выбери деталь, а не саму сборку',true);
  let current=target;
  while(current){if(current===obj)return notify('Нельзя вложить сборку внутрь собственной детали',true);current=current.parent;}
  let p=obj.parent;while(p){if(p===target)return notify('Деталь уже в этой сборке');p=p.parent;}
  if(obj.isSkinnedMesh)return notify('Скелетные модели не подходят для статической сборки',true);
  snapshot();
  // Object3D.attach preserves the world position/rotation of the moved object.
  target.updateWorldMatrix(true,false);
  target.attach(obj);
  refresh();
  notify('«'+(obj.name||'Деталь')+'» добавлена. Её положение сохранено.');
}
function bakeAssembly(){
  const source=currentAssembly();
  if(!source)return notify('Сначала создай и выбери сборку',true);
  if(!countTriangles(source).meshes)return notify('В сборке пока нет деталей',true);
  if(facePickEnabled)setFacePickMode(false);
  try{
    const result=bakeStaticAssembly(source,{
      merge:$('mergeAssembly').checked,
      pivot:'bottom-center',
      maxTriangles:lowMemoryMobile?140000:350000
    });
    snapshot();
    result.userData.qdqrBakedModule=true;
    root.add(result);
    const bbox=new THREE.Box3().setFromObject(source);
    const size=bbox.getSize(new THREE.Vector3()),center=bbox.getCenter(new THREE.Vector3());
    // Position the preview beside the source. The exported selected GLB keeps
    // its local coordinates/pivot; exportSelected re-centers the module.
    result.position.set(bbox.max.x+Math.max(size.x,.5)*.6+.3,bbox.min.y,center.z);
    select(result);
    notify('Создан игровой модуль: '+result.userData.triangles+' трис, '+countTriangles(result).meshes+
      ' мешей. Теперь «Сохранить выбранный GLB».');
  }catch(e){console.error(e);notify('Не удалось запечь: '+e.message,true);}
}
async function saveSelectedModule(){
  if(!selected)return notify('Выбери готовый модуль или сборку на сцене',true);
  try{
    // Put mesh coordinates into a new export root without any scene offset.
    // When a module is created via bakeStaticAssembly, its geometry has a
    // bottom-center pivot. Preserve that pivot regardless of preview position.
    let item=selected;
    if(item.userData?.qdqrBakedModule){
      const cloned=cloneDeep(item);
      cloned.position.set(0,0,0);cloned.quaternion.identity();cloned.scale.set(1,1,1);
      await save('glb',cloned,item.name);
    }else{
      const baked=bakeStaticAssembly(item,{merge:$('mergeAssembly').checked,pivot:'bottom-center',
        maxTriangles:lowMemoryMobile?140000:350000});
      await save('glb',baked,item.name||'Модуль');
    }
  }catch(e){console.error(e);notify('Экспорт модуля: '+e.message,true);}
}

function allHouseGroups(){
  // GLB imports are wrapped in an import batch; recognize house groups there too.
  const found=[];
  root.traverse(o=>{if(o!==root&&o.isGroup&&o.userData?.qdqrHouse)found.push(o);});
  return found;
}
function refreshHouseTargets(){
  const dropdown=$('houseTarget'),current=dropdown.value;
  const houses=allHouseGroups();
  dropdown.replaceChildren();
  for(const house of houses){
    const opt=document.createElement('option');
    opt.value=house.uuid;opt.textContent=house.name;dropdown.append(opt);
  }
  if(!houses.length){
    const o=document.createElement('option');o.value='';o.textContent='Нет домов';dropdown.append(o);
  }
  const house=houses.find(x=>x.uuid===current)||houses[houses.length-1]||null;
  if(house)dropdown.value=house.uuid;
  const floorSelect=$('floorTarget'),previousFloor=floorSelect.value;
  const floors=getFloors(house);
  floorSelect.replaceChildren();
  for(const floor of floors){
    const o=document.createElement('option');
    o.value=floor.uuid;o.textContent=floor.name;floorSelect.append(o);
  }
  if(!floors.length){
    const o=document.createElement('option');o.value='';o.textContent='Нет этажей';floorSelect.append(o);
  }
  const floor=floors.find(x=>x.uuid===previousFloor)||floors[floors.length-1]||null;
  if(floor)floorSelect.value=floor.uuid;
  const active=!!house,hasFloor=!!floor;
  for(const id of ['addFloorBtn','duplicateFloorBtn','saveHouseBtn'])$(id).disabled=!active;
  for(const id of ['focusFloorBtn','seatFloorBtn','placeHousePresetBtn','saveFloorBtn'])$(id).disabled=!hasFloor;
  if(house&&floor){
    const isolate=$('isolateFloor').checked;
    setFloorVisibility(house,floor,{isolate});
    floor.updateWorldMatrix(true,false);
    grid.position.y=floor.getWorldPosition(new THREE.Vector3()).y-.004;
  }else grid.position.y=-.004;
}
function currentHouse(){
  return allHouseGroups().find(o=>o.uuid===$('houseTarget').value)||null;
}
function currentFloor(){
  return getFloors(currentHouse()).find(o=>o.uuid===$('floorTarget').value)||null;
}
function createHouseAction(){
  const height=Number($('floorHeight').value);
  try{
    const house=createHouse($('houseName').value,height);
    snapshot();
    root.add(house);
    select(house);
    $('houseTarget').value=house.uuid;
    $('floorTarget').value=getFloors(house)[0].uuid;
    refreshHouseTargets();
    notify('Создан дом «'+house.name+'» с первым этажом. Строй стены и пол.');
  }catch(e){notify('Не удалось создать дом: '+e.message,true);}
}
function addFloorAction(){
  const house=currentHouse();
  if(!house)return notify('Сначала создай дом',true);
  try{
    snapshot();
    const floor=createFloor(house);
    select(floor);
    $('floorTarget').value=floor.uuid;
    refreshHouseTargets();
    notify('Добавлен '+floor.name+'. Модули будут на нужной высоте.');
  }catch(e){notify(e.message,true);}
}
function duplicateFloorAction(){
  const house=currentHouse(),floor=currentFloor();
  if(!house||!floor)return notify('Сначала выбери этаж',true);
  const floors=getFloors(house);
  if(floors.length>=12)return notify('Лимит: 12 этажей',true);
  if(countTriangles(floor).triangles>100000 && !window.confirm('Этаж тяжёлый. Копирование может занять много памяти. Продолжить?'))return;
  snapshot();
  const copy=cloneDeep(floor);
  const number=Math.max(...floors.map(f=>f.userData.floorNumber))+1;
  copy.name='Этаж '+number;copy.userData.qdqrFloor=true;copy.userData.floorNumber=number;
  copy.visible=true;copy.position.y=(number-1)*Number(house.userData.floorHeight);
  house.add(copy);
  select(copy);$('floorTarget').value=copy.uuid;refreshHouseTargets();
  notify('Скопирован этаж целиком, детали и текстуры сохранены.');
}
function focusFloorAction(){
  const floor=currentFloor();
  if(!floor)return;
  select(floor);
  floor.updateWorldMatrix(true,false);
  const bbox=new THREE.Box3().setFromObject(floor);
  const center=bbox.isEmpty()?floor.getWorldPosition(new THREE.Vector3()):bbox.getCenter(new THREE.Vector3());
  const size=bbox.isEmpty()?5:Math.max(bbox.getSize(new THREE.Vector3()).length(),3);
  const view=camera.position.clone().sub(orbit.target);
  camera.position.copy(center).add(view.setLength(Math.max(size*1.5,3)));
  orbit.target.copy(center);orbit.update();
}
function placePresetAction(){
  const floor=currentFloor();
  if(!floor)return notify('Сначала выбери этаж',true);
  try{
    const preferred=locateWallModule(selected);
    const reference=selected;
    snapshot();
    const module=addPresetToFloor(floor,$('housePreset').value,activeMaterial(),.25,
      {preferred:preferred?.parent===floor?preferred:null,autoDock:$('autoJoinWalls').checked});
    if(!module.userData.qdqrLastJoin&&reference&&reference!==floor
      &&reference!==currentHouse()&&reference!==module
      &&reference.parent && !reference.getObjectById?.(module.id))
      placeAdjacentTo(module,preferred||reference);
    select(module);
    notify(module.userData.qdqrLastJoin?
      'Модуль автоматически состыкован по центральной оси стены.':
      'Модуль добавлен на '+floor.name+'. Можно переместить или повернуть.');
  }catch(e){notify(e.message,true);}
}

function manualJoinWalls(){
  if(!selected||!isWallModule(selected))return notify('Выбери прямую стену, угол, дверной или оконный проём',true);
  const container=selected.parent||root;
  snapshot();
  const result=snapNearbyModule(selected,container,{threshold:1.2});
  if(!result)return notify('Рядом не найден свободный стык. Подвинь деталь ближе.',true);
  select(selected);
  notify('Стыковка выполнена точно по центральной оси. Без зазора.');
}
function installInsertAction(){
  const floor=currentFloor(),insert=selected;
  if(!floor)return notify('Сначала выбери этаж с готовым дверным/оконным проёмом',true);
  if(!insert)return notify('Выбери импортированную дверную или оконную раму',true);
  if(isWallModule(insert))return notify('Выбери саму раму/дверь, а не стену с проёмом',true);
  try{
    snapshot();
    const result=fitInsertToOpening(floor,insert);
    select(insert);
    notify('Модель установлена в '+(result.module.userData.qdqrBuildType==='door'?'дверной':'оконный')+' проём. Масштаб подогнан.');
  }catch(e){console.error(e);notify('Установка в проём: '+e.message,true);}
}
function seatPartAction(){
  const floor=currentFloor(),part=selected;
  if(!floor)return notify('Сначала выбери этаж',true);
  if(!part||part===floor)return notify('Выбери импортированную деталь или модуль в сцене',true);
  const house=currentHouse();
  if(part===house || part.userData?.qdqrFloor || part.userData?.qdqrHouse)return notify('Выбери деталь, а не этаж или дом',true);
  try{
    snapshot();
    putOnFloor(floor,part,{seat:true});
    select(part);
    notify('Объект перенесён на '+floor.name+' с сохранением текстур.');
  }catch(e){notify(e.message,true);}
}
async function saveHouseAction(){
  const house=currentHouse();
  if(!house)return notify('Сначала создай дом',true);
  if(!countTriangles(house).meshes)return notify('Дом пустой: сначала добавь детали',true);
  // Include hidden stories in the serialized GLB. Export house hierarchy,
  // not unrelated root scene content, and never flatten the whole building.
  await save('glb',house,house.name,true);
}
async function saveFloorAction(){
  const floor=currentFloor();
  if(!floor)return notify('Выбери этаж',true);
  if(!countTriangles(floor).meshes)return notify('Этаж пустой',true);
  const copy=cloneDeep(floor);
  copy.position.set(0,0,0);
  copy.visible=true;
  await save('glb',copy,(currentHouse()?.name||'Дом')+'_'+floor.name,true);
}

function setOpeningKind(kind){
  if(!['door','window','arch'].includes(kind))return;
  openingKind=kind;
  document.querySelectorAll('.opening-kind').forEach(b=>b.classList.toggle('active',b.dataset.opening===kind));
  if(!openingActive){
    $('openingWidth').value=kind==='window'?1.25:1.1;
    $('openingHeight').value=kind==='window'?1.2:2.15;
  }else{
    try{
      const def=defaultOpening(kind,openingTarget);
      openingSpec={...def,centerX:openingSpec?.centerX??def.centerX};
      $('openingWidth').value=openingSpec.width;
      $('openingHeight').value=openingSpec.height;
      updateOpeningPreview();
    }catch(e){notify(e.message,true);}
  }
}
function updateOpeningPreview(){
  if(!openingActive||!openingTarget||!openingSpec){
    openingGhost.visible=false;return;
  }
  const w=Number($('openingWidth').value),h=Number($('openingHeight').value);
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<.3||h<.4||w>15||h>15){
    $('openingCutBtn').disabled=true;$('openingStatus').textContent='Размеры должны быть положительными и не больше 15 м';
    return;
  }
  const b=getWallBounds(openingTarget),sz=b.getSize(new THREE.Vector3());
  openingSpec.width=w;openingSpec.height=h;
  openingSpec.centerX=THREE.MathUtils.clamp(openingSpec.centerX,b.min.x+w/2,b.max.x-w/2);
  // A full door starts at the wall's bottom. Windows have freely movable sill.
  if(openingKind==='door'||openingKind==='arch')openingSpec.centerY=b.min.y+h/2;
  else openingSpec.centerY=THREE.MathUtils.clamp(openingSpec.centerY,b.min.y+h/2,b.max.y-h/2);
  openingSpec.centerZ=b.getCenter(new THREE.Vector3()).z;
  openingSpec.thickness=Math.max(sz.z+.65,.8);
  openingSpec.kind=openingKind;
  const safe=w<=sz.x+.001&&h<=sz.y+.001;
  $('openingCutBtn').disabled=!safe;
  $('openingStatus').textContent=safe?
    'Контур на стене · веди пальцем для перемещения · затем «Вырезать»':
    'Проём больше стены. Уменьши ширину или высоту.';
  const old=openingGhost.geometry;
  openingGhost.geometry=createOpeningGeometry(openingKind,w,h,openingSpec.thickness);
  openingEdges.geometry.dispose();openingEdges.geometry=new THREE.EdgesGeometry(openingGhost.geometry);
  if(old)old.dispose();
  const local=new THREE.Matrix4().makeTranslation(openingSpec.centerX,openingSpec.centerY,openingSpec.centerZ);
  openingTarget.updateWorldMatrix(true,false);
  openingGhost.matrix.copy(openingTarget.matrixWorld).multiply(local);
  openingGhost.matrixWorldNeedsUpdate=true;openingGhost.visible=true;
}
function stopOpening({silent=false}={}){
  openingActive=false;openingDragging=false;openingTarget=null;openingSpec=null;
  openingGhost.visible=false;
  $('openingCutBtn').disabled=true;$('openingStartBtn').disabled=false;$('openingCancelBtn').disabled=true;
  $('openingStatus').textContent='Выбери стену, затем нажми «Разметить проём».';
  orbit.enabled=true;
  if(!facePickEnabled&&selected)syncSelectionGizmo();
  if(!silent)notify('Разметка отменена. Камера снова свободна.');
}
function startOpening(){
  if(openingActive)stopOpening({silent:true});
  if(facePickEnabled)setFacePickMode(false);
  if(!selected)return notify('Сначала коснись нужной стены на сцене',true);
  if(selected.userData?.qdqrHouse || selected.userData?.qdqrFloor){
    return notify('Выбери именно стену, а не целый дом или этаж',true);
  }
  try{
    const spec=defaultOpening(openingKind,selected);
    const faces=countTriangles(selected).triangles;
    if(faces>(lowMemoryMobile?45000:100000))
      throw new Error('Стена слишком тяжёлая для вырезания на планшете. Сначала раздели её.');
    openingTarget=selected;openingSpec=spec;openingActive=true;
    $('openingWidth').value=spec.width.toFixed(2);
    $('openingHeight').value=spec.height.toFixed(2);
    transform.detach();selectionBox.visible=false;orbit.enabled=false;
    $('openingStartBtn').disabled=true;$('openingCancelBtn').disabled=false;
    updateOpeningPreview();
    $('openingStatus').textContent='Перемести золотой контур пальцем на нужное место стены.';
    // Free up the viewport on narrow phones without requiring a back control.
    if(window.matchMedia('(max-width:740px)').matches)
      document.querySelector('.sidebar.left').classList.remove('mobile-open');
  }catch(e){openingActive=false;openingTarget=null;notify('Проём: '+e.message,true);}
}
function placeOpeningFromPointer(e){
  if(!openingActive||!openingTarget)return false;
  const r=renderer.domElement.getBoundingClientRect();
  const cursor=new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
  raycaster.setFromCamera(cursor,camera);
  const roots=openingTarget.isMesh?[openingTarget]:openingTarget.children;
  const hits=raycaster.intersectObjects(roots,true).filter(x=>x.object.isMesh&&!x.object.userData?.qdqrOpeningTrim);
  if(!hits.length)return false;
  const point=openingTarget.worldToLocal(hits[0].point.clone());
  openingSpec.centerX=point.x;
  if(openingKind==='window')openingSpec.centerY=point.y;
  updateOpeningPreview();
  return true;
}
async function commitOpening(){
  if(!openingActive||!openingTarget||!openingSpec)return notify('Сначала разметь проём',true);
  if($('openingCutBtn').disabled)return;
  const target=openingTarget;
  const spec={...openingSpec};
  $('openingCutBtn').disabled=true;
  $('openingStatus').textContent='Вырезаю отверстие и формирую откосы…';
  await new Promise(resolve=>requestAnimationFrame(resolve));
  try{
    // The geometry editor keeps its own undo state; never partially modify
    // any mesh on CSG error. All cuts are computed before being committed.
    const total=countTriangles(target).triangles;
    if(total>(lowMemoryMobile?45000:100000))
      throw new Error('Стена слишком тяжёлая; сначала разбей её на секции');
    snapshot();
    const res=cutWallOpening(target,spec,{maxTotalFaces:lowMemoryMobile?45000:100000});
    if($('openingFrame').checked || $('openingLeaf').checked){
      target.add(makeOpeningTrim(spec,{
        addFrame:$('openingFrame').checked,
        addLeaf:$('openingLeaf').checked
      }));
    }
    stopOpening({silent:true});
    select(target);
    notify('Готово: настоящий проём в '+res.count+' частях стены. Сохрани GLB.');
  }catch(e){
    console.error(e);
    $('openingStatus').textContent='Не удалось вырезать. Можно изменить размеры и повторить.';
    $('openingCutBtn').disabled=false;
    notify('Ошибка вырезания: '+e.message,true);
  }
}

function hasGlassSelectedSource(){
  if(!glassSource)return false;
  let p=glassSource;
  while(p&&p!==root)p=p.parent;
  return p===root;
}
function glassOptions(){
  return {
    kind:glassKind,color:$('glassColor').value,
    opacity:Math.max(.05,1-Number($('glassTransparency').value)/100),
    all:$('glassAll').checked,
    activeIds:[...glassSelectedIds],
    palette:$('glassPalette').value,
    fragments:$('glassFragments').value
  };
}
function clearGlassPreview({hidePanel=false}={}){
  if(glassPreview){
    scene.remove(glassPreview);
    glassPreview.traverse(obj=>{
      if(obj.isMesh){
        obj.geometry?.dispose();
        if(obj.material?.map?.isCanvasTexture)obj.material.map.dispose();
        obj.material?.dispose();
      }
    });
    glassPreview=null;
  }
  glassScan=null;glassSource=null;glassSelectedIds.clear();
  if(hidePanel)$('glassOptions').hidden=true;
}
function refreshGlassPreview({rebuild=false}={}){
  if(!glassScan||!glassSource)return;
  if(!hasGlassSelectedSource()){clearGlassPreview({hidePanel:true});return;}
  const settings=glassOptions();
  if(rebuild||!glassPreview){
    if(glassPreview){
      scene.remove(glassPreview);
      glassPreview.traverse(obj=>{
        if(obj.isMesh){obj.geometry?.dispose();obj.material?.map?.dispose();obj.material?.dispose();}
      });
    }
    glassPreview=buildGlassPieces(glassScan.regions,glassScan.projection,{
      ...settings,all:true
    });
    glassPreview.name='Предпросмотр стекла';
    glassPreview.matrixAutoUpdate=false;
    scene.add(glassPreview);
  }
  glassSource.updateWorldMatrix(true,false);
  glassPreview.matrix.copy(glassSource.matrixWorld);
  glassPreview.matrixWorldNeedsUpdate=true;
  const all=settings.all;
  for(const mesh of glassPreview.children){
    const chosen=all||glassSelectedIds.has(mesh.userData.qdqrGlassId);
    mesh.material.opacity=chosen?settings.opacity:.06;
    mesh.material.needsUpdate=true;
  }
  $('glassCommitBtn').disabled=!all&&!glassSelectedIds.size;
  const total=glassScan.regions.length;
  const count=all?total:glassSelectedIds.size;
  $('glassCount').textContent='Найдено '+total+' секций · выбрано '+count;
  $('glassStatus').textContent=all?'Проверь подсветку и нажми «Вставить стекло».':
    'Касайся секций на модели, чтобы выбрать нужные.';
}
async function detectGlass(){
  if(!selected)return notify('Сначала выбери оконную раму',true);
  if(openingActive)stopOpening({silent:true});
  if(facePickEnabled)setFacePickMode(false);
  const target=selected;
  if(countTriangles(target).triangles>320000 && lowMemoryMobile)
    return notify('Рама слишком тяжёлая для анализа на этом планшете. Сначала упрости модель.',true);
  $('glassStatus').textContent='Определяю внутренние отверстия рамы…';
  $('glassScanBtn').disabled=true;
  await new Promise(resolve=>requestAnimationFrame(resolve));
  try{
    clearGlassPreview();
    const res=captureFrameSilhouette(renderer,target,{longSide:lowMemoryMobile?320:440});
    glassSource=target;
    glassScan=res;
    glassSelectedIds.clear();
    $('glassAll').checked=true;
    $('glassOptions').hidden=false;
    refreshGlassPreview({rebuild:true});
    notify('Обнаружено '+res.regions.length+' замкнутых секций. Выбери вид стекла.');
  }catch(e){
    console.error(e);
    $('glassStatus').textContent='Автопоиск не удался: '+e.message;
    notify('Поиск секций: '+e.message,true);
    $('glassOptions').hidden=true;
  }finally{
    $('glassScanBtn').disabled=false;
  }
}
function chooseGlassStyle(kind){
  glassKind=kind;
  document.querySelectorAll('[data-glass]').forEach(b=>b.classList.toggle('active',b.dataset.glass===kind));
  $('glassStainedOptions').hidden=kind!=='stained';
  refreshGlassPreview({rebuild:true});
}
function selectGlassAtPointer(e){
  if(!glassPreview||!glassScan)return false;
  const rect=renderer.domElement.getBoundingClientRect();
  const pt=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
  glassPreview.updateWorldMatrix(true,true);
  raycaster.setFromCamera(pt,camera);
  const hits=raycaster.intersectObjects(glassPreview.children,true);
  if(!hits.length)return false;
  const id=hits[0].object.userData.qdqrGlassId;
  if(!id)return false;
  if($('glassAll').checked){
    $('glassAll').checked=false;
    glassSelectedIds.clear();glassSelectedIds.add(id);
  }else if(glassSelectedIds.has(id)){
    glassSelectedIds.delete(id);
  }else glassSelectedIds.add(id);
  refreshGlassPreview();
  return true;
}
function commitGlass(){
  if(!glassScan || !hasGlassSelectedSource())return notify('Сначала найди секции в оконной раме',true);
  const opts=glassOptions();
  if(!opts.all&&!opts.activeIds.length)return notify('Коснись нужной секции или выбери «Все»',true);
  try{
    const pieces=buildGlassPieces(glassScan.regions,glassScan.projection,opts);
    if(!pieces.children.length)return notify('Нет секций для стекла',true);
    snapshot();
    const old=glassSource.children.filter(x=>x.userData?.qdqrGlassContainer);
    for(const x of old)x.removeFromParent();
    const target=glassSource;
    target.add(pieces);
    clearGlassPreview({hidePanel:true});
    select(target);
    notify('Вставлено стекло в '+pieces.children.length+' секций. Можно сохранить GLB.');
  }catch(e){console.error(e);notify('Стекло: '+e.message,true);}
}
async function saveGlassWindow(){
  const target=hasGlassSelectedSource()?glassSource:selected;
  if(!target)return notify('Выбери раму со вставленным стеклом',true);
  let found=false;target.traverse(o=>{if(o.userData?.qdqrGlassPane)found=true;});
  if(!found)return notify('Сначала вставь стекло в раму',true);
  // Preview meshes are attached to 'scene', not 'root', and never exported.
  await save('glb',target,(target.name||'Фэнтези окно')+'_со_стеклом');
}
function activeMaterial(){
  return new THREE.MeshStandardMaterial({color:$('decorColor').value,metalness:Number($('metal').value),roughness:Number($('rough').value),side:THREE.DoubleSide});
}
function addObject(m){
  const previous=selected;
  const preferred=locateWallModule(previous);
  snapshot();
  root.add(m);
  let join=null,placed=false;
  if(isWallModule(m) && $('autoJoinWalls').checked)
    join=dockNewModule(m,root,{preferred});
  if(!join){
    // Unlike the old fallback, always place near the current workpiece,
    // not at the origin where the very first wall was created.
    placed=placeAdjacentTo(m,preferred||previous);
    if(!placed && root.children.length>1)
      placed=placeAdjacentTo(m,root.children[root.children.length-2]);
    if(!placed){
      const local=root.worldToLocal(orbit.target.clone());
      const bottom=new THREE.Box3().setFromObject(m).min.y;
      m.position.set(local.x,local.y-bottom,local.z);
    }
  }
  select(m);if(root.children.length===1)fitCamera();
  notify(join?'Пристыковано к свободному концу стены.':
    'Деталь добавлена рядом с текущим местом строительства.');
}
function addPart(type){
  const mt=activeMaterial();
  const geometry={
    box:()=>new THREE.BoxGeometry(.8,.8,.3),
    sphere:()=>new THREE.SphereGeometry(.45,20,16),
    cylinder:()=>new THREE.CylinderGeometry(.35,.35,.9,24),
    torus:()=>new THREE.TorusGeometry(.4,.085,12,36),
    plane:()=>new THREE.PlaneGeometry(1.4,1.1),
    plaque:()=>new THREE.BoxGeometry(1.3,.8,.09)
  }[type]();
  const mesh=new THREE.Mesh(geometry,mt);mesh.name='Декор · '+type;
  mesh.position.set(0,1.3,.35);mesh.castShadow=true;mesh.receiveShadow=true;
  addObject(mesh);
}
function newScene(){
  clearGlassPreview({hidePanel:true});
  if(openingActive)stopOpening({silent:true});
  if(root.children.length && !window.confirm('Очистить всю сцену? Сначала сохраните нужные модели.'))return;
  setFacePickMode(false);clearMarkedFaces();
  snapshot();root.clear();select(null);fileBase='phoenix_module';
  fitCamera();setStatus('Новая пустая сцена');notify('Сцена очищена');
}
function sample(){
  snapshot();root.clear();const wall=createConstruction('wall',mat('#8a887e'));root.add(wall);
  const column=createConstruction('column',mat('#b69f7b'));column.position.set(1.35,0,.24);root.add(column);
  const p=new THREE.Mesh(new THREE.PlaneGeometry(.8,.8),mat('#c0a06b'));p.name='Декор · щит';p.position.set(-.65,1.6,.14);root.add(p);
  fileBase='phoenix_wall_test';select(wall.children[0]);fitCamera();
  notify('Пример стены: выберите нужную часть и редактируйте.');
}
function eligible(){
  if(!selected){notify('Сначала выбери часть модели',true);return false;}
  if(selected.isSkinnedMesh){notify('Скелетный меш: редактируйте геометрию до риггинга',true);return false;}
  if(!selected.geometry?.getAttribute('position')){notify('Нет редактируемой геометрии',true);return false;}
  return true;
}
function applyGeometry(op, description){
  if(!eligible())return;
  try{
    if(countTriangles(selected).triangles>110000 && description.includes('облой'))throw new Error('Слишком плотная сетка. Сначала разделите объект.');
    const out=op(selected.geometry);
    snapshot();
    selected.geometry=out.geometry||out;
    selectionBox.setFromObject(selected);refresh();
    notify(description+' · '+(out.before!==undefined?(out.before-out.after)+' треугольников удалено':'готово'));
  }catch(e){console.error(e);notify('Ошибка: '+e.message,true);}
}
function splitSelected(){
  if(!eligible())return;
  try{
    const result=splitGeometryIslands(selected.geometry,{maxParts:80,minFaces:Number($('islandSize').value)});
    if(result.totalIslands<2)return notify('Этот меш уже связан в один геометрический островок');
    snapshot();
    const old=selected,parent=old.parent;
    const group=new THREE.Group();group.name='Разобранный меш · '+old.name;
    group.position.copy(old.position);group.quaternion.copy(old.quaternion);group.scale.copy(old.scale);
    parent.add(group);old.removeFromParent();
    for(const item of result.parts){
      const m=new THREE.Mesh(item.geometry,Array.isArray(old.material)?old.material.map(m=>m.clone()):old.material.clone());
      m.name=item.name+' ('+item.faces+' трис)';
      group.add(m);
    }
    select(group.children[0]||null);
    notify('Найдено '+result.totalIslands+' островков; выделено '+result.parts.length+' редактируемых частей');
  }catch(e){console.error(e);notify('Разделение: '+e.message,true);}
}

function updateFaceOverlay(){
  $('faceCounter').textContent='Выделено: '+markedFaces.size+' полигонов';
  $('faceDeleteBtn').disabled=markedFaces.size===0;
  $('faceClearBtn').disabled=markedFaces.size===0;
  if(!selected?.isMesh || !markedFaces.size || !facePickEnabled){
    faceOverlay.visible=false;return;
  }
  const geom=selected.geometry,positions=geom?.getAttribute('position');
  if(!positions){faceOverlay.visible=false;return;}
  const idx=geom.index,coords=[];
  const maxTriangles=Math.min(markedFaces.size,15000);
  let shown=0;
  for(const f of markedFaces){
    if(shown++>=maxTriangles)break;
    for(let corner=0;corner<3;corner++){
      const vertex=idx?idx.getX(f*3+corner):f*3+corner;
      coords.push(positions.getX(vertex),positions.getY(vertex),positions.getZ(vertex));
    }
  }
  const overlayGeometry=new THREE.BufferGeometry();
  overlayGeometry.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));
  faceOverlay.geometry.dispose();faceOverlay.geometry=overlayGeometry;
  selected.updateWorldMatrix(true,false);
  faceOverlay.matrix.copy(selected.matrixWorld);
  faceOverlay.matrixWorldNeedsUpdate=true;
  faceOverlay.visible=true;
}
function setFacePickMode(enabled){
  facePickEnabled=Boolean(enabled);
  transform.detach();
  orbit.enabled=!facePickEnabled;
  $('facePickBtn').classList.toggle('active',facePickEnabled);
  $('facePickBtn').setAttribute('aria-pressed',String(facePickEnabled));
  $('facePickBtn').textContent=facePickEnabled?'✓ Закончить выделение':'◎ Выбрать грани пальцем';
  if(!facePickEnabled && selected)syncSelectionGizmo();
  selectionBox.visible=!!selected&&!facePickEnabled;
  updateFaceOverlay();
  if(facePickEnabled){
    setStatus('Выделение граней: касайся области на модели · повторный тап снимает отметку');
    if(window.matchMedia('(max-width:980px)').matches)
      document.querySelector('.sidebar.left').classList.remove('mobile-open');
  }else setStatus('Выделение закончено — камера снова свободна');
}
function hitPick(hit){
  if(!hit?.object?.isMesh || hit.faceIndex===undefined || hit.faceIndex===null)return;
  const m=hit.object;
  if(selected!==m)select(m);
  const geom=m.geometry,position=geom?.getAttribute('position'),ix=geom.index;
  if(!position)return;
  const faceCount=Math.floor((ix?ix.count:position.count)/3);
  const face=hit.faceIndex;
  if(face<0||face>=faceCount)return;
  const chosen=new Set([face]);
  const brush=Number($('brushSize').value);
  if(brush>0){
    if(faceCount>130000)notify('Для большой модели уменьшена кисть: сначала разделите меш',true);
    else{
      geom.computeBoundingBox();
      const diag=geom.boundingBox.getSize(new THREE.Vector3()).length();
      const r=diag*brush/100;
      const localHit=m.worldToLocal(hit.point.clone());
      const normal=hit.face.normal.clone().normalize();
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
      const ab=new THREE.Vector3(),ac=new THREE.Vector3();
      const lim=Math.min(faceCount,140000);
      for(let f=0;f<lim;f++){
        const i0=ix?ix.getX(f*3):f*3;
        const i1=ix?ix.getX(f*3+1):f*3+1;
        const i2=ix?ix.getX(f*3+2):f*3+2;
        a.fromBufferAttribute(position,i0);b.fromBufferAttribute(position,i1);c.fromBufferAttribute(position,i2);
        const x=(a.x+b.x+c.x)/3,y=(a.y+b.y+c.y)/3,z=(a.z+b.z+c.z)/3;
        if((x-localHit.x)**2+(y-localHit.y)**2+(z-localHit.z)**2>r*r)continue;
        ab.subVectors(b,a);ac.subVectors(c,a);
        const candidateNormal=ab.cross(ac).normalize();
        if(candidateNormal.dot(normal)>0.2)chosen.add(f);
      }
    }
  }
  const shouldRemove=markedFaces.has(face);
  for(const i of chosen)if(shouldRemove)markedFaces.delete(i);else markedFaces.add(i);
  if(markedFaces.size>14000)notify('Много выделенных граней; подсветка ограничена первыми 15 000',true);
  updateFaceOverlay();
}
function clearMarkedFaces(){
  markedFaces.clear();updateFaceOverlay();
}
function deleteMarkedFaces(){
  if(!selected?.isMesh || !markedFaces.size)return notify('Сначала отметь полигоны на модели',true);
  const faces=new Set(markedFaces);
  const total=Math.floor((selected.geometry.index?selected.geometry.index.count:selected.geometry.getAttribute('position').count)/3);
  if(faces.size>=total){
    if(!window.confirm('Отмечены ВСЕ полигоны. Удалить всю деталь?'))return;
    setFacePickMode(false);clearMarkedFaces();deleteSelection();return;
  }
  if(!window.confirm('Удалить '+faces.size+' отмеченных полигонов? Неотмеченная часть останется.'))return;
  setFacePickMode(false);
  applyGeometry(g=>removePickedFaces(g,faces),'Удалены выбранные грани');
  clearMarkedFaces();
}
function duplicateSelected(){
  if(!selected)return notify('Сначала выбери деталь или набор',true);
  if(selected.isSkinnedMesh)return notify('Копирование риггированных персонажей ещё не поддерживается',true);
  let containsSkin=false;selected.traverse(o=>{if(o.isSkinnedMesh)containsSkin=true;});
  if(containsSkin)return notify('Риггированные модели пока нельзя безопасно копировать',true);
  if(countTriangles(selected).triangles>180000 && !window.confirm('Очень тяжёлая модель. Копирование может занять много памяти. Продолжить?'))return;
  setFacePickMode(false);
  snapshot();
  const original=selected,parent=original.parent||root,clone=cloneDeep(original);
  clone.name=(original.name||'Деталь')+' · копия';
  if(clone.userData?.importBatch)clone.userData.importBatch=false;
  parent.add(clone);
  root.updateWorldMatrix(true,true);
  const first=new THREE.Box3().setFromObject(original);
  const second=new THREE.Box3().setFromObject(clone);
  const direction=$('copyDirection').value,gap=.02;
  const worldOffset=new THREE.Vector3();
  if(direction==='x+')worldOffset.x=first.max.x-second.min.x+gap;
  if(direction==='x-')worldOffset.x=first.min.x-second.max.x-gap;
  if(direction==='z+')worldOffset.z=first.max.z-second.min.z+gap;
  if(direction==='z-')worldOffset.z=first.min.z-second.max.z-gap;
  // Parent matrices can include rotation/scale: convert offset vector to local.
  const inverse=parent.matrixWorld.clone().invert();
  const origin=new THREE.Vector3().applyMatrix4(inverse);
  const target=worldOffset.clone().applyMatrix4(inverse);
  clone.position.add(target.sub(origin));
  clone.updateWorldMatrix(true,true);
  // Keep both original and copy visible, including when the user was zoomed in.
  const pair=new THREE.Box3().setFromObject(original).union(new THREE.Box3().setFromObject(clone));
  const center=pair.getCenter(new THREE.Vector3()),offset=camera.position.clone().sub(orbit.target);
  const distance=Math.max(offset.length(),pair.getSize(new THREE.Vector3()).length()*1.6,.7);
  camera.position.copy(center).add(offset.setLength(distance));
  orbit.target.copy(center);orbit.update();
  select(clone);
  notify('Копия поставлена рядом. Размеры и текстуры сохранены.');
}
function changeMode(m){
  mode=m;transform.setMode(m);
  document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
}
function saveRename(){
  if(!selected)return;selected.name=$('objectName').value||'Объект';refresh();
}
function applyNumericTransform(){
  if(!selected)return;
  const vals=['posX','posY','posZ','scaleX','scaleY','scaleZ'].map(id=>Number($(id).value));
  if(vals.some(v=>!Number.isFinite(v)))return;
  snapshot();selected.position.set(...vals.slice(0,3));
  selected.scale.set(...vals.slice(3).map(v=>Math.abs(v)<.001?.001:v));
  selectionBox.setFromObject(selected);syncSelectionGizmo();refresh();
}
function applyDimensions(){
  if(!eligible())return;
  const dim=['dimX','dimY','dimZ'].map(id=>Number($(id).value));
  if(dim.some(v=>!Number.isFinite(v)||v<=0))return notify('Размеры должны быть больше нуля',true);
  const sizes=new THREE.Box3().setFromObject(selected).getSize(new THREE.Vector3());
  snapshot();
  selected.scale.set(selected.scale.x*(dim[0]/Math.max(.0001,sizes.x)),selected.scale.y*(dim[1]/Math.max(.0001,sizes.y)),selected.scale.z*(dim[2]/Math.max(.0001,sizes.z)));
  selectionBox.setFromObject(selected);syncSelectionGizmo();refresh();notify('Размеры изменены по каждой оси');
}
function centerPivot(){
  if(!eligible())return;
  snapshot();
  const mesh=selected;mesh.geometry.computeBoundingBox();
  const midpoint=mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
  const shift=midpoint.clone().multiply(mesh.scale).applyQuaternion(mesh.quaternion);
  mesh.geometry=mesh.geometry.clone();mesh.geometry.translate(-midpoint.x,-midpoint.y,-midpoint.z);
  mesh.position.add(shift);select(mesh);notify('Опорная точка в центре геометрии');
}
function ground(){
  if(!selected)return;
  const bounds=new THREE.Box3().setFromObject(selected);
  snapshot();selected.position.y-=bounds.min.y;syncSelectionGizmo();refresh();notify('Объект установлен на уровень Y = 0');
}
function isolateSelection(){
  if(!selected)return notify('Выделите объект');
  isolate=!isolate;
  root.traverse(o=>{if(o.isMesh)o.visible=!isolate||o===selected;});
  $('isolateBtn').classList.toggle('active',isolate);refresh();
}
function deleteSelection(){
  if(!selected)return;
  if(selected.isGroup)return deleteBatch(selected);
  setFacePickMode(false);clearMarkedFaces();
  snapshot();transform.detach();selected.removeFromParent();selected=null;
  selectionBox.visible=false;refresh();notify('Фрагмент удалён');
}
function bakeAll(){
  if(!root.children.length)return;
  // Collapse scene to a flat group of independent static meshes, matrices baked to vertices.
  // This is transform baking, not PBR-texture atlas baking or mesh boolean union.
  snapshot();root.updateWorldMatrix(true,true);
  const meshes=[];
  root.traverse(o=>{
    if(!o.isMesh || o.isSkinnedMesh)return;
    const copy=new THREE.Mesh(o.geometry.clone(),Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone());
    copy.geometry.applyMatrix4(o.matrixWorld);copy.name=o.name;
    copy.visible=o.visible;meshes.push(copy);
  });
  root.clear();meshes.forEach(m=>root.add(m));select(meshes[0]||null);
  notify('Матрицы преобразованы в вершины. Материалы сохранены.');
}

function validWallReference(){
  if(savedWallBase){
    let p=savedWallBase;
    while(p && p!==root)p=p.parent;
    if(p===root)return savedWallBase;
    savedWallBase=null;
  }
  return null;
}
function rememberSelectedWall(){
  if(!selected)return notify('Выбери стену на сцене',true);
  if(!countTriangles(selected).meshes)return notify('У выбранного набора нет геометрии',true);
  savedWallBase=selected;
  $('wallBaseName').textContent='Основа: '+(selected.name||'Стена');
  notify('Основа запомнена. Теперь выбери отдельно каменную накладку.');
}
function attachSelectedWallDecor(){
  const wall=validWallReference(),panel=selected;
  if(!wall)return notify('Шаг 1: сначала запомни стену-основу',true);
  if(!panel || wall===panel)return notify('Шаг 2: выбери отдельную каменную накладку',true);
  try{
    setFacePickMode(false);
    // Avoid moving the wall itself or its ancestor into its own descendant.
    snapshot();
    const res=attachDecorToWall(wall,panel,{fit:$('fitDecorToWall').checked});
    select(res.wall);
    notify('Готово: каменная накладка вложена в стену. Сохраняй её как один GLB.');
  }catch(e){console.error(e);notify('Не удалось прикрепить: '+e.message,true);}
}
async function saveDecorWall(){
  const wall=validWallReference()||selected;
  if(!wall)return notify('Выбери стену для сохранения',true);
  if(!countTriangles(wall).meshes)return notify('В выбранной стене нет мешей',true);
  // Do not merge/strip attached geometry. Preserve hierarchy and material maps.
  // Use the full group path; selected wall and child ornament are both exported.
  const clone=cloneDeep(wall);
  clone.updateWorldMatrix(true,true);
  try{
    // Bake a standalone copy at a bottom-center origin, preserving all
    // material groups, child geometries and baked texture UVs.
    const baked=bakeStaticAssembly(wall,{
      merge:false,pivot:'bottom-center',
      maxTriangles:lowMemoryMobile?140000:350000
    });
    await save('glb',baked,(wall.name||'Стена')+'_с_декором');
  }catch(e){console.error(e);notify('Ошибка сохранения стены: '+e.message,true);}
}
function loadWallImage(file){
  if(!selected||!countTriangles(selected).meshes){
    notify('Сначала выбери стену или группу стен',true);return;
  }
  const target=selected;
  const readerUrl=URL.createObjectURL(file);
  new THREE.TextureLoader().load(readerUrl,tex=>{
    try{
      tex.colorSpace=THREE.SRGBColorSpace;
      // GLTF exporter handles flipping internal textures according to glTF convention.
      tex.wrapS=tex.wrapT=$('textureMode').value==='tile'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
      snapshot();
      const result=projectTextureToWall(target,tex,{
        mode:$('textureMode').value,
        tileMeters:Number($('textureTileMeters').value)
      });
      // Store stable target reference for the explicit "save wall + decor" action.
      savedWallBase=target;
      $('wallBaseName').textContent='Основа: '+(target.name||'Стена');
      select(target);
      notify('Текстура нанесена на '+result.meshes+' мешей: '+result.width.toFixed(2)+' × '+result.height.toFixed(2)+' м. Сохраняй GLB.');
    }catch(e){console.error(e);notify('Ошибка текстуры: '+e.message,true);}
    finally{URL.revokeObjectURL(readerUrl);}
  },undefined,e=>{console.error(e);URL.revokeObjectURL(readerUrl);notify('Не удалось загрузить изображение',true);});
}
function addEmblem(texture){
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(.8,.8),new THREE.MeshStandardMaterial({map:texture,transparent:true,side:THREE.DoubleSide,metalness:.15,roughness:.55,depthWrite:false}));
  plane.name='Эмблема / картина';
  if(selected){
    const b=new THREE.Box3().setFromObject(selected);
    const c=b.getCenter(new THREE.Vector3());
    plane.position.set(c.x,c.y,b.max.z+.025);
  }else plane.position.set(0,1.5,.4);
  addObject(plane);
}
function canvasEmblem(){
  const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');
  g.clearRect(0,0,512,512);
  g.strokeStyle='#e5b35c';g.lineWidth=18;
  g.beginPath();g.arc(256,256,196,0,Math.PI*2);g.stroke();
  g.lineWidth=8;g.beginPath();g.arc(256,256,164,0,Math.PI*2);g.stroke();
  g.fillStyle='#c6a26d';g.beginPath();
  for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2;const r=i%2===0?137:56;const x=256+Math.cos(a)*r,y=256+Math.sin(a)*r;i?g.lineTo(x,y):g.moveTo(x,y);}
  g.closePath();g.fill();
  g.fillStyle='#392918';g.beginPath();g.arc(256,256,26,0,Math.PI*2);g.fill();
  const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;addEmblem(tx);
}
async function importFile(file){
  if(!file)return;
  setStatus('Загрузка '+file.name+'...');busy=true;
  try{
    const ext=(file.name.split('.').pop()||'').toLowerCase(),b=await file.arrayBuffer();
    let obj;
    if(ext==='glb'||ext==='gltf'){
      const loader=new GLTFLoader();
      // External .bin or textures in .gltf are not resolved by this single-file picker.
      const data=ext==='glb'?b:new TextDecoder().decode(b);
      const gltf=await new Promise((res,rej)=>loader.parse(data,'',res,rej));
      obj=gltf.scene; 
    } else if(ext==='obj'){
      obj=new OBJLoader().parse(new TextDecoder().decode(b));
    } else if(ext==='stl'){
      const geom=new STLLoader().parse(b);
      geom.computeVertexNormals();obj=new THREE.Mesh(geom,mat('#adb5bc'));
    } else throw new Error('Поддерживаются GLB, GLTF, OBJ и STL');
    const stats=countTriangles(obj);
    if(lowMemoryMobile && stats.triangles>450000)throw new Error('Модель содержит более 450 тысяч треугольников. Для 4 ГБ ОЗУ сперва разделите её на части.');
    if(!stats.meshes)throw new Error('Файл не содержит 3D-мешей');
    if(stats.triangles>1300000)notify('Очень тяжёлая модель; на планшете возможны тормоза');
    snapshot();
    setFacePickMode(false);clearMarkedFaces();
    const bundle=new THREE.Group();bundle.name=file.name;bundle.userData.importBatch=true;
    bundle.add(obj);root.add(bundle);fileBase=safeName(file.name.replace(/\.[^.]+$/,''));
    const mesh=(()=>{let v=null;obj.traverse(o=>{if(!v&&o.isMesh)v=o;});return v;})();
    select(bundle);fitCamera();
    setStatus('Загружено · '+file.name);
    notify(file.name+': '+stats.meshes+' частей, '+stats.triangles.toLocaleString('ru-RU')+' треугольников');
    lastFiles.push(file.name);
  }catch(e){console.error(e);notify('Не удалось открыть: '+e.message,true);setStatus('Ошибка импорта');}
  finally{busy=false;}
}
function arrayBufferToBase64(buf){
  const bytes=new Uint8Array(buf);let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary);
}
async function downloadBlob(blob,name){
  try{
    // Android WebView does not reliably support <a download>. Use Capacitor
    // cache + system share sheet to allow choosing Files/Drive as a destination.
    if(window.Capacitor?.isNativePlatform?.()){
      const [{Filesystem,Directory},{Share}]=await Promise.all([
        import('@capacitor/filesystem'),import('@capacitor/share')
      ]);
      const buffer=await blob.arrayBuffer();
      const result=await Filesystem.writeFile({path:name,data:arrayBufferToBase64(buffer),directory:Directory.Cache,recursive:true});
      await Share.share({title:'Phoenix Mesh Workshop · '+name,url:result.uri,dialogTitle:'Сохранить 3D-модель'});
      notify('Файл готов — выберите, где его сохранить');
      return;
    }
  }catch(e){console.error(e);notify('Android: попробуйте системную отправку ещё раз',true);}
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),20000);
}
async function save(format,subject=root,filename=fileBase,includeHidden=false){
  if(!subject || (!subject.isMesh && !subject.children?.length))return notify('Нечего сохранять',true);
  if(busy)return;busy=true;setStatus('Экспорт '+format.toUpperCase()+'...');
  try{
    let content,mime,extension=format;
    if(format==='glb'||format==='gltf'){
      const exporter=new GLTFExporter();
      const serialized=await exporter.parseAsync(subject,{
        binary:format==='glb',onlyVisible:!includeHidden,trs:false,maxTextureSize:2048,
        includeCustomExtensions:false
      });
      content=format==='glb'?new Blob([serialized],{type:'model/gltf-binary'}):new Blob([JSON.stringify(serialized)],{type:'model/gltf+json'});
    } else if(format==='obj') {
      content=new Blob([new OBJExporter().parse(subject)],{type:'text/plain'});
    } else if(format==='stl'){
      content=new Blob([new STLExporter().parse(subject,{binary:false})],{type:'model/stl'});
    } else throw new Error('Неизвестный формат');
    await downloadBlob(content,safeName(filename)+'.'+extension);notify('Файл подготовлен: '+safeName(filename)+'.'+extension);
  }catch(e){console.error(e);notify('Ошибка экспорта: '+e.message,true);}
  finally{busy=false;setStatus('Готово · модели можно редактировать');}
}
function screenshot(){
  try{
    renderer.render(scene,camera);
    renderer.domElement.toBlob(blob=>{if(blob)downloadBlob(blob,fileBase+'_preview.png');},'image/png');
  }catch(e){notify('Снимок не создан',true);}
}
function initEvents(){
  $('openBtn').onclick=()=>$('filePicker').click();
  $('filePicker').onchange=async e=>{clearGlassPreview({hidePanel:true});await importFile(e.target.files[0]);e.target.value='';};
  $('sampleBtn').onclick=sample;
  $('newBtn').onclick=newScene;
  $('clearSceneBtn').onclick=newScene;
  $('deleteBatchBtn').onclick=()=>deleteBatch();
  $('cameraOrbit').onclick=()=>{setFacePickMode(false);setCameraNavigation('orbit');};
  $('cameraPan').onclick=()=>{setFacePickMode(false);setCameraNavigation('pan');};
  $('viewFocus').onclick=focusSelected;
  $('resetCamera').onclick=fitCamera;$('viewFit').onclick=fitCamera;
  $('viewFront').onclick=()=>view('front');$('viewSide').onclick=()=>view('side');$('viewTop').onclick=()=>view('top');
  $('exportBtn').onclick=()=>save('glb');$('saveBtn').onclick=()=>save($('format').value);
  $('clearSelection').onclick=()=>{clearGlassPreview({hidePanel:true});if(openingActive)stopOpening({silent:true});setFacePickMode(false);clearMarkedFaces();select(null);};
  $('undoBtn').onclick=undo;$('redoBtn').onclick=redo;
  $('centerPivot').onclick=centerPivot;$('groundBtn').onclick=ground;
  $('deleteBtn').onclick=deleteSelection;$('isolateBtn').onclick=isolateSelection;
  $('bakeBtn').onclick=bakeAll;
  for(const b of document.querySelectorAll('[data-opening]'))b.onclick=()=>setOpeningKind(b.dataset.opening);
  $('openingStartBtn').onclick=startOpening;
  $('openingCancelBtn').onclick=()=>stopOpening();
  $('openingCutBtn').onclick=commitOpening;
  for(const id of ['openingWidth','openingHeight'])$(id).addEventListener('input',()=>{if(openingActive)updateOpeningPreview();});
  $('createHouseBtn').onclick=createHouseAction;
  $('addFloorBtn').onclick=addFloorAction;
  $('duplicateFloorBtn').onclick=duplicateFloorAction;
  $('focusFloorBtn').onclick=focusFloorAction;
  $('seatFloorBtn').onclick=seatPartAction;
  $('placeHousePresetBtn').onclick=placePresetAction;
  $('manualJoinBtn').onclick=manualJoinWalls;
  $('installInOpeningBtn').onclick=installInsertAction;
  $('saveFloorBtn').onclick=saveFloorAction;
  $('saveHouseBtn').onclick=saveHouseAction;
  $('houseTarget').onchange=refreshHouseTargets;
  $('floorTarget').onchange=refreshHouseTargets;
  $('isolateFloor').onchange=()=>{refreshHouseTargets();};
  $('createAssemblyBtn').onclick=createAssembly;
  $('addAssemblyBtn').onclick=addToAssembly;
  $('bakeAssemblyBtn').onclick=bakeAssembly;
  $('saveModuleBtn').onclick=saveSelectedModule;
  $('splitBtn').onclick=splitSelected;
  $('duplicateBtn').onclick=duplicateSelected;
  $('facePickBtn').onclick=()=>setFacePickMode(!facePickEnabled);
  $('faceClearBtn').onclick=clearMarkedFaces;
  $('faceDeleteBtn').onclick=deleteMarkedFaces;
  $('brushSize').oninput=e=>$('brushLabel').textContent=Number(e.target.value)===0?'1 грань':e.target.value+'% размера объекта';
  clearMarkedFaces();
  $('cleanBtn').onclick=()=>applyGeometry(g=>removeSmallIslands(g,Number($('islandSize').value)),'Очищен облой');
  $('normalsBtn').onclick=()=>applyGeometry(g=>{const r=cleanDegenerate(g);return r;},'Убраны вырожденные треугольники; нормали пересчитаны');
  $('cutBtn').onclick=()=>applyGeometry(g=>cropGeometry(g,$('cutAxis').value,Number($('cutPos').value),$('cutSide').value),'Обрезка без закрытия среза');
  $('bendBtn').onclick=()=>applyGeometry(g=>bendGeometry(g,Number($('bendValue').value)),'Изгиб');
  $('wire').onchange=e=>root.traverse(o=>{if(o.isMesh){const arr=Array.isArray(o.material)?o.material:[o.material];arr.forEach(m=>{if(m)m.wireframe=e.target.checked;});}});
  $('gridCheck').onchange=e=>grid.visible=e.target.checked;
  $('snap').onchange=e=>{const a=e.target.checked;transform.setTranslationSnap(a?.25:null);transform.setRotationSnap(a?THREE.MathUtils.degToRad(15):null);transform.setScaleSnap(a?.05:null);};
  $('snap').dispatchEvent(new Event('change'));
  document.querySelectorAll('button[data-mode]').forEach(b=>b.onclick=()=>changeMode(b.dataset.mode));
  document.querySelectorAll('button[data-preset]').forEach(b=>b.onclick=()=>addObject(createConstruction(b.dataset.preset,activeMaterial())));
  document.querySelectorAll('button[data-add]').forEach(b=>b.onclick=()=>addPart(b.dataset.add));
  $('sizeBtn').onclick=applyDimensions;
  $('objectName').onchange=saveRename;
  ['posX','posY','posZ','scaleX','scaleY','scaleZ'].forEach(id=>$(id).addEventListener('change',applyNumericTransform));
  $('islandSize').oninput=e=>$('islandLabel').textContent=e.target.value;
  $('cutPos').oninput=e=>$('cutLabel').textContent=Number(e.target.value).toFixed(2);
  $('bendValue').oninput=e=>$('bendLabel').textContent=e.target.value+'°';
  $('metal').oninput=e=>$('metalVal').textContent=e.target.value;
  $('rough').oninput=e=>$('roughVal').textContent=e.target.value;
  $('materialBtn').onclick=()=>{
    if(!selected)return notify('Выберите объект');
    snapshot();selected.material=activeMaterial();refresh();notify('Материал применён');
  };
  $('glassScanBtn').onclick=detectGlass;
  $('glassCommitBtn').onclick=commitGlass;
  $('glassCancelBtn').onclick=()=>{clearGlassPreview({hidePanel:true});$('glassStatus').textContent='Выделение отменено.';};
  $('glassSaveBtn').onclick=saveGlassWindow;
  for(const b of document.querySelectorAll('[data-glass]'))b.onclick=()=>chooseGlassStyle(b.dataset.glass);
  $('glassAll').onchange=()=>{if($('glassAll').checked)glassSelectedIds.clear();refreshGlassPreview();};
  $('glassColor').oninput=()=>refreshGlassPreview({rebuild:true});
  $('glassTransparency').oninput=()=>{
    $('glassTransparencyLabel').textContent=$('glassTransparency').value+'%';
    refreshGlassPreview();
  };
  $('glassPalette').onchange=()=>refreshGlassPreview({rebuild:true});
  $('glassFragments').onchange=()=>refreshGlassPreview({rebuild:true});
  $('emblemBtn').onclick=canvasEmblem;
  $('rememberWallBtn').onclick=rememberSelectedWall;
  $('attachDecorBtn').onclick=attachSelectedWallDecor;
  $('saveDecorWallBtn').onclick=saveDecorWall;
  $('applyWallTextureBtn').onclick=()=>{
    if(!selected || !countTriangles(selected).meshes)return notify('Сначала выбери стену',true);
    imagePickMode='wall';$('imagePicker').click();
  };
  $('textureBtn').onclick=()=>{imagePickMode='separate';$('imagePicker').click();};
  $('imagePicker').onchange=e=>{
    const f=e.target.files[0];e.target.value='';
    if(!f)return;
    if(imagePickMode==='wall'){loadWallImage(f);return;}
    const url=URL.createObjectURL(f);
    new THREE.TextureLoader().load(url,tx=>{
      tx.colorSpace=THREE.SRGBColorSpace;addEmblem(tx);setTimeout(()=>URL.revokeObjectURL(url),10000);
    },undefined,()=>{notify('Не удалось прочитать изображение',true);URL.revokeObjectURL(url);});
  };
  document.querySelectorAll('#toolTabs button').forEach(b=>b.onclick=()=>{
    if(openingActive&&b.dataset.tab!=='openings')stopOpening({silent:true});
    document.querySelectorAll('#toolTabs button').forEach(n=>n.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(n=>n.classList.remove('active'));
    b.classList.add('active');$('tab-'+b.dataset.tab).classList.add('active');
  });
  $('mobileTools').onclick=()=>{$('mobileTools').classList.toggle('active');document.querySelector('.sidebar.left').classList.toggle('mobile-open');document.querySelector('.sidebar.right').classList.remove('mobile-open');};
  $('mobileScene').onclick=()=>{document.querySelector('.sidebar.right').classList.toggle('mobile-open');document.querySelector('.sidebar.left').classList.remove('mobile-open');};
  transform.addEventListener('dragging-changed',event=>{
    orbit.enabled=!event.value;
    if(event.value){
      if(!selected)return;
      snapshot();dragged=true;
      selected.updateWorldMatrix(true,false);
      gizmoPivot.updateMatrixWorld(true);
      dragInitialPivot=gizmoPivot.matrixWorld.clone();
      dragInitialWorld=selected.matrixWorld.clone();
      dragParentInverse=selected.parent.matrixWorld.clone().invert();
    }else{
      if($('autoJoinWalls').checked && locateWallModule(selected)===selected){
        const snapped=snapNearbyModule(selected,root,{threshold:.65});
        if(snapped)notify('Магнит: стены пристыкованы по центральной оси.');
      }
      dragInitialPivot=dragInitialWorld=dragParentInverse=null;
      if(selected)syncSelectionGizmo();
      refresh();selectionBox.visible=!!selected;
      if(selected)selectionBox.setFromObject(selected);
    }
  });
  transform.addEventListener('objectChange',()=>{
    if(!selected || !dragInitialPivot || !dragInitialWorld || !dragParentInverse)return;
    gizmoPivot.updateMatrixWorld(true);
    const delta=gizmoPivot.matrixWorld.clone().multiply(dragInitialPivot.clone().invert());
    const local=dragParentInverse.clone().multiply(delta).multiply(dragInitialWorld);
    local.decompose(selected.position,selected.quaternion,selected.scale);
    selected.updateMatrixWorld(true);
    selectionBox.setFromObject(selected);
    updateProperties();
  });
  let down=null;
  // While marking a doorway, a single finger drags the cutter instead of
  // rotating the scene; multi-touch navigation returns after Cancel/Commit.
  renderer.domElement.addEventListener('pointerdown',e=>{
    if(!openingActive||!e.isPrimary)return;
    openingDragging=true;
    placeOpeningFromPointer(e);
    e.stopImmediatePropagation();e.preventDefault();
  },true);
  renderer.domElement.addEventListener('pointermove',e=>{
    if(!openingActive||!openingDragging)return;
    placeOpeningFromPointer(e);
    e.stopImmediatePropagation();e.preventDefault();
  },true);
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!openingActive)return;
    openingDragging=false;
    e.stopImmediatePropagation();e.preventDefault();
  },true);
  renderer.domElement.addEventListener('pointercancel',()=>{openingDragging=false;},true);
  // Click-to-select panes in the glass preview without picking the wall itself.
  let downGlass=null;
  renderer.domElement.addEventListener('pointerdown',e=>{
    if(glassScan&&e.isPrimary)downGlass={x:e.clientX,y:e.clientY,id:e.pointerId};
  },true);
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!glassScan||!downGlass||e.pointerId!==downGlass.id)return;
    const delta=Math.hypot(e.clientX-downGlass.x,e.clientY-downGlass.y);
    downGlass=null;
    if(delta>10)return;
    if(selectGlassAtPointer(e)){
      e.stopImmediatePropagation();e.preventDefault();
    }
  },true);
  renderer.domElement.addEventListener('pointerdown',e=>{if(!e.isPrimary){down=null;return;}down={x:e.clientX,y:e.clientY,id:e.pointerId,time:performance.now()};});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down || e.pointerId!==down.id || (!orbit.enabled&&!facePickEnabled))return;
    const distance=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;
    if(distance>8)return;
    const rect=renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hits=raycaster.intersectObjects(root.children,true).filter(h=>h.object.isMesh&&h.object.visible);
    if(facePickEnabled){if(hits.length)hitPick(hits[0]);else notify('Коснись поверхности детали');}
    else if(hits.length)select(locateWallModule(hits[0].object)||hits[0].object);
  });
  viewport.addEventListener('dragover',e=>e.preventDefault());
  viewport.addEventListener('drop',e=>{e.preventDefault();importFile(e.dataTransfer.files[0]);});
  window.addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    if(e.key==='Delete'){if(facePickEnabled&&markedFaces.size)deleteMarkedFaces();else deleteSelection();}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicateSelected();}
    if(e.key==='Escape'&&openingActive)stopOpening();
    if(e.key==='Escape'&&facePickEnabled)setFacePickMode(false);
    if(e.key.toLowerCase()==='f')focusSelected();
    if(e.key.toLowerCase()==='h')setCameraNavigation(cameraNavMode==='pan'?'orbit':'pan');
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save('glb');}
    if(e.key.toLowerCase()==='g')changeMode('translate');
    if(e.key.toLowerCase()==='r')changeMode('rotate');
    if(e.key.toLowerCase()==='s'&&!e.ctrlKey)changeMode('scale');
    if(e.key.toLowerCase()==='p')screenshot();
  });
}
const resizeObserver=new ResizeObserver(()=>{
  const w=Math.max(1,viewport.clientWidth),h=Math.max(1,viewport.clientHeight);
  camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
});
resizeObserver.observe(viewport);
let lastDraw=0;
function loop(now=0){requestAnimationFrame(loop);if(document.hidden || (lowMemoryMobile && now-lastDraw<32))return;lastDraw=now;orbit.update();renderer.render(scene,camera);}
initEvents();setCameraNavigation('orbit');refresh();loop();
