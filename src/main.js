
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {OBJExporter} from 'three/addons/exporters/OBJExporter.js';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {bendGeometry, cleanDegenerate, cropGeometry, removeSmallIslands, countTriangles, createConstruction} from './meshOps.js';

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
orbit.screenSpacePanning=true; orbit.minDistance=.07; orbit.maxDistance=250;
scene.add(new THREE.HemisphereLight(0xc2deff,0x4d382b,2.2));
const key=new THREE.DirectionalLight(0xffe4bd,3.2);key.position.set(7,12,9);scene.add(key);
const fill=new THREE.DirectionalLight(0x8baeea,1.2);fill.position.set(-7,6,-8);scene.add(fill);
const grid=new THREE.GridHelper(80,160,0x52647a,0x344254);grid.position.y=-.004;scene.add(grid);
const root=new THREE.Group();root.name='Редактируемые модели';scene.add(root);
const transform=new TransformControls(camera,renderer.domElement);
scene.add(transform.getHelper());
let selected=null,selectionBox=new THREE.BoxHelper(new THREE.Object3D(),0xe5b965);
selectionBox.visible=false;scene.add(selectionBox);
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
function view(axis) {
  const center=orbit.target.clone(),d=Math.max(camera.position.distanceTo(center),3);
  if(axis==='front')camera.position.set(center.x,center.y,center.z+d);
  if(axis==='side')camera.position.set(center.x+d,center.y,center.z);
  if(axis==='top')camera.position.set(center.x,center.y+d,center.z+.001);
  camera.lookAt(center);orbit.update();
}
function refresh(){
  const stat=countTriangles(root);
  $('stats').textContent=stat.triangles.toLocaleString('ru-RU')+' трис · '+stat.meshes+' мешей';
  $('objectCount').textContent=String(stat.meshes);
  $('objectTree').replaceChildren();
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
}
function select(obj){
  if(obj && !obj.isMesh)return;
  selected=obj;transform.detach();
  if(obj){
    transform.attach(obj);
    selectionBox.setFromObject(obj);selectionBox.visible=true;
  } else selectionBox.visible=false;
  refresh();
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
function activeMaterial(){
  return new THREE.MeshStandardMaterial({color:$('decorColor').value,metalness:Number($('metal').value),roughness:Number($('rough').value),side:THREE.DoubleSide});
}
function addObject(m){
  snapshot();root.add(m);select(m.isMesh?m:m.children.find(c=>c.isMesh)||null);fitCamera();
  notify('Добавлено. Объект можно перемещать и сохранять.');
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
    if(Array.isArray(selected.material))selected.material=selected.material[0].clone();
    selectionBox.setFromObject(selected);refresh();
    notify(description+' · '+(out.before!==undefined?(out.before-out.after)+' треугольников удалено':'готово'));
  }catch(e){console.error(e);notify('Ошибка: '+e.message,true);}
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
  selectionBox.setFromObject(selected);refresh();
}
function applyDimensions(){
  if(!eligible())return;
  const dim=['dimX','dimY','dimZ'].map(id=>Number($(id).value));
  if(dim.some(v=>!Number.isFinite(v)||v<=0))return notify('Размеры должны быть больше нуля',true);
  const sizes=new THREE.Box3().setFromObject(selected).getSize(new THREE.Vector3());
  snapshot();
  selected.scale.set(selected.scale.x*(dim[0]/Math.max(.0001,sizes.x)),selected.scale.y*(dim[1]/Math.max(.0001,sizes.y)),selected.scale.z*(dim[2]/Math.max(.0001,sizes.z)));
  selectionBox.setFromObject(selected);refresh();notify('Размеры изменены по каждой оси');
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
  snapshot();selected.position.y-=bounds.min.y;refresh();notify('Объект установлен на уровень Y = 0');
}
function isolateSelection(){
  if(!selected)return notify('Выделите объект');
  isolate=!isolate;
  root.traverse(o=>{if(o.isMesh)o.visible=!isolate||o===selected;});
  $('isolateBtn').classList.toggle('active',isolate);refresh();
}
function deleteSelection(){
  if(!selected)return;
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
    obj.name=file.name;root.add(obj);fileBase=safeName(file.name.replace(/\.[^.]+$/,''));
    const mesh=(()=>{let v=null;obj.traverse(o=>{if(!v&&o.isMesh)v=o;});return v;})();
    select(mesh);fitCamera();
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
async function save(format){
  if(!root.children.length)return notify('Сцена пуста',true);
  if(busy)return;busy=true;setStatus('Экспорт '+format.toUpperCase()+'...');
  try{
    let content,mime,extension=format;
    if(format==='glb'||format==='gltf'){
      const exporter=new GLTFExporter();
      const serialized=await exporter.parseAsync(root,{
        binary:format==='glb',onlyVisible:false,trs:false,maxTextureSize:2048,
        includeCustomExtensions:false
      });
      content=format==='glb'?new Blob([serialized],{type:'model/gltf-binary'}):new Blob([JSON.stringify(serialized)],{type:'model/gltf+json'});
    } else if(format==='obj') {
      content=new Blob([new OBJExporter().parse(root)],{type:'text/plain'});
    } else if(format==='stl'){
      content=new Blob([new STLExporter().parse(root,{binary:false})],{type:'model/stl'});
    } else throw new Error('Неизвестный формат');
    await downloadBlob(content,fileBase+'.'+extension);notify('Файл подготовлен: '+fileBase+'.'+extension);
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
  $('filePicker').onchange=async e=>{await importFile(e.target.files[0]);e.target.value='';};
  $('sampleBtn').onclick=sample;
  $('resetCamera').onclick=fitCamera;$('viewFit').onclick=fitCamera;
  $('viewFront').onclick=()=>view('front');$('viewSide').onclick=()=>view('side');$('viewTop').onclick=()=>view('top');
  $('exportBtn').onclick=()=>save('glb');$('saveBtn').onclick=()=>save($('format').value);
  $('clearSelection').onclick=()=>select(null);
  $('undoBtn').onclick=undo;$('redoBtn').onclick=redo;
  $('centerPivot').onclick=centerPivot;$('groundBtn').onclick=ground;
  $('deleteBtn').onclick=deleteSelection;$('isolateBtn').onclick=isolateSelection;
  $('bakeBtn').onclick=bakeAll;
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
  $('emblemBtn').onclick=canvasEmblem;
  $('textureBtn').onclick=()=>$('imagePicker').click();
  $('imagePicker').onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const url=URL.createObjectURL(f);
    new THREE.TextureLoader().load(url,tx=>{
      tx.colorSpace=THREE.SRGBColorSpace;addEmblem(tx);setTimeout(()=>URL.revokeObjectURL(url),10000);
    },undefined,()=>{notify('Не удалось прочитать изображение',true);URL.revokeObjectURL(url);});
    e.target.value='';
  };
  document.querySelectorAll('#toolTabs button').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('#toolTabs button').forEach(n=>n.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(n=>n.classList.remove('active'));
    b.classList.add('active');$('tab-'+b.dataset.tab).classList.add('active');
  });
  $('mobileTools').onclick=()=>{$('mobileTools').classList.toggle('active');document.querySelector('.sidebar.left').classList.toggle('mobile-open');document.querySelector('.sidebar.right').classList.remove('mobile-open');};
  $('mobileScene').onclick=()=>{document.querySelector('.sidebar.right').classList.toggle('mobile-open');document.querySelector('.sidebar.left').classList.remove('mobile-open');};
  transform.addEventListener('dragging-changed',event=>{orbit.enabled=!event.value;if(event.value){snapshot();dragged=true;}else{refresh();selectionBox.visible=!!selected;}});
  transform.addEventListener('objectChange',()=>{if(selected){selectionBox.setFromObject(selected);updateProperties();}});
  let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,time:performance.now()};});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down||!orbit.enabled)return;
    const distance=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;
    if(distance>8)return;
    const rect=renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hits=raycaster.intersectObjects(root.children,true).filter(h=>h.object.isMesh&&h.object.visible);
    if(hits.length)select(hits[0].object);
  });
  viewport.addEventListener('dragover',e=>e.preventDefault());
  viewport.addEventListener('drop',e=>{e.preventDefault();importFile(e.dataTransfer.files[0]);});
  window.addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    if(e.key==='Delete')deleteSelection();
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
initEvents();refresh();loop();
