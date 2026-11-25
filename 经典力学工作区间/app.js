/* Canvas 编辑器与渲染。普通脚本，可直接通过 file:// 离线运行。 */
(function(){
"use strict";
const P=globalThis.PhysicsLab,$=id=>document.getElementById(id),canvas=$("world"),ctx=canvas.getContext("2d");
let scene=P.presets["轨道与滑块"](),initial=P.clone(scene),running=false,simTime=0,timeScale=1,accumulator=0,lastTime=0,needsPrepare=true;
let tool="select",selectedId=null,pending=null,dragging=null,panning=null,dirty=true,lastInspection=0,snapHint=null;
let view={cx:5,cy:3,zoom:1},width=1,height=1,dpr=1,scale=1,propertyTimer=0;
const pointer={x:5,y:3,sx:0,sy:0,inside:false},trails=new Map();
const drafts={
  ball:{vx:0,vy:0,mass:1,radius:.25,charge:0,restitution:.3,friction:.4},
  board:{length:4,thickness:.16,angle:0,mass:3,fixed:true,restitution:.2,friction:.35},
  wall:{restitution:.3,friction:.3},anchor:{},
  track:{length:4,angle:0},arc:{radius:1.5,sweep:90,angle:0},
  slider:{speed:0,mass:1,friction:.08,width:.48,height:.28},
  spring:{stiffness:20,restLength:0,initialLength:0,damping:.1},
  rope:{length:2,autoLength:true}
};
const toolNames={select:"选择",ball:"新建小球",board:"新建木板",wall:"新建墙壁",anchor:"新建锚点",track:"新建直线轨道",arc:"新建弯道轨道",slider:"新建滑块",spring:"新建弹簧",rope:"新建绳子"};
const kindNames={ball:"小球",board:"木板",wall:"墙壁",anchor:"锚点",track:"轨道",slider:"滑块",spring:"弹簧",rope:"绳子"};
const toolHints={
  select:"点击选择器材；拖动可调整位置，固定轨道需在侧栏改参数",
  ball:"移动鼠标预览位置，点击放球；靠近木板或墙壁自动贴合表面",
  board:"依次点击木板的两个端点",wall:"依次点击墙壁的两个端点",
  anchor:"点击放锚点；靠近木板会将其钉成转轴",
  track:"点击放置固定直线轨道；靠近已有轨道端点自动拼接并对齐方向",
  arc:"点击放置固定弯道；正角度向左弯，负角度向右弯，端点自动吸附",
  slider:"将鼠标靠近轨道并点击；滑块始终受轨道约束",
  spring:"依次点击球、滑块或锚点；可分别设置原长和初始长度",
  rope:"依次点击两个球、滑块或锚点；绳子只传递拉力"
};
const commonBall=[["vx","初速度 vx","number","m/s"],["vy","初速度 vy","number","m/s"],["mass","质量","number","kg"],["radius","半径","number","m"],["charge","电荷","number","C"],["restitution","弹性系数"],["friction","摩擦系数"]];
const fieldSets={
  ball:[["x","位置 x","number","m"],["y","位置 y","number","m"],...commonBall],
  board:[["x","中心 x","number","m"],["y","中心 y","number","m"],["vx","速度 vx","number","m/s"],["vy","速度 vy","number","m/s"],["length","长度","number","m"],["thickness","厚度","number","m"],["angle","角度","number","°"],["omega","角速度","number","rad/s"],["mass","质量","number","kg"],["fixed","固定于世界","checkbox"],["restitution","弹性系数"],["friction","摩擦系数"]],
  wall:[["ax","起点 x","number","m"],["ay","起点 y","number","m"],["bx","终点 x","number","m"],["by","终点 y","number","m"],["restitution","弹性系数"],["friction","摩擦系数"]],
  anchor:[["x","位置 x","number","m"],["y","位置 y","number","m"]],
  slider:[["s","轨道位置","number","m"],["speed","切向速度","number","m/s"],["mass","质量","number","kg"],["friction","运动阻尼"],["width","滑块宽度","number","m"],["height","滑块高度","number","m"]],
  spring:[["stiffness","劲度系数 k","number","N/m"],["restLength","原长","number","m"],["initialLength","初始长度","number","m"],["autoRestLength","移动端点时原长同步","checkbox"],["damping","阻尼系数"]],
  rope:[["length","绳长","number","m"],["autoLength","开始时按端点距离取长","checkbox"]]
};
function fieldsFor(item,kind){
  if(item){
    if(kind==="track")return [["x","起点 x","number","m"],["y","起点 y","number","m"],["angle","起点朝向","number","°"],...(item.shape==="arc"?[["radius","半径","number","m"],["sweep","圆心角","number","°"]]:[["length","轨道长度","number","m"]])];
    return fieldSets[kind]||[];
  }
  return {ball:commonBall,board:[["length","默认长度","number","m"],["thickness","厚度","number","m"],["angle","默认角度","number","°"],["mass","质量","number","kg"],["fixed","固定于世界","checkbox"],["restitution","弹性系数"],["friction","摩擦系数"]],
    wall:[["restitution","弹性系数"],["friction","摩擦系数"]],anchor:[],track:[["length","轨道长度","number","m"],["angle","轨道方向","number","°"]],
    arc:[["radius","弯道半径","number","m"],["sweep","圆心角（±）","number","°"],["angle","起点方向","number","°"]],
    slider:fieldSets.slider.filter(([key])=>key!=="s"),spring:fieldSets.spring,rope:fieldSets.rope}[kind]||[];
}
const envIds={g:"gravity",airDrag:"drag",electricX:"electric-x",electricY:"electric-y",coulombConstant:"coulomb",gravitationalConstant:"gravitation"};
const selected=()=>P.getObject(scene,selectedId);
function status(text){$("status").textContent=text;}
function mark(){dirty=true;}
function updateCounts(){const count=["balls","boards","walls","anchors","tracks","sliders","springs","ropes"].reduce((n,key)=>n+scene[key].length,0);$("object-count").textContent=`${count} 个器材`;$("scene-name").textContent=scene.name;}
function commit(rebuildForm=false){
  P.syncAnchors(scene);P.reindex(scene);P.syncSliders(scene);initial=P.clone(scene);needsPrepare=true;updateCounts();
  if(rebuildForm)buildProperties();mark();
}
function setTool(value){
  tool=value;selectedId=null;pending=null;dragging=null;
  document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===value));
  canvas.style.cursor=value==="select"?"default":"crosshair";buildProperties();updateInspection();status(toolHints[value]);mark();
}
function select(item){selectedId=item?item.id:null;buildProperties();updateInspection();mark();}
function lockUI(){
  document.querySelectorAll("[data-tool],#delete,#preset,#load,#environment input,#environment button").forEach(el=>el.disabled=running);
  $("properties").querySelectorAll("input,button").forEach(el=>el.disabled=running);
  if(running){dragging=null;pending=null;}
}
function togglePlay(){
  running=!running;
  if(running){trails.clear();P.prepareStart(scene);needsPrepare=false;initial=P.clone(scene);}
  $("play").innerHTML=running?'<span class="play-icon">Ⅱ</span><span>暂停</span>':'<span class="play-icon">▶</span><span>开始</span>';
  $("run-dot").classList.toggle("running",running);document.querySelector(".edit-tag").textContent=running?"运行中":"编辑模式";
  lastTime=0;accumulator=0;lockUI();status(running?"模拟运行中 · 点击暂停继续编辑":"已暂停 · 可以继续编辑");mark();
}
function reset(){scene=P.clone(initial);running=false;$("play").innerHTML='<span class="play-icon">▶</span><span>开始</span>';$("run-dot").classList.remove("running");simTime=0;accumulator=0;trails.clear();pending=null;dragging=null;needsPrepare=true;select(null);syncEnvironment();lockUI();updateCounts();mark();}
function singleStep(){if(running)return;if(needsPrepare){P.prepareStart(scene);needsPrepare=false;}P.step(scene,P.DT);simTime+=P.DT;recordTrails();mark();updateInspection();}
function setTimeScale(value){
  const next=Number(value);if(!Number.isFinite(next)||next<=0)return;
  timeScale=next;$("time-speed").value=String(next);status(`时间流速已设为 ${next}× · 物理步长保持 ${(P.DT*1000).toFixed(2)} ms`);
}
function remove(){if(running)return;if(selectedId&&P.removeObject(scene,selectedId)){selectedId=null;commit(true);updateInspection();status("已删除器材及其失效连接");}}
function syncEnvironment(){$("gravity-enabled").checked=scene.gravityEnabled;for(const [key,id]of Object.entries(envIds))$(id).value=scene[key];$("time").innerHTML=`${simTime.toFixed(3)} <small>s</small>`;}

