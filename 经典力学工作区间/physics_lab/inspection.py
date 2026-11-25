"""侧栏只读状态。力矩明确以世界原点或连接锚点为参考。"""
import math

from core import Ball, Board, Rope, Scene, Spring, Wall
from forces import air_drag, gravity, spring_force


def ball_noncontact_force(scene: Scene, ball: Ball) -> tuple[float, float]:
    fx, fy = gravity(ball, scene.g)
    dx, dy = air_drag(ball, scene.air_drag)
    fx += dx
    fy += dy
    for spring in scene.springs:
        if spring.ball_id == ball.id:
            sx, sy = spring_force(spring, ball)
            fx += sx
            fy += sy
    return fx, fy


def rope_tension(scene: Scene, rope: Rope) -> float:
    ball = scene.ball_by_id(rope.ball_id)
    dx, dy = ball.x-rope.anchor_x, ball.y-rope.anchor_y
    distance = math.hypot(dx, dy)
    if distance < rope.length*0.999 or distance < 1e-12:
        return 0.0
    nx, ny = dx/distance, dy/distance
    radial_speed = ball.vx*nx+ball.vy*ny
    tangent_speed_squared = max(0.0, ball.vx**2+ball.vy**2-radial_speed**2)
    return ball.mass*max(0.0, tangent_speed_squared/rope.length+scene.g*ny)


def state_lines(scene: Scene, item) -> list[str]:
    if item is None:
        return ["未选中器材", "点击场景中的对象查看状态"]
    if isinstance(item, Ball):
        speed = math.hypot(item.vx, item.vy)
        fx, fy = ball_noncontact_force(scene, item)
        torque = item.x*fy-item.y*fx
        links = [obj.id for obj in [*scene.springs, *scene.ropes] if obj.ball_id == item.id]
        return [
            f"球 {item.id}", f"位置: ({item.x:.3f}, {item.y:.3f}) m",
            f"直径: {2*item.radius:.3f} m  质量: {item.mass:.3f} kg",
            f"速度: {speed:.3f} m/s  动能: {item.kinetic_energy:.3f} J",
            f"转动惯量(实心球): {0.4*item.mass*item.radius**2:.4f} kg·m²",
            f"非接触合力: ({fx:.3f}, {fy:.3f}) N",
            f"合力对原点力矩: {torque:.3f} N·m",
            "依赖: "+(", ".join(links) if links else "无连接"),
        ]
    if isinstance(item, Board):
        return [f"木板 {item.id}", f"中心: ({item.x:.3f}, {item.y:.3f}) m",
                f"长度: {item.length:.3f} m  厚度: {item.thickness:.3f} m",
                f"角度: {math.degrees(item.angle):.2f}°  速度: 0（固定）",
                "依赖: 固定于世界", "合力/力矩: 由支架抵消"]
    if isinstance(item, Wall):
        length = math.hypot(item.bx-item.ax, item.by-item.ay)
        angle = math.degrees(math.atan2(item.by-item.ay, item.bx-item.ax))
        return [f"墙 {item.id}", f"起点: ({item.ax:.3f}, {item.ay:.3f}) m",
                f"终点: ({item.bx:.3f}, {item.by:.3f}) m",
                f"长度: {length:.3f} m  角度: {angle:.2f}°",
                "速度: 0（固定）", "依赖: 固定于世界"]
    ball = scene.ball_by_id(item.ball_id)
    length = math.hypot(ball.x-item.anchor_x, ball.y-item.anchor_y)
    speed = math.hypot(ball.vx, ball.vy)
    if isinstance(item, Spring):
        fx, fy = spring_force(item, ball)
        return [f"弹簧 {item.id}", f"当前长度: {length:.3f} m  原长: {item.rest_length:.3f} m",
                f"形变量: {length-item.rest_length:.3f} m  球速度: {speed:.3f} m/s",
                f"弹力: ({fx:.3f}, {fy:.3f}) N", "对锚点力矩: 0（力过锚点）",
                f"依赖: {item.ball_id} + 固定锚点"]
    if isinstance(item, Rope):
        return [f"绳 {item.id}", f"当前距离: {length:.3f} m  设定长度: {item.length:.3f} m",
                f"状态: {'拉紧' if length >= item.length*0.999 else '松弛'}  球速度: {speed:.3f} m/s",
                f"估算张力: {rope_tension(scene, item):.3f} N", "对锚点力矩: 0（力过锚点）",
                f"依赖: {item.ball_id} + 固定锚点"]
    return [str(item)]
