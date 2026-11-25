"""沙盒的纯数据模型；坐标用米，角度用弧度。"""
from dataclasses import dataclass, field
from itertools import count


_ids = count(1)


def new_id(prefix: str) -> str:
    return f"{prefix}_{next(_ids)}"


@dataclass
class Ball:
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    mass: float = 1.0
    radius: float = 0.25
    restitution: float = 0.3
    friction: float = 0.4
    id: str = field(default_factory=lambda: new_id("ball"))

    @property
    def kinetic_energy(self) -> float:
        return 0.5 * self.mass * (self.vx**2 + self.vy**2)


@dataclass
class Board:
    x: float
    y: float
    length: float = 4.0
    thickness: float = 0.16
    angle: float = 0.0
    restitution: float = 0.2
    friction: float = 0.35
    id: str = field(default_factory=lambda: new_id("board"))


@dataclass
class Wall:
    ax: float
    ay: float
    bx: float
    by: float
    restitution: float = 0.3
    friction: float = 0.3
    id: str = field(default_factory=lambda: new_id("wall"))


@dataclass
class Spring:
    ball_id: str
    anchor_x: float
    anchor_y: float
    stiffness: float = 20.0
    rest_length: float = 2.0
    damping: float = 0.1
    id: str = field(default_factory=lambda: new_id("spring"))

    def potential_energy(self, ball: Ball) -> float:
        extension = ((ball.x-self.anchor_x)**2 + (ball.y-self.anchor_y)**2)**0.5
        return 0.5 * self.stiffness * (extension-self.rest_length)**2


@dataclass
class Rope:
    ball_id: str
    anchor_x: float
    anchor_y: float
    length: float = 2.0
    id: str = field(default_factory=lambda: new_id("rope"))


@dataclass
class Scene:
    name: str = "我的力学世界"
    g: float = 9.8
    air_drag: float = 0.0
    balls: list[Ball] = field(default_factory=list)
    boards: list[Board] = field(default_factory=list)
    walls: list[Wall] = field(default_factory=list)
    springs: list[Spring] = field(default_factory=list)
    ropes: list[Rope] = field(default_factory=list)

    def ball_by_id(self, ball_id: str) -> Ball:
        return next(ball for ball in self.balls if ball.id == ball_id)

    def remove(self, object_id: str) -> bool:
        for items in (self.balls, self.boards, self.walls, self.springs, self.ropes):
            for item in list(items):
                if item.id == object_id:
                    items.remove(item)
                    if isinstance(item, Ball):
                        self.springs = [s for s in self.springs if s.ball_id != item.id]
                        self.ropes = [r for r in self.ropes if r.ball_id != item.id]
                    return True
        return False
