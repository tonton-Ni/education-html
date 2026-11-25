"""可直接打开和继续编辑的实验预设。"""
import math

from core import Ball, Board, Rope, Scene, Spring, Wall


def boundary_walls() -> list[Wall]:
    return [Wall(0, 0, 10, 0, restitution=0.3, friction=0.35),
            Wall(0, 0, 0, 6), Wall(10, 0, 10, 6)]


def board_demo() -> Scene:
    angle = math.radians(-8)
    ball_x = 1.55
    board = Board(4.0, 2.3, length=5.0, angle=angle, friction=0.08)
    ball_y = board.y + math.tan(angle)*(ball_x-board.x) + 0.33
    return Scene("木板滑球", balls=[Ball(ball_x, ball_y, vx=2.0, friction=0.1)],
                 boards=[board], walls=boundary_walls())


def free_fall() -> Scene:
    return Scene("自由落体", balls=[Ball(4.5, 5.3)], walls=boundary_walls())


def projectile() -> Scene:
    return Scene("平抛运动", balls=[Ball(0.4, 5.0, vx=4.0)], walls=boundary_walls())


def two_balls() -> Scene:
    return Scene("双球碰撞", balls=[Ball(2, 0.27, vx=3, restitution=1),
                                   Ball(6, 0.27, vx=-1, restitution=1)],
                 walls=boundary_walls())


def spring_demo() -> Scene:
    ball = Ball(5, 2.5)
    return Scene("弹簧振子", balls=[ball], walls=boundary_walls(),
                 springs=[Spring(ball.id, 5, 5, stiffness=20, rest_length=2)])


def pendulum() -> Scene:
    ball = Ball(6.4, 3.0)
    return Scene("绳摆", balls=[ball], walls=boundary_walls(),
                 ropes=[Rope(ball.id, 5, 5, length=math.hypot(1.4, 2))])


PRESETS = {
    "木板滑球": board_demo,
    "自由落体": free_fall,
    "平抛运动": projectile,
    "双球碰撞": two_balls,
    "弹簧振子": spring_demo,
    "绳摆": pendulum,
}