function inputValue(item,key){const source=item||drafts[tool];if(item&&(key==="angle"||key==="sweep"))return source[key]*180/Math.PI;return source[key]??0;}
function buildProperties(){
  clearTimeout(propertyTimer);const form=$("properties"),item=selected(),kind=item?item.kind:tool;form.replaceChildren();
  $("property-title").textContent=item?`${kindNames[kind]}参数`:(toolNames[tool]||"器材参数");
  $("property-mode").textContent=item?item.id:(tool==="select"?"未选择":"放置预设");
  if(kind==="select"&&!item){form.innerHTML='<div class="empty-state"><span>↖</span><p>选择左侧器材开始放置<br>或点击画布中的物体</p></div>';return;}
  const fields=fieldsFor(item,kind);
  if(item&&kind==="spring"){
    const ends=P.linkEndpoints(scene,item),distance=ends?Math.hypot(ends[1].x-ends[0].x,ends[1].y-ends[0].y):0;
    const row=document.createElement("div");row.className="field";
    const label=document.createElement("label");label.textContent="当前实际长度";label.htmlFor="prop-current-length";
    const input=document.createElement("input");input.id="prop-current-length";input.type="number";input.step="any";input.value=distance;input.readOnly=true;input.tabIndex=-1;
    row.append(label,input);form.append(row);
  }
  for(const [key,label,type="number",unit=""]of fields){
    const row=document.createElement("div");row.className=type==="checkbox"?"check":"field";
    const lab=document.createElement("label");lab.textContent=label;lab.htmlFor=`prop-${key}`;
    const input=document.createElement("input");input.id=`prop-${key}`;input.name=key;
    if(type==="checkbox"){input.type="checkbox";input.checked=Boolean(inputValue(item,key));row.append(input,lab);}
    else{
      input.type="number";input.step="any";input.required=true;input.value=inputValue(item,key);
      if(unit){const wrap=document.createElement("div");wrap.className="number-unit";wrap.append(input);const u=document.createElement("span");u.textContent=unit;wrap.append(u);row.append(lab,wrap);}
      else row.append(lab,input);
    }
    input.disabled=running||(item&&kind==="board"&&["x","y"].includes(key)&&scene.anchors.some(a=>a.boardId===item.id));form.append(row);
  }
  if(!fields.length){const p=document.createElement("p");p.className="form-note";p.textContent="移动鼠标查看预设位置，点击画布放置。靠近木板时会自动建立转轴。";form.append(p);}
  if(item&&kind==="track"){const p=document.createElement("p");p.className="form-note";p.textContent="轨道固定于世界。更改起点、方向、半径或圆心角会即时重塑轨道，滑块仍保持约束。";form.append(p);}
  if(item&&kind==="slider"){const p=document.createElement("p");p.className="form-note";p.textContent=`所属轨道：${item.trackId}。拖动滑块可改变轨道位置，不会脱离轨道。`;form.append(p);}
  if(item&&kind==="spring"){const p=document.createElement("p");p.className="form-note";p.textContent="默认移动小球时，原长与实际长度同步且保持相等。手动修改原长会自动关闭同步，保留你设置的形变量。";form.append(p);}
  if(!item&&kind==="spring"){const p=document.createElement("p");p.className="form-note";p.textContent="原长或实际长度填 0 时，采用连接端点的当前距离；两者都填 0 时默认保持原长等于实际长度。";form.append(p);}
  const button=document.createElement("button");button.type="submit";button.className="apply";button.textContent=item?"更新参数":"应用为放置预设";button.disabled=running;form.append(button);
}
function checkField(key,value){if(!Number.isFinite(value))throw new Error(`${key} 不是有效数值`);if(["mass","radius","length","thickness","width","height","restLength"].includes(key)&&value<=(key==="restLength"?-1:0))throw new Error(`${key} 必须为正数`);if(key==="initialLength"&&value<0)throw new Error("初始长度不能为负数");if(key==="restitution"&&(value<0||value>1))throw new Error("弹性系数必须在 0～1 之间");if(["friction","damping","stiffness"].includes(key)&&value<0)throw new Error(`${key} 不能为负数`);if(key==="sweep"&&(value===0||Math.abs(value)>360))throw new Error("圆心角应在 ±360° 之间且不能为 0");}
function applyProperties(){
  if(running)return false;const item=selected(),kind=item?item.kind:tool,target=item||drafts[tool];if(!target||kind==="select")return false;
  const fields=fieldsFor(item,kind),backup={};for(const [key]of fields)backup[key]=target[key];
  try{
    for(const [key,,type="number"]of fields){
      const control=$("properties").elements.namedItem(key);if(!control)continue;
      if(type==="checkbox"){target[key]=control.checked;continue;}
      if(control.value.trim()==="")return false;
      const value=Number(control.value);checkField(key,value);
      if(item){if(key==="angle"||key==="sweep")target[key]=value*Math.PI/180;else target[key]=value;}
      else target[key]=value;
    }
    if(item&&kind==="track"&&item.shape==="arc"){
      const direction=Math.sign(item.sweep)||1;
      item.startAngle=item.angle-direction*Math.PI/2;
      item.cx=item.x-item.radius*Math.cos(item.startAngle);
      item.cy=item.y-item.radius*Math.sin(item.startAngle);
    }
    if(item&&kind==="spring"){
      const lengthEdited=item.restLength!==backup.restLength||item.initialLength!==backup.initialLength;
      if(lengthEdited)item.autoRestLength=false;
      if(item.autoRestLength&&backup.autoRestLength===false){
        const ends=P.linkEndpoints(scene,item);
        if(ends){const distance=Math.max(.01,Math.hypot(ends[1].x-ends[0].x,ends[1].y-ends[0].y));item.restLength=distance;item.initialLength=distance;}
      }
    }
    if(item)P.validate(scene);
    if(item&&kind==="spring")P.applySpringInitialLength(scene,item);
    commit();updateInspection();status(item?"参数已即时更新":"放置预设已更新");mark();return true;
  }catch(error){Object.assign(target,backup);status(`参数无效：${error.message}`);mark();return false;}
}
$("properties").addEventListener("submit",event=>{
  event.preventDefault();
  const item=selected(),kind=item?item.kind:tool;
  for(const [key]of fieldsFor(item,kind)){const control=event.target.elements.namedItem(key);if(control&&control.type==="number"&&control.value.trim()==="")return;}
  if(applyProperties()&&document.activeElement instanceof HTMLElement)document.activeElement.blur();
});
$("properties").addEventListener("input",event=>{if(!event.target.matches('input[type="number"]'))return;clearTimeout(propertyTimer);applyProperties();});
$("properties").addEventListener("change",event=>{if(event.target.matches('input[type="checkbox"]'))applyProperties();});
$("properties").addEventListener("keydown",event=>{if(event.key==="Enter"&&event.target.matches("input")){event.preventDefault();clearTimeout(propertyTimer);event.currentTarget.requestSubmit();}});
function refreshPropertyValues(){const item=selected();if(!item||$("properties").contains(document.activeElement))return;if(item.kind==="spring"){const current=$("prop-current-length"),ends=P.linkEndpoints(scene,item);if(current&&ends)current.value=Math.hypot(ends[1].x-ends[0].x,ends[1].y-ends[0].y);}for(const [key,,type="number"]of fieldsFor(item,item.kind)){const input=$("properties").elements.namedItem(key);if(!input)continue;if(type==="checkbox")input.checked=Boolean(item[key]);else input.value=inputValue(item,key);}}
$("environment").addEventListener("submit",event=>{
  event.preventDefault();if(running)return;const old={gravityEnabled:scene.gravityEnabled};for(const key of Object.keys(envIds))old[key]=scene[key];
  try{scene.gravityEnabled=$("gravity-enabled").checked;for(const [key,id]of Object.entries(envIds)){const value=Number($(id).value);if(!Number.isFinite(value)||((key==="airDrag"||key==="coulombConstant"||key==="gravitationalConstant")&&value<0))throw new Error("环境参数无效");scene[key]=value;}P.validate(scene);commit();status("环境参数已应用");if(document.activeElement instanceof HTMLElement)document.activeElement.blur();}catch(error){Object.assign(scene,old);syncEnvironment();status(error.message);}
});
$("gravity-enabled").addEventListener("change",event=>{if(running){event.target.checked=scene.gravityEnabled;return;}scene.gravityEnabled=event.target.checked;commit();event.target.blur();status(scene.gravityEnabled?"重力已开启":"重力已关闭");});
$("environment").addEventListener("keydown",event=>{if(event.key==="Enter"&&event.target.matches("input")){event.preventDefault();event.currentTarget.requestSubmit();}});

