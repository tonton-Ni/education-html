"""经典力学沙盒：python main.py。空格播放/暂停，R 重置，Delete 删除。"""
from copy import deepcopy
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from matplotlib.widgets import Button, RadioButtons, Slider

from editor import SceneEditor
from experiments import PRESETS, board_demo
from inspection import state_lines
from scene_io import load_scene, save_scene
from simulation import Simulator
from view import SceneView

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


class PhysicsLab:
    def __init__(self):
        self.scene = board_demo()
        self.initial_scene = deepcopy(self.scene)
        self.simulator = Simulator(self.scene)
        self.paused = True
        self.preset_index = 0
        self.trail = []
        self.pan_start = None
        self.fig = plt.figure(figsize=(13, 8))
        self.ax = self.fig.add_axes([0.05, 0.16, 0.66, 0.75])
        self.view = SceneView(self.ax)
        self.editor = SceneEditor(self)
        self._make_controls()
        self.view.rebuild(self.scene)
        self.set_status("暂停中：选择工具添加器材；点击球后可设置 vx/vy。按空格开始")

    def _make_controls(self):
        self.fig.suptitle("经典力学沙盒", fontsize=17)
        self.status_text = self.fig.text(0.05, 0.935, "", fontsize=10, color="#154360")
        self.state_text = self.fig.text(0.75, 0.765, "", fontsize=7.5, va="top", linespacing=1.12)
        radio_ax = self.fig.add_axes([0.75, 0.79, 0.22, 0.12])
        self.tools = RadioButtons(radio_ax, ("选择", "添加球", "添加木板", "添加墙", "添加弹簧", "添加绳"))
        self.tools.on_clicked(self.editor.set_tool)

        self.buttons = {}
        specs = (("播放", 0.75, 0.26, self.toggle_pause), ("重置", 0.86, 0.26, self.reset),
                 ("单步", 0.75, 0.20, self.single_step), ("删除", 0.86, 0.20, lambda _: self.editor.delete()),
                 ("下一预设", 0.75, 0.14, self.next_preset),
                 ("保存", 0.75, 0.08, self.save), ("加载", 0.86, 0.08, self.load))
        for label, x, y, callback in specs:
            button = Button(self.fig.add_axes([x, y, 0.10, 0.045]), label)
            button.on_clicked(callback)
            self.buttons[label] = button
        self.buttons["播放"].label.set_text("开始")

        self.g_slider = Slider(self.fig.add_axes([0.14, 0.09, 0.45, 0.035]),
                               "重力加速度 g", 0, 20, valinit=self.scene.g)
        self.drag_slider = Slider(self.fig.add_axes([0.14, 0.035, 0.45, 0.035]),
                                  "空气阻力 k", 0, 2, valinit=self.scene.air_drag)
        self.g_slider.on_changed(self.change_environment)
        self.drag_slider.on_changed(self.change_environment)
        for label, x, callback in (("放大", 0.60, lambda _: self.zoom_view(0.8)),
                                   ("缩小", 0.66, lambda _: self.zoom_view(1.25)),
                                   ("全图", 0.60, self.full_view)):
            button = Button(self.fig.add_axes([x, 0.035 if label == "全图" else 0.09, 0.055, 0.035]), label)
            button.on_clicked(callback)
            self.buttons[label] = button
        self.fig.canvas.mpl_connect("button_press_event", self.on_press)
        self.fig.canvas.mpl_connect("button_release_event", lambda _: self.editor.release())
        self.fig.canvas.mpl_connect("motion_notify_event", self.on_motion)
        self.fig.canvas.mpl_connect("key_press_event", self.on_key)
        self.fig.canvas.mpl_connect("scroll_event", self.on_scroll)
        self.fig.canvas.mpl_connect("button_release_event", self.on_release)

    def set_status(self, text):
        self.status_text.set_text(text)
        self.fig.canvas.draw_idle()

    def redraw(self):
        self.view.update(self.scene, self.editor.selected_id)
        self.state_text.set_text("\n".join(state_lines(self.scene, self.editor.selected)))
        if self.trail and hasattr(self.view, "trajectory"):
            self.view.trajectory.set_data(*zip(*self.trail))
        self.fig.canvas.draw_idle()

    def commit(self, rebuild=True):
        self.initial_scene = deepcopy(self.scene)
        if rebuild:
            self.view.rebuild(self.scene)
        self.redraw()

    def change_environment(self, _=None):
        if not self.paused:
            return
        self.scene.g = self.g_slider.val
        self.scene.air_drag = self.drag_slider.val
        self.commit(rebuild=False)

    def toggle_pause(self, _=None):
        self.paused = not self.paused
        self.buttons["播放"].label.set_text("开始" if self.paused else "暂停")
        self.editor.set_enabled(self.paused)
        self.g_slider.eventson = self.paused
        self.drag_slider.eventson = self.paused
        self.set_status("已暂停，可以编辑" if self.paused else "运行中：属性、删除和环境参数已锁定；视图仍可缩放")

    def single_step(self, _=None):
        if not self.paused:
            return
        self.simulator.step()
        self.record_trail()
        self.redraw()

    def reset(self, _=None):
        self.scene = deepcopy(self.initial_scene)
        self.simulator = Simulator(self.scene)
        self.paused = True
        self.buttons["播放"].label.set_text("开始")
        self.trail = []
        self.editor.pending = None
        self.editor.selected_id = None
        self.editor.build_properties()
        self.editor.set_enabled(True)
        self.g_slider.eventson = True
        self.drag_slider.eventson = True
        self.view.rebuild(self.scene)
        self.set_status("已恢复到编辑后的初始状态")

    def next_preset(self, _=None):
        if not self.paused:
            self.set_status("运行中不能切换预设；请先暂停")
            return
        self.preset_index = (self.preset_index+1) % len(PRESETS)
        name = list(PRESETS)[self.preset_index]
        self.scene = PRESETS[name]()
        self.initial_scene = deepcopy(self.scene)
        self.g_slider.eventson = False
        self.drag_slider.eventson = False
        self.g_slider.set_val(self.scene.g)
        self.drag_slider.set_val(self.scene.air_drag)
        self.g_slider.eventson = True
        self.drag_slider.eventson = True
        self.reset()
        self.initial_scene = deepcopy(self.scene)
        self.set_status(f"已载入预设：{name}，可继续添加器材")

    def save(self, _=None):
        path = Path(__file__).with_name("saved_scene.json")
        save_scene(self.initial_scene, path)
        self.set_status(f"已保存：{path}")

    def load(self, _=None):
        if not self.paused:
            self.set_status("运行中不能加载场景；请先暂停")
            return
        path = Path(__file__).with_name("saved_scene.json")
        try:
            self.scene = load_scene(path)
        except (OSError, ValueError) as exc:
            self.set_status(f"加载失败：{exc}")
            return
        self.initial_scene = deepcopy(self.scene)
        self.reset()
        self.initial_scene = deepcopy(self.scene)
        self.set_status("场景加载成功")

    def record_trail(self):
        selected = self.editor.selected
        from core import Ball
        if isinstance(selected, Ball):
            self.trail.append((selected.x, selected.y))
            if len(self.trail) > 2000:
                self.trail.pop(0)

    def advance(self, _=None):
        if self.paused:
            return
        for _ in range(8):
            self.simulator.step()
        self.record_trail()
        self.redraw()

    def zoom_view(self, factor, center=None):
        xmin, xmax = self.ax.get_xlim()
        ymin, ymax = self.ax.get_ylim()
        cx, cy = center or ((xmin+xmax)/2, (ymin+ymax)/2)
        self.ax.set_xlim(cx+(xmin-cx)*factor, cx+(xmax-cx)*factor)
        self.ax.set_ylim(cy+(ymin-cy)*factor, cy+(ymax-cy)*factor)
        self.fig.canvas.draw_idle()

    def full_view(self, _=None):
        self.ax.set_xlim(0, 10)
        self.ax.set_ylim(0, 6)
        self.fig.canvas.draw_idle()

    def on_scroll(self, event):
        if event.inaxes == self.ax:
            self.zoom_view(0.9 if event.button == "up" else 1.1, (event.xdata, event.ydata))

    def on_press(self, event):
        if event.inaxes == self.ax and event.button == 3:
            self.pan_start = (event.xdata, event.ydata, self.ax.get_xlim(), self.ax.get_ylim())
        elif event.inaxes == self.ax and event.button == 1:
            self.editor.press(event.xdata, event.ydata)

    def on_release(self, _):
        self.pan_start = None

    def on_motion(self, event):
        if self.pan_start and event.inaxes == self.ax and event.xdata is not None:
            x0, y0, xlim, ylim = self.pan_start
            dx, dy = x0-event.xdata, y0-event.ydata
            self.ax.set_xlim(xlim[0]+dx, xlim[1]+dx)
            self.ax.set_ylim(ylim[0]+dy, ylim[1]+dy)
            self.fig.canvas.draw_idle()
        elif event.inaxes == self.ax and event.xdata is not None:
            self.editor.motion(event.xdata, event.ydata)

    def on_key(self, event):
        if event.key == " ":
            self.toggle_pause()
        elif event.key and event.key.lower() == "r":
            self.reset()
        elif event.key == "delete":
            self.editor.delete()
        elif event.key == "escape":
            self.editor.pending = None
            self.editor.set_tool("选择")

    def run(self):
        self.animation = FuncAnimation(self.fig, self.advance, interval=33, cache_frame_data=False)
        plt.show()


if __name__ == "__main__":
    PhysicsLab().run()
