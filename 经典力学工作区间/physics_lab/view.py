"""把 Scene 映射为 Matplotlib 图形，不包含物理计算。"""
import math

from matplotlib.patches import Circle, Polygon

from core import Board


def board_corners(board: Board):
    c, s = math.cos(board.angle), math.sin(board.angle)
    hx, hy = board.length/2, board.thickness/2
    return [(board.x+c*x-s*y, board.y+s*x+c*y)
            for x, y in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))]


def spring_points(spring, ball, coils=12):
    dx, dy = ball.x-spring.anchor_x, ball.y-spring.anchor_y
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return [spring.anchor_x], [spring.anchor_y]
    nx, ny = -dy/length*0.09, dx/length*0.09
    points = [(spring.anchor_x, spring.anchor_y)]
    for i in range(1, coils*2):
        t = i/(coils*2)
        sign = 1 if i % 2 else -1
        points.append((spring.anchor_x+dx*t+sign*nx, spring.anchor_y+dy*t+sign*ny))
    points.append((ball.x, ball.y))
    return [p[0] for p in points], [p[1] for p in points]


class SceneView:
    def __init__(self, ax):
        self.ax = ax
        self.artists = {}

    def rebuild(self, scene):
        previous_limits = (self.ax.get_xlim(), self.ax.get_ylim()) if self.artists else None
        self.ax.clear()
        self.ax.set(xlim=(0, 10), ylim=(0, 6), xlabel="x / m", ylabel="y / m",
                    title=scene.name)
        if previous_limits:
            self.ax.set_xlim(*previous_limits[0])
            self.ax.set_ylim(*previous_limits[1])
        self.ax.set_aspect("equal", adjustable="box")
        self.ax.grid(alpha=0.18)
        self.trajectory, = self.ax.plot([], [], color="#e67e22", alpha=0.5, lw=1)
        self.artists = {}
        for wall in scene.walls:
            line, = self.ax.plot([], [], color="#555555", lw=3, solid_capstyle="round")
            self.artists[wall.id] = (line,)
        for board in scene.boards:
            patch = Polygon(board_corners(board), closed=True, facecolor="#c98f52",
                            edgecolor="#654321", lw=1.5)
            self.ax.add_patch(patch)
            self.artists[board.id] = (patch,)
        for connector in [*scene.springs, *scene.ropes]:
            line, = self.ax.plot([], [], color="#8e44ad" if connector in scene.springs else "#333333", lw=1.5)
            anchor, = self.ax.plot([connector.anchor_x], [connector.anchor_y], "x", color="black", ms=8)
            self.artists[connector.id] = (line, anchor)
        for ball in scene.balls:
            patch = Circle((ball.x, ball.y), ball.radius, facecolor="#3498db",
                           edgecolor="#154360", lw=1.5, zorder=5)
            self.ax.add_patch(patch)
            self.artists[ball.id] = (patch,)
        self.update(scene)

    def update(self, scene, selected_id=None):
        for wall in scene.walls:
            self.artists[wall.id][0].set_data([wall.ax, wall.bx], [wall.ay, wall.by])
        for board in scene.boards:
            self.artists[board.id][0].set_xy(board_corners(board))
        for connector in [*scene.springs, *scene.ropes]:
            ball = scene.ball_by_id(connector.ball_id)
            line, anchor = self.artists[connector.id]
            if connector in scene.springs:
                line.set_data(*spring_points(connector, ball))
            else:
                line.set_data([connector.anchor_x, ball.x], [connector.anchor_y, ball.y])
            anchor.set_data([connector.anchor_x], [connector.anchor_y])
        for ball in scene.balls:
            patch = self.artists[ball.id][0]
            patch.center = ball.x, ball.y
            patch.radius = ball.radius
            patch.set_facecolor("#f39c12" if ball.id == selected_id else "#3498db")
        for object_id, artists in self.artists.items():
            for artist in artists:
                artist.set_linewidth(3 if object_id == selected_id else
                                     (3 if object_id.startswith("wall") else 1.5))
