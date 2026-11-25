"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),P=require("./physics.js");
const near=(a,b,eps=1e-3)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);

test("直线与圆弧轨道几何、切线和投影正确",()=>{
  const line=P.LineTrack(1,2,4,Math.PI/6),end=P.trackPoint(line,4);
  near(end.x,1+4*Math.cos(Math.PI/6));near(end.y,4);
  const arc=P.ArcTrack(end.x,end.y,2,-90,line.angle),mid=P.trackPoint(arc,P.trackLength(arc)/2);
  near(Math.hypot(mid.x-arc.cx,mid.y-arc.cy),2,1e-10);
  near(mid.tx*mid.nx+mid.ty*mid.ny,0,1e-10);
  near(P.trackLength(arc),Math.PI,1e-10);
});

test("水平轨道滑块的重力法向分量不产生切向加速度",()=>{
  const track=P.LineTrack(0,1,5,0),slider=P.Slider(track.id,2),scene=P.Scene("",{tracks:[track],sliders:[slider]});
  P.reindex(scene);for(let i=0;i<240;i++)P.step(scene);
  near(slider.s,2);near(slider.speed,0);near(P.sliderPoint(scene,slider).y,1);
});

test("重力沿斜轨道的切向投影驱动滑块",()=>{
  const track=P.LineTrack(0,3,8,-Math.PI/6),slider=P.Slider(track.id,2,{friction:0}),scene=P.Scene("",{tracks:[track],sliders:[slider]});
  P.reindex(scene);P.step(scene,1e-4);near(slider.speed,9.8*.5*1e-4,1e-9);
  for(let i=0;i<100;i++)P.step(scene);assert.ok(slider.s>2);near(P.sliderPoint(scene,slider).y,P.sliderPoint(scene,slider).y);
});

test("弯道上的滑块始终满足半径约束且速度沿切线",()=>{
  const track=P.ArcTrack(3,4,1.5,-120,0),slider=P.Slider(track.id,.2,{speed:2,friction:0}),scene=P.Scene("",{tracks:[track],sliders:[slider]});
  P.reindex(scene);for(let i=0;i<200;i++){
    P.step(scene);const point=P.sliderPoint(scene,slider);
    near(Math.hypot(point.x-track.cx,point.y-track.cy),1.5,1e-8);
    const vx=point.tx*slider.speed,vy=point.ty*slider.speed;
    near(vx*point.nx+vy*point.ny,0,1e-8);
  }
});

test("滑块沿切线连续的拼接轨道前进",()=>{
  const line=P.LineTrack(0,2,2,0),arc=P.ArcTrack(2,2,1,-90,0);
  const slider=P.Slider(line.id,1.98,{speed:2,friction:0}),scene=P.Scene("",{g:0,tracks:[line,arc],sliders:[slider]});
  P.reindex(scene);for(let i=0;i<30;i++)P.step(scene);
  assert.equal(slider.trackId,arc.id);assert.ok(slider.s>0&&slider.s<P.trackLength(arc));assert.ok(slider.speed>0);
});

test("滑块能从弯道起点逆向进入前一段直线",()=>{
  const line=P.LineTrack(0,2,2,0),arc=P.ArcTrack(2,2,1,-90,0);
  const slider=P.Slider(arc.id,.01,{speed:-2,friction:0}),scene=P.Scene("",{g:0,tracks:[line,arc],sliders:[slider]});
  P.reindex(scene);P.advanceSlider(scene,slider,-.1);
  assert.equal(slider.trackId,line.id);near(slider.s,1.91,1e-9);near(slider.speed,-2,1e-12);
  for(let i=0;i<10;i++)P.step(scene);assert.ok(slider.s<1.91&&slider.speed<0);
});

test("滑块能从直线起点逆向进入前一段弯道",()=>{
  const arc=P.ArcTrack(0,0,1,90,0),end=P.trackEndpoints(arc)[1];
  const line=P.LineTrack(end.x,end.y,2,Math.PI/2),slider=P.Slider(line.id,.01,{speed:-2,friction:0});
  const scene=P.Scene("",{g:0,tracks:[arc,line],sliders:[slider]});P.reindex(scene);P.advanceSlider(scene,slider,-.1);
  assert.equal(slider.trackId,arc.id);near(slider.s,P.trackLength(arc)-.09,1e-9);near(slider.speed,-2,1e-12);
});

test("弹簧对滑块施加切向力且两端满足牛三",()=>{
  const track=P.LineTrack(0,0,6,0),slider=P.Slider(track.id,3,{friction:0}),anchor=P.Anchor(0,0);
  const spring=P.Spring(anchor.id,slider.id,{stiffness:10,restLength:2,damping:0}),scene=P.Scene("",{g:0,tracks:[track],sliders:[slider],anchors:[anchor],springs:[spring]});
  P.reindex(scene);const ends=P.linkEndpoints(scene,spring);
  const fa=P.springForce(scene,spring,P.getObject(scene,anchor.id)),fb=P.springForce(scene,spring,slider);
  near(fa[0]+fb[0],0,1e-12);near(fa[1]+fb[1],0,1e-12);assert.ok(fb[0]<0);
  const before=slider.s;P.step(scene);assert.ok(slider.speed<0&&slider.s<before);assert.ok(!ends[0].body);
});

test("绳子能限制滑块向外运动且不产生横向自由度",()=>{
  const track=P.LineTrack(0,0,6,0),slider=P.Slider(track.id,2,{speed:2,friction:0}),anchor=P.Anchor(0,0),rope=P.Rope(anchor.id,slider.id,{length:2,autoLength:false});
  const scene=P.Scene("",{g:0,tracks:[track],sliders:[slider],anchors:[anchor],ropes:[rope]});P.reindex(scene);
  for(let i=0;i<20;i++)P.step(scene);assert.ok(slider.s<=2.001);near(slider.speed,0,.02);near(P.sliderPoint(scene,slider).y,0);
});