function resize(){const rect=canvas.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);dpr=Math.min(2,globalThis.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);mark();}
new ResizeObserver(resize).observe(canvas);
function worldToScreen(x,y){return [width/2+(x-view.cx)*scale,height/2-(y-view.cy)*scale];}
function screenToWorld(x,y){return [view.cx+(x-width/2)/scale,view.cy-(y-height/2)/scale];}
function pointSegment(x,y,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy,u=l2?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/l2)):0,px=ax+u*dx,py=ay+u*dy;return {x:px,y:py,d:Math.hypot(x-px,y-py),u};}
function boardSurface(board,x,y){const c=Math.cos(board.angle),s=Math.sin(board.angle),dx=x-board.x,dy=y-board.y,qx=c*dx+s*dy,qy=-s*dx+c*dy,hx=board.length/2,hy=board.thickness/2,cx=Math.max(-hx,Math.min(hx,qx)),cy=Math.max(-hy,Math.min(hy,qy)),ddx=qx-cx,ddy=qy-cy,d=Math.hypot(ddx,ddy);let nx=ddx,ny=ddy;if(d<1e-9){const faces=[[hx-qx,1,0],[hx+qx,-1,0],[hy-qy,0,1],[hy+qy,0,-1]].sort((a,b)=>a[0]-b[0]);nx=faces[0][1];ny=faces[0][2];}else{nx/=d;ny/=d;}return {x:board.x+c*cx-s*cy,y:board.y+s*cx+c*cy,nx:c*nx-s*ny,ny:s*nx+c*ny,d};}
function connectableAt(x,y){
  for(let i=scene.anchors.length-1;i>=0;i--){const a=scene.anchors[i],[ax,ay]=P.anchorPosition(scene,a);if(Math.hypot(x-ax,y-ay)<Math.max(.16,9/scale))return a;}
  for(let i=scene.balls.length-1;i>=0;i--){const b=scene.balls[i];if(Math.hypot(x-b.x,y-b.y)<=b.radius+.09)return b;}
  for(let i=scene.sliders.length-1;i>=0;i--){const slider=scene.sliders[i],p=P.sliderPoint(scene,slider);if(p&&Math.hypot(x-p.x,y-p.y)<Math.max(slider.width*.65,10/scale))return slider;}
  return null;
}
function hitTest(x,y){
  const endpoint=connectableAt(x,y);if(endpoint)return endpoint;
  for(const link of [...scene.springs,...scene.ropes]){const ends=P.linkEndpoints(scene,link);if(ends&&pointSegment(x,y,ends[0].x,ends[0].y,ends[1].x,ends[1].y).d<Math.max(.07,5/scale))return link;}
  for(let i=scene.boards.length-1;i>=0;i--){const b=scene.boards[i],c=Math.cos(b.angle),s=Math.sin(b.angle),dx=x-b.x,dy=y-b.y;if(Math.abs(c*dx+s*dy)<=b.length/2+.08&&Math.abs(-s*dx+c*dy)<=b.thickness/2+.08)return b;}
  for(let i=scene.tracks.length-1;i>=0;i--){if(P.projectTrack(scene.tracks[i],x,y).d<Math.max(.1,6/scale))return scene.tracks[i];}
  for(let i=scene.walls.length-1;i>=0;i--){const w=scene.walls[i];if(pointSegment(x,y,w.ax,w.ay,w.bx,w.by).d<Math.max(.08,6/scale))return w;}
  return null;
}
function snapBall(ball,x,y){
  if(!$("snap-enabled").checked)return {x,y,snapped:false};let best=null;const tolerance=16/scale;
  for(const board of scene.boards){const p=boardSurface(board,x,y),delta=Math.abs(p.d-ball.radius);if(delta<tolerance&&(!best||delta<best.delta))best={x:p.x+p.nx*ball.radius,y:p.y+p.ny*ball.radius,delta};}
  for(const wall of scene.walls){
    const p=pointSegment(x,y,wall.ax,wall.ay,wall.bx,wall.by),delta=Math.abs(p.d-ball.radius);
    if(delta<tolerance&&(!best||delta<best.delta)){
      const length=Math.hypot(wall.bx-wall.ax,wall.by-wall.ay)||1;
      const nx=p.d>1e-9?(x-p.x)/p.d:-(wall.by-wall.ay)/length,ny=p.d>1e-9?(y-p.y)/p.d:(wall.bx-wall.ax)/length;
      best={x:p.x+nx*ball.radius,y:p.y+ny*ball.radius,delta};
    }
  }
  return best?{x:best.x,y:best.y,snapped:true}:{x,y,snapped:false};
}
function snapAnchor(anchor,x,y){
  P.detachAnchor(scene,anchor);anchor.x=x;anchor.y=y;let best=null;const tolerance=$("snap-enabled").checked?16/scale:0;
  for(const other of scene.anchors)if(other!==anchor){const [ox,oy]=P.anchorPosition(scene,other),d=Math.hypot(x-ox,y-oy);if(d<tolerance&&(!best||d<best.d))best={x:ox,y:oy,d};}
  if(best){anchor.x=best.x;anchor.y=best.y;}
  for(const board of scene.boards){const p=boardSurface(board,anchor.x,anchor.y);if(p.d<tolerance&&(!best||p.d<best.d))best={x:p.x,y:p.y,d:p.d,board};}
  if(best){anchor.x=best.x;anchor.y=best.y;if(best.board)P.attachAnchor(scene,anchor,best.board);snapHint={x:anchor.x,y:anchor.y};}
  return anchor;
}
function trackPlacement(shape,x,y){
  const draft=drafts[shape];let angle=draft.angle*Math.PI/180,snapped=false;
  if($("snap-enabled").checked){
    let best=null;for(const track of scene.tracks){const ends=P.trackEndpoints(track);for(let i=0;i<2;i++){const d=Math.hypot(x-ends[i].x,y-ends[i].y);if(d<24/scale&&(!best||d<best.d))best={...ends[i],index:i,d};}}
    if(best){x=best.x;y=best.y;angle=Math.atan2(best.ty,best.tx)+(best.index===0?Math.PI:0);snapped=true;}
  }
  return {x,y,angle,snapped};
}
function previewTrack(shape,placement){const d=drafts[shape];if(shape==="track")return {kind:"track",id:"preview",shape:"line",x:placement.x,y:placement.y,length:d.length,angle:placement.angle,fixed:true};const sweep=d.sweep*Math.PI/180,direction=Math.sign(sweep)||1,startAngle=placement.angle-direction*Math.PI/2;return {kind:"track",id:"preview",shape:"arc",x:placement.x,y:placement.y,angle:placement.angle,radius:d.radius,sweep,startAngle,cx:placement.x-d.radius*Math.cos(startAngle),cy:placement.y-d.radius*Math.sin(startAngle),fixed:true};}
function nearestTrack(x,y){let best=null;for(const track of scene.tracks){const point=P.projectTrack(track,x,y);if(!best||point.d<best.point.d)best={track,point};}return best;}
function pointerPosition(event){const r=canvas.getBoundingClientRect();return [event.clientX-r.left,event.clientY-r.top];}
function updatePointer(event){const [sx,sy]=pointerPosition(event),[x,y]=screenToWorld(sx,sy);Object.assign(pointer,{sx,sy,x,y,inside:true});$("cursor-pos").textContent=`x ${x.toFixed(2)}  y ${y.toFixed(2)}`;mark();}

