"""鼠标编辑工具与选中对象的属性面板。"""
import math

from matplotlib.widgets import TextBox

from core import Ball, Board, Rope, Spring, Wall
from scene_io import validate_scene


PROPERTY_FIELDS = {
    Ball: (("x", "x/m"), ("y", "y/m"), ("vx", "vx/(m/s)"), ("vy", "vy/(m/s)"),
           ("mass", "质量/kg"), ("radius", "半径/m"), ("restitution", "弹性0~1"), ("friction", "摩擦")),
    Board: (("x", "x/m"), ("y", "y/m"), ("length", "长度/m"), ("thickness", "厚度/m"),
            ("angle", "角度/°"), ("restitution", "弹性0~1"), ("friction", "摩擦")),
    Wall: (("ax", "起点x"), ("ay", "起点y"), ("bx", "终点x"), ("by", "终点y"),
           ("restitution", "弹性0~1"), ("friction", "摩擦")),
    Spring: (("anchor_x", "锚点x"), ("anchor_y", "锚点y"), ("stiffness", "劲度k"),
             ("rest_length", "原长/m"), ("damping", "阻尼")),
    Rope: (("anchor_x", "锚点x"), ("anchor_y", "锚点y"), ("length", "绳长/m")),
}


def point_segment_distance(x, y, ax, ay, bx, by):
    dx, dy = bx-ax, by-ay
    length2 = dx*dx+dy*dy
    if length2 < 1e-12:
        return math.hypot(x-ax, y-ay)
    u = max(0, min(1, ((x-ax)*dx+(y-ay)*dy)/length2))
    return math.hypot(x-(ax+u*dx), y-(ay+u*dy))


