"""独立于界面的固定时间步物理引擎。"""
from collisions import ball_contact, board_contact, solve_balls, solve_static, wall_contact
from constraints import solve_rope
from core import Scene
from forces import air_drag, gravity, spring_force


class Simulator:
    def __init__(self, scene: Scene, dt: float = 1/240):
        self.scene = scene
        self.dt = dt
        self.time = 0.0

    def step(self) -> None:
        scene, dt = self.scene, self.dt
        forces = {ball.id: [0.0, 0.0] for ball in scene.balls}
        for ball in scene.balls:
            for fx, fy in (gravity(ball, scene.g), air_drag(ball, scene.air_drag)):
                forces[ball.id][0] += fx
                forces[ball.id][1] += fy
        for spring in scene.springs:
            ball = scene.ball_by_id(spring.ball_id)
            fx, fy = spring_force(spring, ball)
            forces[ball.id][0] += fx
            forces[ball.id][1] += fy

        for ball in scene.balls:
            fx, fy = forces[ball.id]
            ball.vx += fx/ball.mass*dt
            ball.vy += fy/ball.mass*dt
            ball.x += ball.vx*dt
            ball.y += ball.vy*dt

        # 重新检测接触并迭代，减少叠放和绳接触组合时的穿透。
        for _ in range(8):
            for rope in scene.ropes:
                solve_rope(rope, scene.ball_by_id(rope.ball_id))
            for ball in scene.balls:
                for board in scene.boards:
                    contact = board_contact(ball, board)
                    if contact:
                        solve_static(contact, dt)
                for wall in scene.walls:
                    contact = wall_contact(ball, wall)
                    if contact:
                        solve_static(contact, dt)
            for i, a in enumerate(scene.balls):
                for b in scene.balls[i+1:]:
                    contact = ball_contact(a, b)
                    if contact:
                        solve_balls(contact)
        self.time += dt

    def mechanical_energy(self) -> float:
        energy = sum(ball.kinetic_energy + ball.mass*self.scene.g*ball.y
                     for ball in self.scene.balls)
        return energy + sum(s.potential_energy(self.scene.ball_by_id(s.ball_id))
                            for s in self.scene.springs)