test("弹簧初始长度与原长独立，开始时可设置初始形变量",()=>{
  const anchor=P.Anchor(0,0),ball=P.Ball(2,0),spring=P.Spring(anchor.id,ball.id,{restLength:1,initialLength:3,stiffness:10,damping:0});
  const scene=P.Scene("",{g:0,anchors:[anchor],balls:[ball],springs:[spring]});P.reindex(scene);
  P.prepareStart(scene);near(ball.x,3);near(P.springForce(scene,spring,ball)[0],-20);
});

test("开始时弹簧位置校正保留滑块设置的切向初速度",()=>{
  const track=P.LineTrack(0,0,10,0),slider=P.Slider(track.id,2,{speed:5,friction:0}),anchor=P.Anchor(0,0);
  const spring=P.Spring(anchor.id,slider.id,{restLength:2,initialLength:3,stiffness:10,damping:0});
  const scene=P.Scene("",{g:0,tracks:[track],sliders:[slider],anchors:[anchor],springs:[spring]});P.reindex(scene);
  P.prepareStart(scene);near(slider.s,3);near(slider.speed,5,1e-12);
  P.step(scene);assert.ok(Math.abs(slider.speed)>4.9);
});

test("弹簧初始长度校正不会清除小球初速度",()=>{
  const anchor=P.Anchor(0,0),ball=P.Ball(2,0,{vx:4,vy:1}),spring=P.Spring(anchor.id,ball.id,{restLength:2,initialLength:3});
  const scene=P.Scene("",{g:0,anchors:[anchor],balls:[ball],springs:[spring]});P.reindex(scene);P.prepareStart(scene);
  near(ball.x,3);near(ball.vx,4);near(ball.vy,1);
});

test("默认暂停移动小球时弹簧原长和实际长度同步",()=>{
  const anchor=P.Anchor(0,0),ball=P.Ball(2,0),spring=P.Spring(anchor.id,ball.id,{restLength:2,initialLength:2});
  const scene=P.Scene("",{g:0,anchors:[anchor],balls:[ball],springs:[spring]});P.reindex(scene);
  ball.x=3.5;P.syncSpringsForMovedEndpoint(scene,ball.id);
  near(spring.restLength,3.5);near(spring.initialLength,3.5);assert.equal(spring.autoRestLength,true);
  const copy=P.deserialize(P.serialize(scene));assert.equal(copy.springs[0].autoRestLength,true);near(copy.springs[0].restLength,3.5);
});

test("手动原长模式不会被小球移动覆盖",()=>{
  const anchor=P.Anchor(0,0),ball=P.Ball(2,0),spring=P.Spring(anchor.id,ball.id,{restLength:1.2,initialLength:2,autoRestLength:false});
  const scene=P.Scene("",{g:0,anchors:[anchor],balls:[ball],springs:[spring]});P.reindex(scene);
  ball.x=4;P.syncSpringsForMovedEndpoint(scene,ball.id);
  near(spring.restLength,1.2);near(spring.initialLength,4);
  const copy=P.deserialize(P.serialize(scene));assert.equal(copy.springs[0].autoRestLength,false);
});

test("轨道、滑块和通用连接可序列化并级联删除",()=>{
  const scene=P.presets["轨道与滑块"](),slider=scene.sliders[0],anchor=P.Anchor(0,4),spring=P.Spring(anchor.id,slider.id,{restLength:1,initialLength:2});
  scene.anchors.push(anchor);scene.springs.push(spring);P.reindex(scene);P.validate(scene);
  const raw=P.serialize(scene),copy=P.deserialize(raw);assert.equal(raw.version,4);assert.equal(copy.tracks.length,2);assert.equal(copy.sliders.length,1);assert.equal(copy.springs[0].toId,slider.id);
  P.removeObject(copy,copy.tracks[0].id);assert.equal(copy.sliders.length,0);assert.equal(copy.springs.length,0);
});

test("编辑器包含新工具、参数预设和预览交互",()=>{
  const fs=require("node:fs"),path=require("node:path"),html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8"),app=fs.readFileSync(path.join(__dirname,"app.js"),"utf8"),css=fs.readFileSync(path.join(__dirname,"style.css"),"utf8");
  for(const name of ["track","arc","slider"])assert.ok(html.includes(`data-tool="${name}"`));
  assert.ok(html.includes('id="snap-enabled"'));assert.ok(app.includes("function drawPreview()"));assert.ok(app.includes("function trackPlacement("));assert.ok(app.includes("restLength"));
  assert.ok(app.includes('syncSpringsForMovedEndpoint(scene,item.id)'));assert.ok(app.includes('autoRestLength'));assert.ok(css.includes("overflow-y:auto"));assert.ok(app.includes('$("tools").addEventListener("wheel"'));
});

test("时间倍速控件可用且保持固定物理步长",()=>{
  const fs=require("node:fs"),path=require("node:path"),html=fs.readFileSync(path.join(__dirname,"index.html"),"utf8"),app=fs.readFileSync(path.join(__dirname,"app.js"),"utf8");
  assert.ok(html.includes('id="time-speed"'));
  for(const speed of ["0.1","0.25","0.5","1","2","4","8"])assert.ok(html.includes(`value="${speed}"`));
  assert.ok(app.includes("accumulator+=delta*timeScale"));
  assert.ok(app.includes("P.step(scene,P.DT);simTime+=P.DT"));
  assert.ok(app.includes("Math.ceil(delta*timeScale/P.DT)+1"));
});
