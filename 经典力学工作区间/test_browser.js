"use strict";
/* 先以 --remote-debugging-port=9222 启动 Chrome，再运行本脚本。 */
const assert=require("node:assert/strict");
const {pathToFileURL}=require("node:url"),path=require("node:path");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  const target=await fetch("http://127.0.0.1:9222/json/new?about:blank",{method:"PUT"}).then(r=>r.json());
  const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map(),errors=[];
  let nextId=1;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id&&pending.has(message.id)){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(JSON.stringify(message.error))):resolve(message.result);}
    if(message.method==="Runtime.exceptionThrown")errors.push(message.params.exceptionDetails.text);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;};
  const click=async(x,y)=>{await send("Input.dispatchMouseEvent",{type:"mouseMoved",x,y});await send("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});await send("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});await wait(60);};
  const worldClick=async(x,y)=>{const point=await evaluate(`(()=>{const r=document.getElementById("world").getBoundingClientRect(),v=sandbox.view,s=Math.min(r.width/10,r.height/6)*v.zoom;return {x:r.left+r.width/2+(${x}-v.cx)*s,y:r.top+r.height/2-(${y}-v.cy)*s};})()`);await click(point.x,point.y);};
  try{
    await send("Page.enable");await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send("Page.navigate",{url:pathToFileURL(path.join(__dirname,"index.html")).href});await wait(600);
    assert.equal(await evaluate("typeof sandbox"),"object");
    assert.equal(await evaluate("document.querySelectorAll('[data-tool]').length"),10);
    await evaluate("(()=>{const e=document.getElementById('preset');e.value='空白实验';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await evaluate("sandbox.setTool('ball')");
    assert.equal(await evaluate("document.getElementById('property-title').textContent"),"新建小球");
    await evaluate("(()=>{const e=document.getElementById('prop-radius');e.value='.4';e.dispatchEvent(new Event('input',{bubbles:true}));})()");await wait(180);
    assert.equal(await evaluate("sandbox.drafts.ball.radius"),.4);
    await worldClick(4,3);assert.equal(await evaluate("sandbox.scene.balls.length"),1);assert.equal(await evaluate("sandbox.scene.balls[0].radius"),.4);
    await evaluate("(()=>{const e=document.getElementById('prop-mass');e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));})()");await wait(180);
    assert.equal(await evaluate("sandbox.scene.balls[0].mass"),2);

    await evaluate("sandbox.setTool('track')");await worldClick(1,4);
    await evaluate("sandbox.setTool('arc')");await worldClick(5.05,4.03);
    assert.equal(await evaluate("sandbox.scene.tracks.length"),2);
    assert.ok(await evaluate("(()=>{const a=PhysicsLab.trackEndpoints(sandbox.scene.tracks[0])[1],b=PhysicsLab.trackEndpoints(sandbox.scene.tracks[1])[0];return Math.hypot(a.x-b.x,a.y-b.y)<1e-9;})()"));
    await evaluate("sandbox.setTool('slider')");await worldClick(2,4);assert.equal(await evaluate("sandbox.scene.sliders.length"),1);
    await evaluate("sandbox.setTool('anchor')");await worldClick(0,4);
    await evaluate("sandbox.setTool('spring')");await worldClick(0,4);await worldClick(2,4);
    assert.equal(await evaluate("sandbox.scene.springs.length"),1);
    assert.equal(await evaluate("sandbox.scene.springs[0].toId"),await evaluate("sandbox.scene.sliders[0].id"));
    await evaluate("(()=>{const e=document.getElementById('time-speed');e.value='2';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    assert.equal(await evaluate("sandbox.timeScale"),2);
    await evaluate("document.getElementById('play').click()");await wait(350);
    assert.equal(await evaluate("sandbox.running"),true);
    assert.ok(await evaluate("sandbox.time>0"));
    await evaluate("document.getElementById('play').click()");
    assert.equal(await evaluate("sandbox.running"),false);
    await evaluate("PhysicsLab.validate(sandbox.scene)");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    assert.deepEqual(errors,[]);
    console.log("浏览器交互测试通过：参数编辑、放球、轨道吸附、滑块、弹簧、时间倍速、运行/暂停均正常。");
  }finally{
    await fetch(`http://127.0.0.1:9222/json/close/${target.id}`).catch(()=>{});ws.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
