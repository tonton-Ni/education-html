"""力函数只计算力，不直接改变物体状态。"""
import math

from core import Ball, Spring


def gravity(ball: Ball, g: float) -> tuple[float, float]:
    return 0.0, -ball.mass * g


def air_drag(ball: Ball, coefficient: float) -> tuple[float, float]:
    return -coefficient * ball.vx, -coefficient * ball.vy


def spring_force(spring: Spring, ball: Ball) -> tuple[float, float]:
    dx, dy = ball.x-spring.anchor_x, ball.y-spring.anchor_y
    distance = math.hypot(dx, dy)
    if distance < 1e-12:
        return 0.0, 0.0
    nx, ny = dx/distance, dy/distance
    radial_speed = ball.vx*nx + ball.vy*ny
    magnitude = -spring.stiffness*(distance-spring.rest_length) - spring.damping*radial_speed
    return magnitude*nx, magnitude*ny
