"""圆与旋转矩形、线段及其他圆的碰撞求解。"""
import math
from dataclasses import dataclass

from core import Ball, Board, Wall


@dataclass
class StaticContact:
    ball: Ball
    nx: float
    ny: float
    penetration: float
    restitution: float
    friction: float


@dataclass
class BallContact:
    a: Ball
    b: Ball
    nx: float
    ny: float
    penetration: float


def board_contact(ball: Ball, board: Board) -> StaticContact | None:
    c, s = math.cos(board.angle), math.sin(board.angle)
    dx, dy = ball.x-board.x, ball.y-board.y
    qx, qy = c*dx+s*dy, -s*dx+c*dy
    hx, hy = board.length/2, board.thickness/2
    cx, cy = max(-hx, min(hx, qx)), max(-hy, min(hy, qy))
    dx_local, dy_local = qx-cx, qy-cy
    distance = math.hypot(dx_local, dy_local)

    if distance > 1e-12:
        if distance >= ball.radius:
            return None
        nx_local, ny_local = dx_local/distance, dy_local/distance
        penetration = ball.radius-distance
    else:
        # 球心进入矩形：选择最近面，将球完整推出。
        faces = ((hx-qx, 1.0, 0.0), (hx+qx, -1.0, 0.0),
                 (hy-qy, 0.0, 1.0), (hy+qy, 0.0, -1.0))
        depth, nx_local, ny_local = min(faces, key=lambda face: face[0])
        penetration = ball.radius+depth

    return StaticContact(
        ball, c*nx_local-s*ny_local, s*nx_local+c*ny_local, penetration,
        min(ball.restitution, board.restitution), math.sqrt(ball.friction*board.friction),
    )


def wall_contact(ball: Ball, wall: Wall) -> StaticContact | None:
    abx, aby = wall.bx-wall.ax, wall.by-wall.ay
    length_squared = abx*abx+aby*aby
    if length_squared < 1e-16:
        return None
    u = max(0.0, min(1.0, ((ball.x-wall.ax)*abx+(ball.y-wall.ay)*aby)/length_squared))
    cx, cy = wall.ax+u*abx, wall.ay+u*aby
    dx, dy = ball.x-cx, ball.y-cy
    distance = math.hypot(dx, dy)
    if distance >= ball.radius:
        return None
    if distance > 1e-12:
        nx, ny = dx/distance, dy/distance
    else:
        speed = math.hypot(ball.vx, ball.vy)
        nx, ny = (-ball.vx/speed, -ball.vy/speed) if speed else (0.0, 1.0)
    return StaticContact(
        ball, nx, ny, ball.radius-distance,
        min(ball.restitution, wall.restitution), math.sqrt(ball.friction*wall.friction),
    )


def ball_contact(a: Ball, b: Ball) -> BallContact | None:
    dx, dy = b.x-a.x, b.y-a.y
    distance = math.hypot(dx, dy)
    penetration = a.radius+b.radius-distance
    if penetration <= 0:
        return None
    nx, ny = (dx/distance, dy/distance) if distance > 1e-12 else (1.0, 0.0)
    return BallContact(a, b, nx, ny, penetration)


def solve_static(contact: StaticContact, dt: float) -> None:
    ball = contact.ball
    nx, ny = contact.nx, contact.ny
    vn = ball.vx*nx+ball.vy*ny
    normal_impulse = 0.0
    if vn < 0:
        e = contact.restitution if vn < -0.5 else 0.0
        normal_impulse = -(1+e)*vn
        ball.vx += normal_impulse*nx
        ball.vy += normal_impulse*ny
        tx, ty = -ny, nx
        vt = ball.vx*tx+ball.vy*ty
        friction_impulse = max(-contact.friction*normal_impulse,
                               min(contact.friction*normal_impulse, -vt))
        ball.vx += friction_impulse*tx
        ball.vy += friction_impulse*ty
    correction = max(0.0, contact.penetration-1e-5)*0.8
    ball.x += correction*nx
    ball.y += correction*ny


def solve_balls(contact: BallContact) -> None:
    a, b, nx, ny = contact.a, contact.b, contact.nx, contact.ny
    wa, wb = 1/a.mass, 1/b.mass
    total_inverse_mass = wa+wb
    rvx, rvy = b.vx-a.vx, b.vy-a.vy
    vn = rvx*nx+rvy*ny
    normal_impulse = 0.0
    if vn < 0:
        e = min(a.restitution, b.restitution) if vn < -0.5 else 0.0
        normal_impulse = -(1+e)*vn/total_inverse_mass
        ix, iy = normal_impulse*nx, normal_impulse*ny
        a.vx -= wa*ix
        a.vy -= wa*iy
        b.vx += wb*ix
        b.vy += wb*iy
        tx, ty = -ny, nx
        vt = (b.vx-a.vx)*tx+(b.vy-a.vy)*ty
        mu = math.sqrt(a.friction*b.friction)
        jt = max(-mu*normal_impulse, min(mu*normal_impulse, -vt/total_inverse_mass))
        a.vx -= wa*jt*tx
        a.vy -= wa*jt*ty
        b.vx += wb*jt*tx
        b.vy += wb*jt*ty
    correction = max(0.0, contact.penetration-1e-5)*0.8/total_inverse_mass
    a.x -= correction*wa*nx
    a.y -= correction*wa*ny
    b.x += correction*wb*nx
    b.y += correction*wb*ny