canvas.addEventListener("pointerdown",event=>{
  updatePointer(event);const {sx,sy,x,y}=pointer;
  if(event.button===2||event.button===1){panning={sx,sy,cx:view.cx,cy:view.cy};canvas.setPointerCapture(event.pointerId);return;}
  if(event.button!==0)return;
  if(running){if(tool==="select"&&!hitTest(x,y)){panning={sx,sy,cx:view.cx,cy:view.cy};canvas.setPointerCapture(event.pointerId);}else status("请先暂停，再编辑器材");return;}
  if(tool==="ball"){const pos=snapBall(drafts.ball,x,y),b=P.Ball(pos.x,pos.y,{...drafts.ball});scene.balls.push(b);commit();select(b);return;}
  if(tool==="board"||tool==="wall"){
    if(!pending){pending={x,y};status(`点击${tool==="board"?"木板":"墙壁"}的另一个端点`);return;}
    const dx=x-pending.x,dy=y-pending.y,length=Math.hypot(dx,dy);if(length<.1){status("长度太短，请重新点击");return;}
    const item=tool==="board"?P.Board((x+pending.x)/2,(y+pending.y)/2,{...drafts.board,length,angle:Math.atan2(dy,dx)}):P.Wall(pending.x,pending.y,x,y,{...drafts.wall});
    scene[tool==="board"?"boards":"walls"].push(item);pending=null;commit();select(item);return;
  }
  if(tool==="anchor"){const a=P.Anchor(x,y);snapAnchor(a,x,y);scene.anchors.push(a);commit();select(a);snapHint=null;return;}
  if(tool==="track"||tool==="arc"){
    const p=trackPlacement(tool,x,y),d=drafts[tool],track=tool==="track"?P.LineTrack(p.x,p.y,d.length,p.angle):P.ArcTrack(p.x,p.y,d.radius,d.sweep,p.angle);
    scene.tracks.push(track);commit();select(track);status(p.snapped?"轨道已吸附拼接，切线方向已对齐":"固定轨道已放置");return;
  }
  if(tool==="slider"){
    const near=nearestTrack(x,y);if(!near||near.point.d>26/scale){status("请将鼠标靠近一条轨道后再放置滑块");return;}
    const slider=P.Slider(near.track.id,near.point.s,{...drafts.slider});scene.sliders.push(slider);commit();select(slider);return;
  }
  if(tool==="spring"||tool==="rope"){
    const hit=connectableAt(x,y);if(!hit){status("连接端点必须是小球、滑块或锚点");return;}
    if(!pending){pending={endpointId:hit.id};status(`已选择 ${hit.id}，再点击另一个端点`);return;}
    if(hit.id===pending.endpointId){status("两个端点不能相同");return;}
    let link;if(tool==="spring"){
      const d=drafts.spring,auto=d.restLength<=0&&d.initialLength<=0;
      link=P.Spring(pending.endpointId,hit.id,{...d,autoRestLength:auto,initialLength:d.initialLength>0?d.initialLength:null});
      scene.springs.push(link);P.reindex(scene);
      const ends=P.linkEndpoints(scene,link),distance=Math.hypot(ends[1].x-ends[0].x,ends[1].y-ends[0].y);
      if(!link.initialLength)link.initialLength=distance;
      if(d.restLength<=0)link.restLength=distance;
    }
    else{link=P.Rope(pending.endpointId,hit.id,{...drafts.rope});scene.ropes.push(link);P.reindex(scene);const ends=P.ropeEndpoints(scene,link),distance=Math.hypot(ends[1].x-ends[0].x,ends[1].y-ends[0].y);if(link.autoLength)link.length=Math.max(.01,distance);}
    pending=null;commit();select(link);return;
  }
  const hit=hitTest(x,y);select(hit);
  if(hit&&["ball","board","anchor","wall","slider"].includes(hit.kind)){
    dragging={item:hit,ox:(hit.x||0)-x,oy:(hit.y||0)-y,lastX:x,lastY:y};canvas.setPointerCapture(event.pointerId);
  }else if(!hit){panning={sx,sy,cx:view.cx,cy:view.cy};canvas.setPointerCapture(event.pointerId);}
});
canvas.addEventListener("pointermove",event=>{
  updatePointer(event);const {sx,sy,x,y}=pointer;
  if(panning){view.cx=panning.cx-(sx-panning.sx)/scale;view.cy=panning.cy+(sy-panning.sy)/scale;mark();return;}
  if(!dragging||running)return;const item=dragging.item;snapHint=null;
  if(item.kind==="ball"){const pos=snapBall(item,x+dragging.ox,y+dragging.oy);item.x=pos.x;item.y=pos.y;item.vx=item.vy=0;if(pos.snapped)snapHint=pos;}
  else if(item.kind==="board"){
    if(scene.anchors.some(a=>a.boardId===item.id)){status("木板被锚点钉住：请移动锚点，或在侧栏修改角度");}
    else{item.x=x+dragging.ox;item.y=y+dragging.oy;}item.vx=item.vy=item.omega=0;P.syncAnchors(scene);
  }else if(item.kind==="anchor")snapAnchor(item,x+dragging.ox,y+dragging.oy);
  else if(item.kind==="wall"){const dx=x-dragging.lastX,dy=y-dragging.lastY;item.ax+=dx;item.bx+=dx;item.ay+=dy;item.by+=dy;dragging.lastX=x;dragging.lastY=y;}
  else if(item.kind==="slider"){const near=nearestTrack(x,y);if(near&&near.point.d<35/scale){item.trackId=near.track.id;item.s=near.point.s;item.speed=0;snapHint=near.point;}}
  P.reindex(scene);
  if(["ball","slider","anchor"].includes(item.kind))P.syncSpringsForMovedEndpoint(scene,item.id);
  refreshPropertyValues();mark();
});
function pointerUp(){if(dragging){dragging=null;commit();refreshPropertyValues();}panning=null;snapHint=null;mark();}
canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("pointercancel",pointerUp);canvas.addEventListener("pointerleave",()=>{pointer.inside=false;mark();});canvas.addEventListener("contextmenu",event=>event.preventDefault());
canvas.addEventListener("wheel",event=>{event.preventDefault();updatePointer(event);const [wx,wy]=screenToWorld(pointer.sx,pointer.sy),factor=event.deltaY<0?1.1:.9;view.zoom=Math.max(.15,Math.min(12,view.zoom*factor));const newScale=baseScale()*view.zoom;view.cx=wx-(pointer.sx-width/2)/newScale;view.cy=wy+(pointer.sy-height/2)/newScale;mark();},{passive:false});
function baseScale(){return Math.min(width/10,height/6);}
function zoom(factor){view.zoom=Math.max(.15,Math.min(12,view.zoom*factor));mark();}
function fullView(){view={cx:5,cy:3,zoom:1};mark();}

