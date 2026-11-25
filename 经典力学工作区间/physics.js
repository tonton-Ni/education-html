/* 纯物理核心：浏览器与 Node 共用，不依赖 DOM。 */
(function (global) {
  "use strict";
  let nextId = 1;
  const id = prefix => `${prefix}_${nextId++}`;
  const hypot = Math.hypot;
  const Ball = (x, y, p = {}) => ({ kind: "ball", id: id("ball"), x, y, vx: 0, vy: 0,
    mass: 1, radius: .25, charge: 0, restitution: .3, friction: .4, ...p });
  const Board = (x, y, p = {}) => ({ kind: "board", id: id("board"), x, y, vx: 0, vy: 0,
    length: 4, thickness: .16, angle: 0, omega: 0, mass: 3, fixed: true,
    restitution: .2, friction: .35, ...p });
  const Wall = (ax, ay, bx, by, p = {}) => ({ kind: "wall", id: id("wall"), ax, ay, bx, by,
    restitution: .3, friction: .3, ...p });
  const Anchor = (x, y, p = {}) => ({ kind: "anchor", id: id("anchor"), x, y,
    boardId: null, localX: 0, localY: 0, ...p });
  const Spring = (ballId, anchorId, p = {}) => ({ kind: "spring", id: id("spring"),
    ballId, anchorId, fromId: p.fromId ?? ballId, toId: p.toId ?? anchorId,
    stiffness: 20, restLength: 2, initialLength: null, autoRestLength: true, damping: .1, ...p });
  const Rope = (fromId, toId, p = {}) => ({ kind: "rope", id: id("rope"),
    fromId, toId, length: 2, autoLength: true, ...p });
  const Track = (x, y, p = {}) => ({ kind: "track", id: id("track"), shape: "line",
    x, y, length: 4, angle: 0, radius: 1.5, sweep: Math.PI / 2,
    startAngle: 0, cx: 0, cy: 0, fixed: true, ...p });
  const Slider = (trackId, s = 0, p = {}) => ({ kind: "slider", id: id("slider"),
    trackId, s, speed: 0, mass: 1, friction: .08, width: .48, height: .28, ...p });
  const Scene = (name = "我的力学世界", p = {}) => ({ name, g: 9.8, gravityEnabled: true,
    airDrag: 0, electricX: 0, electricY: 0, coulombConstant: 8.99e9, gravitationalConstant: 6.674e-11,
    balls: [], boards: [], walls: [], anchors: [], springs: [], ropes: [], tracks: [], sliders: [], ...p });
  const groups = scene => [scene.balls, scene.boards, scene.walls, scene.anchors, scene.springs, scene.ropes, scene.tracks, scene.sliders];
  const indexes = new WeakMap(), diagnostics = new WeakMap();

  function reindex(scene) {
    const value = { objects: new Map(), balls: new Map(), anchors: new Map(), tracks: new Map(), sliders: new Map(), links: new Map(), boardAnchors: new Map() };
    for (const items of groups(scene)) for (const item of items) value.objects.set(item.id, item);
    for (const ball of scene.balls) value.balls.set(ball.id, ball);
    for (const track of scene.tracks) value.tracks.set(track.id, track);
    for (const slider of scene.sliders) value.sliders.set(slider.id, slider);
    for (const anchor of scene.anchors) {
      value.anchors.set(anchor.id, anchor);
      if (anchor.boardId) {
        if (!value.boardAnchors.has(anchor.boardId)) value.boardAnchors.set(anchor.boardId, []);
        value.boardAnchors.get(anchor.boardId).push(anchor);
      }
    }
    for (const board of scene.boards) board.locked = (value.boardAnchors.get(board.id) || []).length > 1;
    for (const link of [...scene.springs, ...scene.ropes]) {
      const ids=link.kind==="rope"?[link.fromId,link.toId]:[link.fromId??link.ballId,link.toId??link.anchorId];
      for(const id of ids){if (!value.links.has(id)) value.links.set(id, []);value.links.get(id).push(link);}
    }
    indexes.set(scene, value);
    return value;
  }
  const index = scene => indexes.get(scene) || reindex(scene);
  const ballById = (scene, ballId) => index(scene).balls.get(ballId);
  const getObject = (scene, objectId) => index(scene).objects.get(objectId);
  const inertia = board => board.mass * (board.length ** 2 + board.thickness ** 2) / 12;
  const invMass = body => !body || body.fixed || body.locked ? 0 : 1 / body.mass;
  const invInertia = body => !body || body.fixed || body.locked || body.kind !== "board" ? 0 : 1 / inertia(body);

  function makeLineTrack(x, y, length = 4, angle = 0, p = {}) {
    return Track(x, y, { ...p, shape: "line", length, angle });
  }
  function makeArcTrack(x, y, radius = 1.5, degrees = 90, angle = 0, p = {}) {
    const sweep = degrees * Math.PI / 180;
    const direction = Math.sign(sweep) || 1;
    const startAngle = angle - direction * Math.PI / 2;
    return Track(x, y, { ...p, shape: "arc", radius, sweep, angle,
      startAngle, cx: x - radius * Math.cos(startAngle), cy: y - radius * Math.sin(startAngle) });
  }
  function trackLength(track) {
    return track.shape === "arc" ? Math.abs(track.sweep) * track.radius : track.length;
  }
  function trackPoint(track, s) {
    const length = trackLength(track);
    const u = length > 0 ? Math.max(0, Math.min(1, s / length)) : 0;
    if (track.shape === "arc") {
      const theta = track.startAngle + track.sweep * u;
      const direction = Math.sign(track.sweep) || 1;
      const tx = -Math.sin(theta) * direction, ty = Math.cos(theta) * direction;
      return { x: track.cx + track.radius * Math.cos(theta), y: track.cy + track.radius * Math.sin(theta),
        tx, ty, nx: -ty, ny: tx, curvature: direction / track.radius };
    }
    const tx = Math.cos(track.angle), ty = Math.sin(track.angle);
    return { x: track.x + tx * s, y: track.y + ty * s, tx, ty, nx: -ty, ny: tx, curvature: 0 };
  }
  function trackEndpoints(track) {
    return [trackPoint(track, 0), trackPoint(track, trackLength(track))];
  }
  function projectTrack(track, x, y) {
    if (track.shape === "arc") {
      const raw = Math.atan2(y - track.cy, x - track.cx);
      const direction = Math.sign(track.sweep) || 1;
      let travelled = (raw - track.startAngle) * direction;
      travelled = ((travelled % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const sweep = Math.abs(track.sweep);
      let s = Math.min(sweep, travelled) * track.radius;
      const candidates = [s, 0, trackLength(track)];
      let best = null;
      for (const value of candidates) {
        const point = trackPoint(track, value), d = Math.hypot(x - point.x, y - point.y);
        if (!best || d < best.d) best = { ...point, s: value, d };
      }
      return best;
    }
    const tx = Math.cos(track.angle), ty = Math.sin(track.angle);
    const s = Math.max(0, Math.min(track.length, (x - track.x) * tx + (y - track.y) * ty));
    const point = trackPoint(track, s);
    return { ...point, s, d: Math.hypot(x - point.x, y - point.y) };
  }
  function sliderPoint(scene, slider) {
    const track = index(scene).tracks.get(slider.trackId);
    return track ? trackPoint(track, slider.s) : null;
  }
  function syncSliders(scene) {
    for (const slider of scene.sliders) {
      const track = index(scene).tracks.get(slider.trackId);
      if (track) slider.s = Math.max(0, Math.min(trackLength(track), slider.s));
    }
  }

  // 锚点永远固定在世界坐标中；boardId 表示它把木板该点钉成转轴。
  function anchorPosition(scene, anchor) { return [anchor.x, anchor.y]; }
  function anchorVelocity(scene, anchor) { return [0, 0]; }
  function attachAnchor(scene, anchor, board) {
    const c = Math.cos(board.angle), s = Math.sin(board.angle);
    const dx = anchor.x - board.x, dy = anchor.y - board.y;
    anchor.boardId = board.id; anchor.localX = c * dx + s * dy; anchor.localY = -s * dx + c * dy;
  }
  function detachAnchor(scene, anchor) {
    anchor.boardId = null; anchor.localX = anchor.localY = 0;
  }
  function syncAnchors(scene) {
    for (const board of scene.boards) {
      const pins = scene.anchors.filter(a => a.boardId === board.id);
      board.locked = pins.length > 1;
      if (!pins.length) continue;
      const a = pins[0];
      if (board.locked) {
        const b = pins[1], lx = b.localX - a.localX, ly = b.localY - a.localY;
        const wx = b.x - a.x, wy = b.y - a.y;
        if (hypot(lx, ly) > 1e-12 && hypot(wx, wy) > 1e-12)
          board.angle = Math.atan2(wy, wx) - Math.atan2(ly, lx);
        board.vx = board.vy = board.omega = 0;
      }
      const c = Math.cos(board.angle), s = Math.sin(board.angle);
      const rx = c * a.localX - s * a.localY, ry = s * a.localX + c * a.localY;
      board.x = a.x - rx; board.y = a.y - ry;
      if (!board.locked) { board.vx = -board.omega * ry; board.vy = board.omega * rx; }
    }
  }
  function removeObject(scene, objectId) {
    const item = getObject(scene, objectId);
    if (!item) return false;
    const key = { ball: "balls", board: "boards", wall: "walls", anchor: "anchors",
      spring: "springs", rope: "ropes", track: "tracks", slider: "sliders" }[item.kind];
    scene[key] = scene[key].filter(obj => obj.id !== objectId);
    if (["ball", "anchor", "slider"].includes(item.kind)) {
      scene.springs = scene.springs.filter(s => (s.fromId ?? s.ballId) !== objectId && (s.toId ?? s.anchorId) !== objectId);
      scene.ropes = scene.ropes.filter(r => r.fromId !== objectId && r.toId !== objectId);
    } else if (item.kind === "track") {
      const removed = scene.sliders.filter(s => s.trackId === objectId).map(s => s.id);
      scene.sliders = scene.sliders.filter(s => s.trackId !== objectId);
      scene.springs = scene.springs.filter(s => !removed.includes(s.fromId ?? s.ballId) && !removed.includes(s.toId ?? s.anchorId));
      scene.ropes = scene.ropes.filter(r => !removed.includes(r.fromId) && !removed.includes(r.toId));
    } else if (item.kind === "board") {
      for (const a of scene.anchors) if (a.boardId === objectId) detachAnchor(scene, a);
    }
    reindex(scene); return true;
  }

  function linkEndpoint(scene, objectId) {
    const ball = ballById(scene, objectId);
    if (ball) return { id: objectId, body: ball, x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, rx: 0, ry: 0 };
    const slider = index(scene).sliders.get(objectId);
    if (slider) {
      const point = sliderPoint(scene, slider);
      if (!point) return null;
      return { id: objectId, body: slider, x: point.x, y: point.y,
        vx: point.tx * slider.speed, vy: point.ty * slider.speed,
        rx: 0, ry: 0, tx: point.tx, ty: point.ty };
    }
    const anchor = index(scene).anchors.get(objectId);
    if (!anchor) return null;
    const body = getObject(scene, anchor.boardId), [x, y] = anchorPosition(scene, anchor), [vx, vy] = anchorVelocity(scene, anchor);
    return { id: objectId, body, x, y, vx, vy, rx: body ? x - body.x : 0, ry: body ? y - body.y : 0 };
  }
  function linkEndpoints(scene, link) {
    const fromId = link.fromId ?? link.ballId, toId = link.toId ?? link.anchorId;
    const a = linkEndpoint(scene, fromId), b = linkEndpoint(scene, toId);
    return a && b ? [a, b] : null;
  }
  function springEndpointForce(scene, spring, end) {
    const ends = linkEndpoints(scene, spring);
    if (!ends) return [0, 0];
    const [a, b] = ends, dx = b.x - a.x, dy = b.y - a.y, distance = hypot(dx, dy);
    if (distance < 1e-12) return [0, 0];
    const nx = dx / distance, ny = dy / distance;
    const radial = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    const magnitude = -spring.stiffness * (distance - spring.restLength) - spring.damping * radial;
    const sign = end.id === a.id ? -1 : 1;
    return [sign * magnitude * nx, sign * magnitude * ny];
  }
  function springForce(scene, spring, body) {
    const fromId = spring.fromId ?? spring.ballId, toId = spring.toId ?? spring.anchorId;
    const end = linkEndpoint(scene, body && body.id ? body.id : toId);
    return end ? springEndpointForce(scene, spring, end) : [0, 0];
  }
  function pairForce(scene, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, r2 = dx * dx + dy * dy;
    if (r2 < 1e-12) return [0, 0];
    const d = Math.sqrt(r2), f = (scene.coulombConstant * a.charge * b.charge - scene.gravitationalConstant * a.mass * b.mass) / r2;
    return [-f * dx / d, -f * dy / d];
  }
  function fieldForce(scene, ball) {
    return [-scene.airDrag * ball.vx + ball.charge * scene.electricX,
      (scene.gravityEnabled ? -ball.mass * scene.g : 0) - scene.airDrag * ball.vy + ball.charge * scene.electricY];
  }
  function addForce(map, body, force, point) {
    if (!body || body.fixed || body.locked) return;
    const f = map.get(body.id); f[0] += force[0]; f[1] += force[1];
    if (point && body.kind === "board") f[2] += (point[0] - body.x) * force[1] - (point[1] - body.y) * force[0];
  }
  function forceMap(scene) {
    const map = new Map();
    for (const b of scene.balls) map.set(b.id, fieldForce(scene, b).concat(0));
    for (const b of scene.boards) map.set(b.id, [0, scene.gravityEnabled ? -b.mass * scene.g : 0, 0]);
    for (const slider of scene.sliders) {
      const point = sliderPoint(scene, slider), vx = point ? point.tx * slider.speed : 0, vy = point ? point.ty * slider.speed : 0;
      map.set(slider.id, [-scene.airDrag * vx, (scene.gravityEnabled ? -slider.mass * scene.g : 0) - scene.airDrag * vy, 0]);
    }
    for (let i = 0; i < scene.balls.length; i++) for (let j = i + 1; j < scene.balls.length; j++) {
      const a = scene.balls[i], b = scene.balls[j], f = pairForce(scene, a, b);
      addForce(map, a, f); addForce(map, b, [-f[0], -f[1]]);
    }
    for (const s of scene.springs) {
      const ends = linkEndpoints(scene, s);
      if (!ends) continue;
      for (const end of ends) {
        const f = springEndpointForce(scene, s, end);
        addForce(map, end.body, f, [end.x, end.y]);
      }
    }
    return map;
  }

  function boardContact(ball, board) {
    const c = Math.cos(board.angle), s = Math.sin(board.angle), dx = ball.x - board.x, dy = ball.y - board.y;
    const qx = c * dx + s * dy, qy = -s * dx + c * dy, hx = board.length / 2, hy = board.thickness / 2;
    const cx = Math.max(-hx, Math.min(hx, qx)), cy = Math.max(-hy, Math.min(hy, qy));
    const ddx = qx - cx, ddy = qy - cy, distance = hypot(ddx, ddy);
    let nx, ny, penetration;
    if (distance > 1e-12) {
      if (distance >= ball.radius) return null;
      nx = ddx / distance; ny = ddy / distance; penetration = ball.radius - distance;
    } else {
      const faces = [[hx-qx,1,0], [hx+qx,-1,0], [hy-qy,0,1], [hy+qy,0,-1]];
      faces.sort((a,b) => a[0]-b[0]); penetration = ball.radius + faces[0][0]; nx = faces[0][1]; ny = faces[0][2];
    }
    const worldNx = c*nx-s*ny, worldNy = s*nx+c*ny;
    return { ball, board, nx: worldNx, ny: worldNy, penetration,
      rx: c*cx-s*cy, ry: s*cx+c*cy,
      restitution: Math.min(ball.restitution, board.restitution), friction: Math.sqrt(ball.friction*board.friction) };
  }
  function wallContact(ball, wall) {
    const abx = wall.bx-wall.ax, aby = wall.by-wall.ay, length2 = abx*abx+aby*aby;
    if (length2 < 1e-16) return null;
    const u = Math.max(0, Math.min(1, ((ball.x-wall.ax)*abx+(ball.y-wall.ay)*aby)/length2));
    const px = wall.ax+u*abx, py = wall.ay+u*aby, dx = ball.x-px, dy = ball.y-py, distance = hypot(dx,dy);
    if (distance >= ball.radius) return null;
    let nx, ny;
    if (distance > 1e-12) { nx=dx/distance; ny=dy/distance; }
    else { const speed=hypot(ball.vx,ball.vy); nx=speed?-ball.vx/speed:0; ny=speed?-ball.vy/speed:1; }
    return { ball, nx, ny, penetration: ball.radius-distance,
      restitution: Math.min(ball.restitution, wall.restitution), friction: Math.sqrt(ball.friction*wall.friction) };
  }
  function applyImpulse(body, jx, jy, rx = 0, ry = 0, sign = 1) {
    if (!body || body.fixed || body.locked) return;
    if (body.kind === "slider") {
      body.speed += sign * (jx * (body._tx || 0) + jy * (body._ty || 0)) / body.mass;
      return;
    }
    body.vx += sign * jx / body.mass; body.vy += sign * jy / body.mass;
    if (body.kind === "board") body.omega += sign * (rx * jy - ry * jx) / inertia(body);
  }
  function solveBoard(c) {
    const b = c.ball, o = c.board, rn = c.rx*c.ny-c.ry*c.nx;
    const ovx=o.vx-o.omega*c.ry, ovy=o.omega===0?o.vy:o.vy+o.omega*c.rx;
    const rvx=b.vx-ovx, rvy=b.vy-ovy, vn=rvx*c.nx+rvy*c.ny;
    const w=invMass(b)+invMass(o)+invInertia(o)*rn*rn;
    if (vn < 0 && w > 0) {
      const e=vn<-.5?c.restitution:0,j=-(1+e)*vn/w,jx=j*c.nx,jy=j*c.ny;
      applyImpulse(b,jx,jy);applyImpulse(o,jx,jy,c.rx,c.ry,-1);
      const tx=-c.ny,ty=c.nx,rt=c.rx*ty-c.ry*tx;
      const bvx=b.vx-(o.vx-o.omega*c.ry),bvy=b.vy-(o.vy+o.omega*c.rx),vt=bvx*tx+bvy*ty;
      const wt=invMass(b)+invMass(o)+invInertia(o)*rt*rt;
      const jt=Math.max(-c.friction*j,Math.min(c.friction*j,-vt/wt));
      applyImpulse(b,jt*tx,jt*ty);applyImpulse(o,jt*tx,jt*ty,c.rx,c.ry,-1);
    }
    const total=invMass(b)+invMass(o);if(!total)return;
    const correction=Math.max(0,c.penetration-1e-5)*.8/total;
    b.x+=correction*invMass(b)*c.nx;b.y+=correction*invMass(b)*c.ny;
    if(!o.fixed){o.x-=correction*invMass(o)*c.nx;o.y-=correction*invMass(o)*c.ny;o.omega-=correction*invInertia(o)*rn;}
  }
  function solveStatic(c) {
    const b=c.ball,vn=b.vx*c.nx+b.vy*c.ny;
    if(vn<0){const e=vn<-.5?c.restitution:0,j=-(1+e)*vn;b.vx+=j*c.nx;b.vy+=j*c.ny;
      const tx=-c.ny,ty=c.nx,vt=b.vx*tx+b.vy*ty,jt=Math.max(-c.friction*j,Math.min(c.friction*j,-vt));b.vx+=jt*tx;b.vy+=jt*ty;}
    const correction=Math.max(0,c.penetration-1e-5)*.8;b.x+=correction*c.nx;b.y+=correction*c.ny;
  }
  function solveBalls(a,b) {
    const dx=b.x-a.x,dy=b.y-a.y,distance=hypot(dx,dy),penetration=a.radius+b.radius-distance;if(penetration<=0)return;
    const nx=distance>1e-12?dx/distance:1,ny=distance>1e-12?dy/distance:0,wa=invMass(a),wb=invMass(b),w=wa+wb;if(!w)return;
    const vn=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
    if(vn<0){const e=vn<-.5?Math.min(a.restitution,b.restitution):0,j=-(1+e)*vn/w;
      applyImpulse(a,-j*nx,-j*ny);applyImpulse(b,j*nx,j*ny);const tx=-ny,ty=nx,vt=(b.vx-a.vx)*tx+(b.vy-a.vy)*ty,mu=Math.sqrt(a.friction*b.friction),jt=Math.max(-mu*j,Math.min(mu*j,-vt/w));
      applyImpulse(a,-jt*tx,-jt*ty);applyImpulse(b,jt*tx,jt*ty);}
    const correction=Math.max(0,penetration-1e-5)*.8/w;a.x-=correction*wa*nx;a.y-=correction*wa*ny;b.x+=correction*wb*nx;b.y+=correction*wb*ny;
  }
  function ropeEndpoint(scene, objectId) { return linkEndpoint(scene, objectId); }
  function ropeEndpoints(scene, rope) { return linkEndpoints(scene, rope); }
  function endpointInvMass(end, nx, ny) {
    if (!end || !end.body) return 0;
    if (end.body.kind === "slider") {
      const tangent = end.tx * nx + end.ty * ny;
      return invMass(end.body) * tangent * tangent;
    }
    return invMass(end.body);
  }
  function moveEndpoint(end, dx, dy, rn = 0) {
    const body = end.body;
    if (!body || body.fixed || body.locked) return;
    if (body.kind === "slider") {
      body.s += (dx * end.tx + dy * end.ty) / body.mass;
      return;
    }
    body.x += dx * invMass(body); body.y += dy * invMass(body);
    if (body.kind === "board") body.omega += invInertia(body) * rn;
  }
  function solveRope(scene, rope) {
    const ends=ropeEndpoints(scene,rope);if(!ends)return;const [a,b]=ends,dx=b.x-a.x,dy=b.y-a.y,distance=hypot(dx,dy);
    if(distance<=rope.length||distance<1e-12)return;
    const nx=dx/distance,ny=dy/distance,arn=a.rx*ny-a.ry*nx,brn=b.rx*ny-b.ry*nx;
    const outward=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
    const w=endpointInvMass(a,nx,ny)+endpointInvMass(b,nx,ny)+invInertia(a.body)*arn*arn+invInertia(b.body)*brn*brn;if(!w)return;
    if(a.body&&a.body.kind==="slider"){a.body._tx=a.tx;a.body._ty=a.ty;}
    if(b.body&&b.body.kind==="slider"){b.body._tx=b.tx;b.body._ty=b.ty;}
    if(outward>0){const j=outward/w;applyImpulse(a.body,j*nx,j*ny,a.rx,a.ry);applyImpulse(b.body,-j*nx,-j*ny,b.rx,b.ry);}
    const correction=(distance-rope.length)*.8/w;
    moveEndpoint(a,correction*nx,correction*ny,correction*arn);
    moveEndpoint(b,-correction*nx,-correction*ny,-correction*brn);
  }
  function solveBoardWall(board, wall) {
    if(board.fixed||board.locked)return;
    const abx=wall.bx-wall.ax,aby=wall.by-wall.ay,l2=abx*abx+aby*aby;if(l2<1e-12)return;
    const c=Math.cos(board.angle),s=Math.sin(board.angle),hx=board.length/2,hy=board.thickness/2;
    for(const [lx,ly] of [[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]]){
      const rx=c*lx-s*ly,ry=s*lx+c*ly,x=board.x+rx,y=board.y+ry;
      const u=Math.max(0,Math.min(1,((x-wall.ax)*abx+(y-wall.ay)*aby)/l2)),dx=x-wall.ax-u*abx,dy=y-wall.ay-u*aby,d=hypot(dx,dy);
      if(d>=.015)continue;const nx=d>1e-9?dx/d:0,ny=d>1e-9?dy/d:1,rn=rx*ny-ry*nx;
      const vx=board.vx-board.omega*ry,vy=board.vy+board.omega*rx,vn=vx*nx+vy*ny,w=invMass(board)+invInertia(board)*rn*rn;
      if(vn<0&&w>0){const j=-(1+Math.min(board.restitution,wall.restitution))*vn/w;applyImpulse(board,j*nx,j*ny,rx,ry);}
      const correction=Math.max(0,.015-d)*.6;board.x+=correction*nx;board.y+=correction*ny;
    }
  }
  function continueTrack(scene, track, atEnd) {
    const ends = trackEndpoints(track), point = ends[atEnd ? 1 : 0];
    // atEnd 已包含运动方向：正向离开终点为 +t，反向离开起点为 -t。
    const outX = (atEnd ? 1 : -1) * point.tx;
    const outY = (atEnd ? 1 : -1) * point.ty;
    let best = null;
    for (const candidate of scene.tracks) {
      if (candidate.id === track.id) continue;
      const candidateEnds = trackEndpoints(candidate);
      for (let endIndex = 0; endIndex < 2; endIndex++) {
        const other = candidateEnds[endIndex], d = Math.hypot(point.x - other.x, point.y - other.y);
        if (d > .025) continue;
        const otherOutX = (endIndex ? -1 : 1) * other.tx;
        const otherOutY = (endIndex ? -1 : 1) * other.ty;
        const alignment = outX * otherOutX + outY * otherOutY;
        if (alignment > .995 && (!best || alignment > best.alignment))
          best = { track: candidate, atEnd: Boolean(endIndex), direction: endIndex ? -1 : 1, alignment };
      }
    }
    return best;
  }
  function advanceSlider(scene, slider, distance) {
    let remaining = distance;
    for (let guard = 0; guard < 16 && Math.abs(remaining) > 1e-12; guard++) {
      const track = index(scene).tracks.get(slider.trackId);
      if (!track) { slider.speed = 0; return; }
      const length = trackLength(track), direction = Math.sign(remaining);
      const target = direction > 0 ? length : 0;
      const available = (target - slider.s) * direction;
      if (Math.abs(remaining) < available - 1e-10) {
        slider.s += remaining;
        return;
      }
      remaining -= (target - slider.s);
      slider.s = target;
      const next = continueTrack(scene, track, direction > 0);
      if (!next) { slider.speed = 0; return; }
      const speed = Math.abs(slider.speed);
      slider.trackId = next.track.id;
      slider.s = next.atEnd ? trackLength(next.track) : 0;
      slider.speed = speed * next.direction;
      remaining = Math.abs(remaining) * next.direction;
    }
  }
  function step(scene, dt=1/240) {
    const forces=forceMap(scene),before=new Map(scene.balls.map(b=>[b.id,[b.vx,b.vy]]));
    for(const b of scene.balls){const f=forces.get(b.id);b.vx+=f[0]/b.mass*dt;b.vy+=f[1]/b.mass*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;}
    for (const slider of scene.sliders) {
      const point = sliderPoint(scene, slider), f = forces.get(slider.id);
      if (!point || !f) continue;
      const acceleration = (f[0] * point.tx + f[1] * point.ty) / slider.mass - slider.friction * slider.speed;
      slider.speed += acceleration * dt;
      slider._tx = point.tx; slider._ty = point.ty;
      advanceSlider(scene, slider, slider.speed * dt);
    }
    for(const b of scene.boards)if(!b.fixed&&!b.locked){
      const f=forces.get(b.id),pin=scene.anchors.find(a=>a.boardId===b.id);
      if(pin){
        const c=Math.cos(b.angle),s=Math.sin(b.angle),rx=c*pin.localX-s*pin.localY,ry=s*pin.localX+c*pin.localY;
        const pivotInertia=inertia(b)+b.mass*(rx*rx+ry*ry),torque=f[2]-rx*f[1]+ry*f[0];
        b.omega+=torque/pivotInertia*dt;b.angle+=b.omega*dt;
      }else{
        b.vx+=f[0]/b.mass*dt;b.vy+=f[1]/b.mass*dt;b.omega+=f[2]/inertia(b)*dt;
        b.x+=b.vx*dt;b.y+=b.vy*dt;b.angle+=b.omega*dt;
      }
    }
    syncAnchors(scene);
    syncSliders(scene);
    for(let iteration=0;iteration<10;iteration++){
      for(const r of scene.ropes)solveRope(scene,r);
      for(const b of scene.balls){for(const board of scene.boards){const c=boardContact(b,board);if(c)solveBoard(c);}for(const wall of scene.walls){const c=wallContact(b,wall);if(c)solveStatic(c);}}
      for(let i=0;i<scene.balls.length;i++)for(let j=i+1;j<scene.balls.length;j++)solveBalls(scene.balls[i],scene.balls[j]);
      for(const b of scene.boards)for(const w of scene.walls)solveBoardWall(b,w);
    }
    syncAnchors(scene);
    const contacts=new Map();
    for(const b of scene.balls){
      const [vx,vy]=before.get(b.id),[fx,fy]=forces.get(b.id);
      let cx=b.mass*(b.vx-vx)/dt-fx,cy=b.mass*(b.vy-vy)/dt-fy;
      if(Math.abs(cx)<.05)cx=0;if(Math.abs(cy)<.05)cy=0;
      contacts.set(b.id,[cx,cy]);
    }
    diagnostics.set(scene,{contacts});
  }
  function contactForce(scene,ball){const data=diagnostics.get(scene);return data&&data.contacts.get(ball.id)||[0,0];}
  function syncSpringsForMovedEndpoint(scene, objectId) {
    for (const spring of scene.springs) {
      const ends = linkEndpoints(scene, spring);
      if (!ends || !ends.some(end => end.id === objectId)) continue;
      const distance = Math.max(.01, hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y));
      spring.initialLength = distance;
      if (spring.autoRestLength !== false) spring.restLength = distance;
    }
  }
  function applySpringInitialLength(scene, spring) {
    if (!(spring.initialLength > 0)) return;
    const ends = linkEndpoints(scene, spring);
    if (!ends) return;
    let [fixed, moving] = ends;
    const movable = end => end.body && (end.body.kind === "ball" || end.body.kind === "slider") && !end.body.fixed;
    if (movable(ends[0]) && !movable(ends[1])) [fixed, moving] = [moving, fixed];
    else if (!movable(moving)) return;
    const sign = moving.id === ends[1].id ? 1 : -1;
    const dx = (ends[1].x - ends[0].x) * sign, dy = (ends[1].y - ends[0].y) * sign;
    const distance = hypot(dx, dy);
    if (distance < 1e-10) return;
    const nx = dx / distance, ny = dy / distance, change = spring.initialLength - distance;
    if (Math.abs(change) < 1e-12) return;
    if (moving.body.kind === "ball") {
      moving.body.x += nx * change; moving.body.y += ny * change;
    } else {
      const point = sliderPoint(scene, moving.body);
      if (point) {
        moving.body.s += (nx * point.tx + ny * point.ty) * change;
        syncSliders(scene);
      }
    }
  }
  function prepareStart(scene){
    for (const spring of scene.springs) applySpringInitialLength(scene, spring);
    for(const r of scene.ropes)if(r.autoLength){const ends=ropeEndpoints(scene,r);if(ends)r.length=Math.max(.01,hypot(ends[1].x-ends[0].x,ends[1].y-ends[0].y));}
  }
  function ballNoncontactForce(scene,ball){return forceMap(scene).get(ball.id).slice(0,2);}
  function ropeTension(scene,rope){
    const ends=ropeEndpoints(scene,rope);if(!ends)return 0;const [a,b]=ends,dx=b.x-a.x,dy=b.y-a.y,d=hypot(dx,dy);if(d<rope.length*.999||d<1e-12)return 0;
    const nx=dx/d,ny=dy/d,rvx=b.vx-a.vx,rvy=b.vy-a.vy,radial=rvx*nx+rvy*ny,ma=a.body?invMass(a.body)?a.body.mass:0:0,mb=b.body?invMass(b.body)?b.body.mass:0:0;
    const reduced=ma&&mb?ma*mb/(ma+mb):ma||mb||0;
    return reduced*Math.max(0,(rvx*rvx+rvy*rvy-radial*radial)/rope.length+(scene.gravityEnabled?scene.g*Math.abs(ny):0));
  }
  function inspectState(scene,item){
    if(!item)return ["未选中器材","点击场景中的对象查看状态"];
    const n=x=>Number(x).toFixed(3);
    if(item.kind==="ball"){
      const speed=hypot(item.vx,item.vy),f=ballNoncontactForce(scene,item),cf=contactForce(scene,item),total=[f[0]+cf[0],f[1]+cf[1]],torque=item.x*total[1]-item.y*total[0],links=(index(scene).links.get(item.id)||[]).map(x=>x.id);
      const touching=scene.boards.some(board=>boardContact(item,board))?"木板":scene.walls.some(wall=>wallContact(item,wall))?"墙/地面":"无（自由飞行）";
      return [`球 ${item.id}`,`位置: (${n(item.x)}, ${n(item.y)}) m`,`直径: ${n(2*item.radius)} m  质量: ${n(item.mass)} kg`,`电荷: ${n(item.charge)} C`,`速度: ${n(speed)} m/s  动能: ${n(.5*item.mass*speed*speed)} J`,`转动惯量(实心球): ${n(.4*item.mass*item.radius**2)} kg·m²`,`接触: ${touching}` ,`接触合力(上一物理步): (${n(cf[0])}, ${n(cf[1])}) N`,`非接触合力: (${n(f[0])}, ${n(f[1])}) N`,`总合力: (${n(total[0])}, ${n(total[1])}) N`,`合力对原点力矩: ${n(torque)} N·m`,`依赖: ${links.join(", ")||"无连接"}`];
    }
    if(item.kind==="board"){
      const f=forceMap(scene).get(item.id),anchors=(index(scene).boardAnchors.get(item.id)||[]).map(a=>a.id);
      return [`木板 ${item.id}`,`中心: (${n(item.x)}, ${n(item.y)}) m`,`长度: ${n(item.length)} m  厚度: ${n(item.thickness)} m`,`质量: ${n(item.mass)} kg  ${item.locked?"被多个锚点锁定":item.fixed?"固定":"可运动"}`,`角度: ${(item.angle*180/Math.PI).toFixed(2)}°  角速度: ${n(item.omega)} rad/s`,`速度: (${n(item.vx)}, ${n(item.vy)}) m/s`,`转动惯量: ${n(inertia(item))} kg·m²`,`非接触合力: (${n(f[0])}, ${n(f[1])}) N`,`对质心力矩: ${n(f[2])} N·m`,`钉上的锚点: ${anchors.join(", ")||"无"}`];
    }
    if(item.kind==="wall")return [`墙 ${item.id}`,`起点: (${n(item.ax)}, ${n(item.ay)}) m`,`终点: (${n(item.bx)}, ${n(item.by)}) m`,`长度: ${n(hypot(item.bx-item.ax,item.by-item.ay))} m`,`角度: ${(Math.atan2(item.by-item.ay,item.bx-item.ax)*180/Math.PI).toFixed(2)}°`,`速度: 0（固定）  依赖: 固定于世界`];
    if(item.kind==="anchor"){const [x,y]=anchorPosition(scene,item);return [`锚点 ${item.id}`,`位置: (${n(x)}, ${n(y)}) m（固定）`,`依赖: ${item.boardId?`固定于世界；作为 ${item.boardId} 的转轴`:"固定于世界"}`,`连接: ${[...scene.springs,...scene.ropes].filter(l=>l.anchorId===item.id||l.fromId===item.id||l.toId===item.id).map(l=>l.id).join(", ")||"无"}`];}
    if(item.kind==="track"){
      const ends=trackEndpoints(item),connected=scene.sliders.filter(s=>s.trackId===item.id).length;
      return [`${item.shape==="arc"?"弯道":"直线轨道"} ${item.id}`,`起点: (${n(ends[0].x)}, ${n(ends[0].y)}) m`,`终点: (${n(ends[1].x)}, ${n(ends[1].y)}) m`,`轨道长度: ${n(trackLength(item))} m`,`起点朝向: ${n(item.angle*180/Math.PI)}°`,...(item.shape==="arc"?[`半径: ${n(item.radius)} m  圆心角: ${n(item.sweep*180/Math.PI)}°`]:[]),"固定于世界，端点可自动吸附拼接",`当前滑块: ${connected}`];
    }
    if(item.kind==="slider"){
      const point=sliderPoint(scene,item),track=index(scene).tracks.get(item.trackId),speed=point?point.tx*item.speed:0;
      return [`滑块 ${item.id}`,`轨道: ${item.trackId}`,`位置: ${point?`(${n(point.x)}, ${n(point.y)}) m`:"无效"}`,`路程坐标: ${n(item.s)} / ${track?n(trackLength(track)):0} m`,`切向速度: ${n(item.speed)} m/s`,`质量: ${n(item.mass)} kg  动能: ${n(.5*item.mass*item.speed**2)} J`,`轨道切向: ${point?`(${n(point.tx)}, ${n(point.ty)})`:"无效"}`,`约束: 始终沿固定轨道运动（当前 vx = ${n(speed)} m/s）`];
    }
    if(item.kind==="spring"){
      const ends=linkEndpoints(scene,item);if(!ends)return ["连接无效"];
      const [a,b]=ends,d=hypot(b.x-a.x,b.y-a.y),f=springEndpointForce(scene,item,b);
      return [`弹簧 ${item.id}`,`当前长度: ${n(d)} m  原长: ${n(item.restLength)} m`,`初始长度: ${n(item.initialLength??d)} m  形变量: ${n(d-item.restLength)} m`,`长度跟随: ${item.autoRestLength!==false?"开启（移动端点时原长同步）":"关闭（保留手动原长）"}`,`相对速度: ${n(hypot(b.vx-a.vx,b.vy-a.vy))} m/s`,`末端弹力: (${n(f[0])}, ${n(f[1])}) N（另一端大小相等、方向相反）`,`依赖: ${a.id} + ${b.id}`];
    }
    const ends=ropeEndpoints(scene,item);if(!ends)return ["连接无效"];const [a,b]=ends,d=hypot(b.x-a.x,b.y-a.y);
    return [`绳 ${item.id}`,`当前距离: ${n(d)} m  设定长度: ${n(item.length)} m`,`长度模式: ${item.autoLength?"每次开始自动取长":"固定长度"}`,`状态: ${d>=item.length*.999?"拉紧":"松弛"}`,`相对速度: ${n(hypot(b.vx-a.vx,b.vy-a.vy))} m/s`,`估算张力: ${n(ropeTension(scene,item))} N`,`依赖: ${item.fromId} + ${item.toId}`];
  }
  function boundaries(){return [Wall(0,0,10,0,{restitution:.3,friction:.35}),Wall(0,0,0,6),Wall(10,0,10,6)];}
  function linkedPreset(name,spring=false){const b=Ball(6.4,3),a=Anchor(5,5),length=hypot(b.x-a.x,b.y-a.y);return Scene(name,{balls:[b],anchors:[a],walls:boundaries(),[spring?"springs":"ropes"]:[spring?Spring(b.id,a.id,{restLength:length}):Rope(b.id,a.id,{length})]});}
  const presets={
    "空白实验":()=>Scene("空白实验",{walls:boundaries()}),
    "木板滑球":()=>{const angle=-8*Math.PI/180,x=1.55;return Scene("木板滑球",{balls:[Ball(x,2.3+Math.tan(angle)*(x-4)+.33,{vx:2,friction:.1})],boards:[Board(4,2.3,{length:5,angle,friction:.08})],walls:boundaries()});},
    "自由落体":()=>Scene("自由落体",{balls:[Ball(4.5,5.3)],walls:boundaries()}),
    "平抛运动":()=>Scene("平抛运动",{balls:[Ball(.4,5,{vx:4})],walls:boundaries()}),
    "双球碰撞":()=>Scene("双球碰撞",{balls:[Ball(2,.27,{vx:3,restitution:1}),Ball(6,.27,{vx:-1,restitution:1})],walls:boundaries()}),
    "弹簧振子":()=>linkedPreset("弹簧振子",true),"绳摆":()=>linkedPreset("绳摆"),
    "动态木板":()=>{const b=Ball(3,4,{mass:2}),o=Board(5,2,{length:5,mass:3,fixed:false});return Scene("动态木板",{balls:[b],boards:[o],walls:boundaries()});},
    "电场中的电荷":()=>Scene("电场中的电荷",{g:0,gravityEnabled:false,electricX:2,balls:[Ball(3,3,{charge:2,vx:1}),Ball(7,3,{charge:-2,vx:-1})]}),
    "轨道与滑块":()=>{
      const line=makeLineTrack(1.2,4.2,4,-10*Math.PI/180);
      const end=trackPoint(line,4),arc=makeArcTrack(end.x,end.y,1.5,-90,line.angle);
      const slider=Slider(line.id,.55,{speed:.4,friction:.025});
      return Scene("轨道与滑块",{tracks:[line,arc],sliders:[slider],walls:boundaries()});
    }
  };

  const keyMaps={
    ball:{x:"x",y:"y",vx:"vx",vy:"vy",mass:"mass",radius:"radius",charge:"charge",restitution:"restitution",friction:"friction"},
    board:{x:"x",y:"y",vx:"vx",vy:"vy",length:"length",thickness:"thickness",angle:"angle",omega:"omega",mass:"mass",fixed:"fixed",restitution:"restitution",friction:"friction"},
    wall:{ax:"ax",ay:"ay",bx:"bx",by:"by",restitution:"restitution",friction:"friction"},
    anchor:{x:"x",y:"y",boardId:"board_id",localX:"local_x",localY:"local_y"},
    spring:{ballId:"ball_id",anchorId:"anchor_id",fromId:"from_id",toId:"to_id",stiffness:"stiffness",restLength:"rest_length",initialLength:"initial_length",autoRestLength:"auto_rest_length",damping:"damping"},
    rope:{fromId:"from_id",toId:"to_id",length:"length",autoLength:"auto_length"},
    track:{shape:"shape",x:"x",y:"y",length:"length",angle:"angle",radius:"radius",sweep:"sweep",startAngle:"start_angle",cx:"cx",cy:"cy",fixed:"fixed"},
    slider:{trackId:"track_id",s:"s",speed:"speed",mass:"mass",friction:"friction",width:"width",height:"height"}
  };
  const groupKeys={balls:"ball",boards:"board",walls:"wall",anchors:"anchor",springs:"spring",ropes:"rope",tracks:"track",sliders:"slider"};
  function serialize(scene){const out={version:scene.tracks.length||scene.sliders.length?4:3,name:scene.name,g:scene.g,gravity_enabled:scene.gravityEnabled,air_drag:scene.airDrag,electric_x:scene.electricX,electric_y:scene.electricY,coulomb_constant:scene.coulombConstant,gravitational_constant:scene.gravitationalConstant};
    for(const [key,kind] of Object.entries(groupKeys))out[key]=scene[key].map(obj=>{const raw={id:obj.id};for(const [js,json] of Object.entries(keyMaps[kind]))raw[json]=obj[js];return raw;});return out;}
  function deserialize(data){
    if(!data||![1,2,3,4].includes(data.version))throw new Error("不支持的场景版本");
    const scene=Scene(String(data.name||"我的力学世界"),{g:Number(data.g??9.8),gravityEnabled:data.gravity_enabled??true,airDrag:Number(data.air_drag??0),electricX:Number(data.electric_x??0),electricY:Number(data.electric_y??0),coulombConstant:Number(data.coulomb_constant??8.99e9),gravitationalConstant:Number(data.gravitational_constant??6.674e-11)});
    for(const raw of data.anchors||[]){const p={id:raw.id,x:raw.x,y:raw.y,boardId:raw.board_id??null,localX:raw.local_x??0,localY:raw.local_y??0};scene.anchors.push(Anchor(p.x,p.y,p));}
    for(const [key,kind] of Object.entries(groupKeys)){
      if(kind==="anchor")continue;
      for(const raw of data[key]||[]){
        const p={id:raw.id};for(const [js,json] of Object.entries(keyMaps[kind]))if(raw[json]!==undefined)p[js]=raw[json];
        let obj;
        if(kind==="ball")obj=Ball(p.x,p.y,p);else if(kind==="board")obj=Board(p.x,p.y,p);else if(kind==="wall")obj=Wall(p.ax,p.ay,p.bx,p.by,p);
        else if(kind==="track")obj=Track(p.x,p.y,p);else if(kind==="slider")obj=Slider(p.trackId,p.s,p);
        else {
          if(kind==="spring"){
            if(!p.anchorId){const a=Anchor(Number(raw.anchor_x),Number(raw.anchor_y));scene.anchors.push(a);p.anchorId=a.id;}
            obj=Spring(p.ballId,p.anchorId,p);
          }else{
            let fromId=p.fromId??p.ballId??raw.ball_id,toId=p.toId??p.anchorId??raw.anchor_id;
            if(!toId){const a=Anchor(Number(raw.anchor_x),Number(raw.anchor_y));scene.anchors.push(a);toId=a.id;}
            obj=Rope(fromId,toId,p);
          }
        }
        scene[key].push(obj);
      }
    }
    for(const items of groups(scene))for(const obj of items){const m=/_(\d+)$/.exec(obj.id||"");if(m)nextId=Math.max(nextId,Number(m[1])+1);}
    validate(scene);reindex(scene);syncAnchors(scene);syncSliders(scene);return scene;
  }
  function finite(value){if(typeof value==="number"&&!Number.isFinite(value))throw new Error("参数必须是有限数值");if(value&&typeof value==="object")for(const child of Object.values(value))finite(child);}
  function validate(scene){
    finite(serialize(scene));const all=groups(scene).flat(),ids=all.map(x=>x.id);if(new Set(ids).size!==ids.length)throw new Error("器材 ID 不能重复");
    for(const b of scene.balls)if(!(b.mass>0&&b.radius>0))throw new Error("质量和半径必须大于零");
    for(const b of scene.boards)if(!(b.length>0&&b.thickness>0&&b.mass>0))throw new Error("木板尺寸和质量必须大于零");
    for(const item of [...scene.balls,...scene.boards,...scene.walls])if(item.restitution<0||item.restitution>1||item.friction<0)throw new Error("弹性或摩擦参数无效");
    const ballIds=new Set(scene.balls.map(b=>b.id)),anchorIds=new Set(scene.anchors.map(a=>a.id)),boardIds=new Set(scene.boards.map(b=>b.id));
    const trackIds=new Set(scene.tracks.map(t=>t.id)),sliderIds=new Set(scene.sliders.map(s=>s.id));
    for(const track of scene.tracks){
      if(!(trackLength(track)>0))throw new Error("轨道长度必须大于零");
      if(track.shape==="arc"&&(!(track.radius>0)||Math.abs(track.sweep)>2*Math.PI))throw new Error("弯道半径或圆心角无效");
    }
    for(const slider of scene.sliders)if(!trackIds.has(slider.trackId)||!(slider.mass>0)||slider.friction<0||!(slider.width>0)||!(slider.height>0))throw new Error("滑块参数或所属轨道无效");
    for(const a of scene.anchors)if(a.boardId&&!boardIds.has(a.boardId))throw new Error("锚点依赖的木板不存在");
    const endpointIds=new Set([...ballIds,...anchorIds,...sliderIds]);
    for(const s of scene.springs){const fromId=s.fromId??s.ballId,toId=s.toId??s.anchorId;if(!endpointIds.has(fromId)||!endpointIds.has(toId)||fromId===toId||s.stiffness<0||!(s.restLength>=0)||s.damping<0||(s.initialLength!==null&&!(s.initialLength>0)))throw new Error("弹簧参数或连接无效");}
    for(const r of scene.ropes){if(!endpointIds.has(r.fromId)||!endpointIds.has(r.toId)||r.fromId===r.toId||!(r.length>0))throw new Error("绳参数或连接无效");}
  }
  const clone=scene=>deserialize(serialize(scene));
  const api={Ball,Board,Wall,Anchor,Spring,Rope,Track,Slider,LineTrack:makeLineTrack,ArcTrack:makeArcTrack,Scene,DT:1/240,presets,step,prepareStart,reindex,ballById,getObject,removeObject,
    inertia,anchorPosition,anchorVelocity,attachAnchor,detachAnchor,syncAnchors,syncSliders,trackLength,trackPoint,trackEndpoints,projectTrack,sliderPoint,advanceSlider,
    linkEndpoint,linkEndpoints,ropeEndpoints,solveRope,springForce,syncSpringsForMovedEndpoint,applySpringInitialLength,boardContact,wallContact,ballNoncontactForce,contactForce,ropeTension,inspectState,serialize,deserialize,validate,clone};
  global.PhysicsLab=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