class SceneEditor:
    def __init__(self, app):
        self.app = app
        self.tool = "选择"
        self.selected_id = None
        self.pending = None
        self.dragging = False
        self.drag_offset = (0, 0)
        self.property_axes = []
        self.property_boxes = []

    @property
    def selected(self):
        scene = self.app.scene
        for items in (scene.balls, scene.boards, scene.walls, scene.springs, scene.ropes):
            for item in items:
                if item.id == self.selected_id:
                    return item
        return None

    def set_tool(self, tool):
        self.tool = tool
        self.pending = None
        hints = {"选择": "点击选择，拖动球/板/墙；Delete 删除",
                 "添加球": "点击场景放球，再在右侧设置初速度",
                 "添加木板": "点击场景放板，在右侧调整角度和摩擦",
                 "添加墙": "依次点击墙的两个端点",
                 "添加弹簧": "先点击球，再点击固定锚点",
                 "添加绳": "先点击球，再点击固定锚点"}
        self.app.set_status(hints[tool])

    def hit_test(self, x, y):
        scene = self.app.scene
        for ball in reversed(scene.balls):
            if math.hypot(x-ball.x, y-ball.y) <= ball.radius+0.12:
                return ball
        for board in reversed(scene.boards):
            c, s = math.cos(board.angle), math.sin(board.angle)
            dx, dy = x-board.x, y-board.y
            if abs(c*dx+s*dy) <= board.length/2+0.1 and abs(-s*dx+c*dy) <= board.thickness/2+0.1:
                return board
        for wall in reversed(scene.walls):
            if point_segment_distance(x, y, wall.ax, wall.ay, wall.bx, wall.by) < 0.12:
                return wall
        for connector in [*scene.springs, *scene.ropes]:
            ball = scene.ball_by_id(connector.ball_id)
            if point_segment_distance(x, y, connector.anchor_x, connector.anchor_y, ball.x, ball.y) < 0.1:
                return connector
        return None

    def press(self, x, y):
        if not self.app.paused:
            self.app.set_status("请先暂停，再编辑器材")
            return
        scene = self.app.scene
        if self.tool == "添加球":
            item = Ball(x, y)
            scene.balls.append(item)
            self.app.commit()
            self.select(item)
            return
        if self.tool == "添加木板":
            item = Board(x, y)
            scene.boards.append(item)
            self.app.commit()
            self.select(item)
            return
        if self.tool == "添加墙":
            if self.pending is None:
                self.pending = (x, y)
                self.app.set_status("点击第二个端点")
            else:
                ax, ay = self.pending
                if math.hypot(x-ax, y-ay) < 0.1:
                    self.app.set_status("墙太短，请重新点击第二个端点")
                    return
                item = Wall(ax, ay, x, y)
                scene.walls.append(item)
                self.pending = None
                self.select(item)
                self.app.commit()
            return
        if self.tool in ("添加弹簧", "添加绳"):
            hit = self.hit_test(x, y)
            if self.pending is None:
                if not isinstance(hit, Ball):
                    self.app.set_status("第一步必须点击一个球")
                    return
                self.pending = hit.id
                self.app.set_status("再点击空白处放置固定锚点")
                return
            length = math.hypot(x-hit.x, y-hit.y) if isinstance(hit, Ball) else 0.0
            ball = scene.ball_by_id(self.pending)
            length = math.hypot(x-ball.x, y-ball.y)
            if length < 0.1:
                self.app.set_status("连接太短，请点击更远的位置")
                return
            cls = Spring if self.tool == "添加弹簧" else Rope
            kwargs = {"rest_length": length} if cls is Spring else {"length": length}
            item = cls(ball.id, x, y, **kwargs)
            (scene.springs if cls is Spring else scene.ropes).append(item)
            self.pending = None
            self.app.commit()
            self.select(item)
            return

        hit = self.hit_test(x, y)
        self.select(hit)
        if isinstance(hit, (Ball, Board)):
            self.dragging = True
            self.drag_offset = hit.x-x, hit.y-y
        elif isinstance(hit, Wall):
            self.dragging = True
            self.drag_offset = x, y

    def motion(self, x, y):
        if not self.app.paused:
            self.dragging = False
            return
        if not self.dragging:
            return
        item = self.selected
        if isinstance(item, (Ball, Board)):
            item.x, item.y = x+self.drag_offset[0], y+self.drag_offset[1]
            if isinstance(item, Ball):
                item.vx = item.vy = 0.0
        elif isinstance(item, Wall):
            dx, dy = x-self.drag_offset[0], y-self.drag_offset[1]
            item.ax += dx; item.bx += dx; item.ay += dy; item.by += dy
            self.drag_offset = x, y
        self.app.redraw()

    def release(self):
        if self.dragging:
            self.dragging = False
            self.app.commit(rebuild=False)
            self.build_properties()

    def select(self, item):
        self.selected_id = item.id if item else None
        self.build_properties()
        self.app.redraw()

    def delete(self):
        if not self.app.paused:
            self.app.set_status("运行中不能删除；请先暂停")
            return
        if self.selected_id and self.app.scene.remove(self.selected_id):
            self.selected_id = None
            self.app.commit()
            self.app.set_status("已删除；与球相连的弹簧/绳也会删除")

    def build_properties(self):
        for ax in self.property_axes:
            ax.remove()
        self.property_axes = []
        self.property_boxes = []
        item = self.selected
        if item is None:
            return
        for i, (attribute, label) in enumerate(PROPERTY_FIELDS[type(item)]):
            ax = self.app.fig.add_axes([0.77, 0.54-i*0.033, 0.19, 0.027])
            value = math.degrees(item.angle) if attribute == "angle" and isinstance(item, Board) else getattr(item, attribute)
            box = TextBox(ax, label, initial=f"{value:.4g}")
            box.on_submit(lambda text, a=attribute: self.change_property(a, text))
            box.set_active(self.app.paused)
            self.property_axes.append(ax)
            self.property_boxes.append(box)

    def set_enabled(self, enabled):
        for box in self.property_boxes:
            box.set_active(enabled)
        if not enabled:
            self.dragging = False
            self.pending = None

    def change_property(self, attribute, text):
        if not self.app.paused:
            self.app.set_status("运行中参数已锁定；请先暂停")
            return
        item = self.selected
        if item is None:
            return
        try:
            value = float(text)
            if attribute == "angle" and isinstance(item, Board):
                value = math.radians(value)
            old = getattr(item, attribute)
            setattr(item, attribute, value)
            validate_scene(self.app.scene)
        except (ValueError, TypeError) as exc:
            if "old" in locals():
                setattr(item, attribute, old)
            self.app.set_status(f"参数无效：{exc}")
        else:
            self.app.commit(rebuild=False)
            self.app.redraw()