function recordPoint(id,x,y){if(!trails.has(id))trails.set(id,[]);const data=trails.get(id);data.push([x,y]);if(data.length>1600)data.shift();}
function recordTrails(){for(const b of scene.balls)recordPoint(b.id,b.x,b.y);for(const slider of scene.sliders){const p=P.sliderPoint(scene,slider);if(p)recordPoint(slider.id,p.x,p.y);}}
function drawTrail(id,color){const data=trails.get(id);if(!data||data.length<2)return;ctx.strokeStyle=color;ctx.lineWidth=1;ctx.globalAlpha=.25;ctx.beginPath();data.forEach(([x,y],i)=>{const p=worldToScreen(x,y);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.stroke();ctx.globalAlpha=1;}
function lineWorld(ax,ay,bx,by){const a=worldToScreen(ax,ay),b=worldToScreen(bx,by);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);}
function pathTrack(track){const length=P.trackLength(track),segments=track.shape==="arc"?Math.max(12,Math.ceil(Math.abs(track.sweep)*24)):1;ctx.beginPath();for(let i=0;i<=segments;i++){const p=P.trackPoint(track,length*i/segments),screen=worldToScreen(p.x,p.y);i?ctx.lineTo(...screen):ctx.moveTo(...screen);}}
function drawTrack(track,ghost=false){
  const active=track.id===selectedId,color=ghost?"#62d9d0":active?"#ffbd72":"#6d91b5";ctx.save();if(ghost)ctx.globalAlpha=.55;ctx.lineCap="round";
  pathTrack(track);ctx.strokeStyle=ghost?"#214e55":"#172635";ctx.lineWidth=ghost?9:11;ctx.stroke();pathTrack(track);ctx.strokeStyle=color;ctx.lineWidth=active?3:2;ctx.stroke();
  const length=P.trackLength(track),count=Math.min(150,Math.floor(length/.34));ctx.strokeStyle=ghost?"#62d9d0":"#3e5a75";ctx.lineWidth=1;
  for(let i=0;i<=count;i++){const p=P.trackPoint(track,length*i/Math.max(1,count));ctx.beginPath();lineWorld(p.x-p.nx*.12,p.y-p.ny*.12,p.x+p.nx*.12,p.y+p.ny*.12);ctx.stroke();}
  for(const p of P.trackEndpoints(track)){const screen=worldToScreen(p.x,p.y);ctx.beginPath();ctx.arc(screen[0],screen[1],3.5,0,Math.PI*2);ctx.fillStyle="#0d1824";ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();}ctx.restore();
}
function drawBoard(b,ghost=false){const c=Math.cos(b.angle),s=Math.sin(b.angle),hx=b.length/2,hy=b.thickness/2;ctx.save();if(ghost)ctx.globalAlpha=.5;ctx.beginPath();[[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]].forEach(([x,y],i)=>{const p=worldToScreen(b.x+c*x-s*y,b.y+s*x+c*y);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();ctx.fillStyle=b.id===selectedId?"#eeb66f":b.fixed||b.locked?"#a77948":"#876eb1";ctx.fill();ctx.strokeStyle=b.id===selectedId?"#ffe0a3":b.fixed||b.locked?"#d5a064":"#b9a1e0";ctx.lineWidth=1.5;ctx.stroke();ctx.restore();}
function drawBall(ball,ghost=false){
  const p=worldToScreen(ball.x,ball.y),r=Math.max(1,ball.radius*scale);ctx.save();if(ghost)ctx.globalAlpha=.48;
  if(ball.id===selectedId&&!ghost){ctx.shadowColor="#69a8ff88";ctx.shadowBlur=18;}
  const gradient=ctx.createRadialGradient(p[0]-r*.35,p[1]-r*.4,r*.05,p[0],p[1],r);const base=ball.id===selectedId?"#ffc477":ball.charge>0?"#ff7582":ball.charge<0?"#56d6c3":"#67a9f5";gradient.addColorStop(0,"#e8f4ff");gradient.addColorStop(.22,base);gradient.addColorStop(1,"#244b77");ctx.beginPath();ctx.arc(p[0],p[1],r,0,Math.PI*2);ctx.fillStyle=gradient;ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=ball.id===selectedId?"#fff0c9":"#b9d7f4";ctx.lineWidth=ball.id===selectedId?2:1;ctx.stroke();
  if(ball.charge){ctx.fillStyle="#fff";ctx.font=`600 ${Math.max(10,r)}px system-ui`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(ball.charge>0?"+":"−",p[0],p[1]);}ctx.restore();
}
function drawAnchor(a,ghost=false){const [x,y]=P.anchorPosition(scene,a),p=worldToScreen(x,y);ctx.save();if(ghost)ctx.globalAlpha=.5;ctx.translate(...p);ctx.rotate(Math.PI/4);ctx.fillStyle=a.id===selectedId?"#ffc477":"#bfd1e3";ctx.fillRect(-3.5,-3.5,7,7);ctx.strokeStyle="#152235";ctx.lineWidth=1;ctx.strokeRect(-3.5,-3.5,7,7);ctx.restore();if(a.boardId){ctx.fillStyle="#ffbf72";ctx.fillRect(p[0]-1,p[1]-1,2,2);}}
function drawSlider(slider,point=null,ghost=false){
  point=point||P.sliderPoint(scene,slider);if(!point)return;const p=worldToScreen(point.x,point.y),w=Math.max(7,slider.width*scale),h=Math.max(5,slider.height*scale);ctx.save();ctx.translate(...p);ctx.rotate(-Math.atan2(point.ty,point.tx));if(ghost)ctx.globalAlpha=.5;
  ctx.fillStyle=slider.id===selectedId?"#ffc274":"#60d4c2";ctx.strokeStyle=slider.id===selectedId?"#fff0c5":"#b5fff1";ctx.lineWidth=1.4;ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,Math.min(4,h/4));ctx.fill();ctx.stroke();ctx.fillStyle="#173c42";ctx.fillRect(-w*.28,-1,w*.56,2);ctx.restore();
}
function drawLink(link,ghost=false){const ends=P.linkEndpoints(scene,link);if(!ends)return;const [a,b]=ends;ctx.save();if(ghost)ctx.globalAlpha=.5;ctx.strokeStyle=link.id===selectedId?"#ffc277":link.kind==="spring"?"#c5a0f2":"#a7b5c3";ctx.lineWidth=link.id===selectedId?2.5:1.5;ctx.beginPath();if(link.kind==="rope")lineWorld(a.x,a.y,b.x,b.y);else{const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),nx=d?-dy/d*Math.min(.1,d/12):0,ny=d?dx/d*Math.min(.1,d/12):0;for(let i=0;i<=28;i++){const t=i/28,sign=i%2?1:-1,p=worldToScreen(a.x+dx*t+(i===0||i===28?0:sign*nx),a.y+dy*t+(i===0||i===28?0:sign*ny));i?ctx.lineTo(...p):ctx.moveTo(...p);}}ctx.stroke();ctx.restore();}
function showSnap(point,text="已吸附"){const label=$("snap-label");label.hidden=false;label.textContent=text;label.style.left=`${pointer.sx}px`;label.style.top=`${pointer.sy}px`;snapHint=point;}
function drawPreview(){
  if(running||!pointer.inside||tool==="select"||dragging||panning)return;
  const {x,y}=pointer;
  if(tool==="ball"){const pos=snapBall(drafts.ball,x,y);drawBall({...drafts.ball,...pos,kind:"ball",id:"preview"},true);if(pos.snapped)showSnap(pos,"贴合表面");}
  else if(tool==="track"||tool==="arc"){const p=trackPlacement(tool,x,y),track=previewTrack(tool,p);drawTrack(track,true);if(p.snapped)showSnap(p,"端点已拼接");}
  else if(tool==="slider"){const near=nearestTrack(x,y);if(near&&near.point.d<30/scale){drawSlider({...drafts.slider,id:"preview"},near.point,true);showSnap(near.point,`吸附到 ${near.track.id}`);}}
  else if(tool==="anchor"){const a={kind:"anchor",id:"preview",x,y,boardId:null,localX:0,localY:0};snapAnchor(a,x,y);drawAnchor(a,true);if(snapHint)showSnap(snapHint,a.boardId?"吸附为木板转轴":"锚点已吸附");}
  else if((tool==="board"||tool==="wall")&&pending){if(tool==="board"){const dx=x-pending.x,dy=y-pending.y;drawBoard({...drafts.board,kind:"board",id:"preview",x:(x+pending.x)/2,y:(y+pending.y)/2,length:Math.hypot(dx,dy),angle:Math.atan2(dy,dx)},true);}else{ctx.save();ctx.globalAlpha=.5;ctx.strokeStyle="#a4b5c8";ctx.lineWidth=4;ctx.beginPath();lineWorld(pending.x,pending.y,x,y);ctx.stroke();ctx.restore();}}
  else if((tool==="spring"||tool==="rope")&&pending){const a=P.linkEndpoint(scene,pending.endpointId);if(a){ctx.save();ctx.setLineDash([5,5]);ctx.strokeStyle=tool==="spring"?"#c5a0f2":"#c1ccd7";ctx.lineWidth=1.5;ctx.beginPath();lineWorld(a.x,a.y,x,y);ctx.stroke();ctx.restore();}}
}
function drawField(left,right,bottom,top){const d=Math.hypot(scene.electricX,scene.electricY);if(d<1e-9)return;const nx=scene.electricX/d,ny=scene.electricY/d;ctx.strokeStyle="#46d9c2";ctx.fillStyle="#46d9c2";ctx.globalAlpha=.14;ctx.lineWidth=1;for(let x=Math.ceil(left);x<right;x+=2)for(let y=Math.ceil(bottom);y<top;y+=2){ctx.beginPath();lineWorld(x-.18*nx,y-.18*ny,x+.18*nx,y+.18*ny);ctx.stroke();const p=worldToScreen(x+.18*nx,y+.18*ny);ctx.fillRect(p[0]-1,p[1]-1,2,2);}ctx.globalAlpha=1;}
function render(){
  scale=baseScale()*view.zoom;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle="#0b131e";ctx.fillRect(0,0,width,height);
  const left=view.cx-width/(2*scale),right=view.cx+width/(2*scale),bottom=view.cy-height/(2*scale),top=view.cy+height/(2*scale);
  for(const [step,color]of [[.25,"#111d2a"],[1,"#1a2a3b"]]){ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();for(let x=Math.floor(left/step)*step;x<=right;x+=step)lineWorld(x,bottom,x,top);for(let y=Math.floor(bottom/step)*step;y<=top;y+=step)lineWorld(left,y,right,y);ctx.stroke();}
  drawField(left,right,bottom,top);for(const b of scene.balls)drawTrail(b.id,"#69a8ff");for(const s of scene.sliders)drawTrail(s.id,"#55d6c2");
  for(const w of scene.walls){ctx.strokeStyle=w.id===selectedId?"#ffbd72":"#718298";ctx.lineWidth=w.id===selectedId?5:3;ctx.lineCap="round";ctx.beginPath();lineWorld(w.ax,w.ay,w.bx,w.by);ctx.stroke();ctx.strokeStyle="#b6c4d233";ctx.lineWidth=1;ctx.stroke();}
  for(const track of scene.tracks)drawTrack(track);for(const b of scene.boards)drawBoard(b);for(const link of [...scene.springs,...scene.ropes])drawLink(link);
  for(const a of scene.anchors)drawAnchor(a);for(const slider of scene.sliders)drawSlider(slider);for(const b of scene.balls)drawBall(b);
  $("snap-label").hidden=true;snapHint=null;drawPreview();if(snapHint){const p=worldToScreen(snapHint.x,snapHint.y);ctx.strokeStyle="#65e1c4";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p[0],p[1],11,0,Math.PI*2);ctx.stroke();}
  ctx.fillStyle="#3f5873";ctx.font="10px system-ui";ctx.fillText("x / m",width-43,height/2+view.cy*scale+16);ctx.fillText("y / m",width/2-view.cx*scale+5,15);dirty=false;
}
function updateInspection(){$("state").textContent=P.inspectState(scene,selected()).join("\n");$("time").innerHTML=`${simTime.toFixed(3)} <small>s</small>`;if(!running)refreshPropertyValues();}

