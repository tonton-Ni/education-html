"""绳是只拉不推的长度约束。"""
import math

from core import Ball, Rope


def solve_rope(rope: Rope, ball: Ball) -> None:
    dx, dy = ball.x-rope.anchor_x, ball.y-rope.anchor_y
    distance = math.hypot(dx, dy)
    if distance <= rope.length or distance < 1e-12:
        return
    nx, ny = dx/distance, dy/distance
    outward_speed = ball.vx*nx+ball.vy*ny
    if outward_speed > 0:
        ball.vx -= outward_speed*nx
        ball.vy -= outward_speed*ny
    correction = (distance-rope.length)*0.8
    ball.x -= correction*nx
    ball.y -= correction*ny