document.querySelectorAll("[data-tool]").forEach(b=>b.addEventListener("click",()=>setTool(b.dataset.tool)));
$("tools").addEventListener("wheel",event=>{
  const nav=event.currentTarget;if(nav.scrollHeight<=nav.clientHeight)return;
  event.preventDefault();const unit=event.deltaMode===1?16:event.deltaMode===2?nav.clientHeight:1;nav.scrollTop+=event.deltaY*unit;
},{passive:false});
$("play").addEventListener("click",togglePlay);$("reset").addEventListener("click",reset);$("step").addEventListener("click",singleStep);$("delete").addEventListener("click",remove);
$("time-speed").addEventListener("change",event=>setTimeScale(event.target.value));
$("zoom-in").addEventListener("click",()=>zoom(1.25));$("zoom-out").addEventListener("click",()=>zoom(.8));$("zoom-fit").addEventListener("click",fullView);
for(const name of Object.keys(P.presets)){const option=document.createElement("option");option.value=name;option.textContent=name;$("preset").append(option);}
$("preset").addEventListener("change",event=>{if(!event.target.value||running)return;scene=P.presets[event.target.value]();P.reindex(scene);initial=P.clone(scene);simTime=0;trails.clear();needsPrepare=true;select(null);syncEnvironment();updateCounts();status(`已载入预设：${scene.name}`);mark();event.target.value="";});
$("save").addEventListener("click",()=>{const blob=new Blob([JSON.stringify(P.serialize(initial),null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="physics-scene.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status("已保存编辑后的初始场景");});
$("load").addEventListener("click",()=>$("file").click());
$("file").addEventListener("change",async event=>{const file=event.target.files[0];if(!file||running)return;try{scene=P.deserialize(JSON.parse(await file.text()));initial=P.clone(scene);simTime=0;trails.clear();needsPrepare=true;select(null);syncEnvironment();updateCounts();status("场景加载成功");mark();}catch(error){status(`加载失败：${error.message}`);}event.target.value="";});
document.addEventListener("keydown",event=>{if(["INPUT","SELECT","TEXTAREA"].includes(event.target.tagName))return;if(event.code==="Space"){event.preventDefault();togglePlay();return;}if(event.key==="Delete"){remove();return;}if(event.key==="Escape"){pending=null;setTool("select");return;}const shortcut={v:"select",b:"ball",a:"anchor",t:"track",c:"arc",s:"slider",f:"spring",r:"rope"}[event.key.toLowerCase()];if(shortcut)setTool(shortcut);});
function frame(timestamp){
  if(!lastTime)lastTime=timestamp;
  const delta=Math.min(.1,(timestamp-lastTime)/1000);lastTime=timestamp;
  if(running){
    accumulator+=delta*timeScale;
    const maxSteps=Math.max(16,Math.ceil(delta*timeScale/P.DT)+1);let steps=0;
    while(accumulator>=P.DT&&steps<maxSteps){P.step(scene,P.DT);simTime+=P.DT;accumulator-=P.DT;steps++;}
    if(steps===maxSteps&&accumulator>=P.DT)accumulator%=P.DT;
    if(steps)recordTrails();mark();
  }
  if(dirty)render();if(timestamp-lastInspection>100){updateInspection();lastInspection=timestamp;}requestAnimationFrame(frame);
}
P.reindex(scene);buildProperties();syncEnvironment();updateCounts();resize();requestAnimationFrame(frame);
globalThis.sandbox={get scene(){return scene;},get running(){return running;},get time(){return simTime;},get timeScale(){return timeScale;},get view(){return view;},get tool(){return tool;},drafts,togglePlay,reset,singleStep,setTimeScale,select,zoom,fullView,setTool};
})();
