import math
import tempfile
import unittest
from pathlib import Path

from collisions import board_contact
from core import Ball, Board, Rope, Scene, Spring, Wall
from experiments import board_demo
from forces import spring_force
from scene_io import load_scene, save_scene, validate_scene
from simulation import Simulator


class PhysicsTests(unittest.TestCase):
    def test_free_fall_matches_formula(self):
        scene = Scene(g=9.8, balls=[Ball(2, 5)])
        sim = Simulator(scene, dt=1/10000)
        for _ in range(5000):
            sim.step()
        self.assertAlmostEqual(scene.balls[0].y, 5-0.5*9.8*0.5**2, delta=0.002)

    def test_inelastic_ground(self):
        scene = Scene(balls=[Ball(2, 0.5, vy=-1, restitution=0)])
        sim = Simulator(scene)
        scene.walls.append(Wall(0, 0, 10, 0, restitution=0))
        for _ in range(120):
            sim.step()
        self.assertAlmostEqual(scene.balls[0].y, scene.balls[0].radius, delta=0.002)
        self.assertGreaterEqual(scene.balls[0].vy, 0)

    def test_elastic_equal_mass_collision(self):
        a, b = Ball(2, 2, vx=1, restitution=1, friction=0), Ball(2.45, 2, vx=-1, restitution=1, friction=0)
        sim = Simulator(Scene(g=0, balls=[a, b]))
        for _ in range(20):
            sim.step()
        self.assertLess(a.vx, 0)
        self.assertGreater(b.vx, 0)
        self.assertAlmostEqual(a.vx+b.vx, 0, delta=1e-8)

    def test_board_rotation_and_inside_collision(self):
        ball = Ball(0, 0, radius=0.2)
        contact = board_contact(ball, Board(0, 0, length=4, thickness=0.2))
        self.assertIsNotNone(contact)
        self.assertGreater(contact.penetration, 0.2)
        vertical = board_contact(Ball(0.15, 0), Board(0, 0, length=4, thickness=0.2, angle=math.pi/2))
        self.assertIsNotNone(vertical)

    def test_board_slide_and_leave(self):
        scene = board_demo()
        sim = Simulator(scene)
        for _ in range(720):
            sim.step()
        ball = scene.balls[0]
        self.assertGreater(ball.x, 6.6)
        self.assertLess(ball.y, 2)

    def test_high_friction_holds_ball(self):
        board = Board(3, 2, length=4, angle=0.2, friction=1)
        x = 3
        y = board.y + board.thickness/2/math.cos(board.angle) + 0.25/math.cos(board.angle)
        ball = Ball(x, y, radius=0.25, friction=1)
        sim = Simulator(Scene(balls=[ball], boards=[board]))
        for _ in range(120):
            sim.step()
        self.assertAlmostEqual(ball.x, x, delta=0.03)

    def test_spring_direction_and_equilibrium_length(self):
        ball = Ball(3, 0)
        spring = Spring(ball.id, 0, 0, stiffness=10, rest_length=2, damping=0)
        self.assertEqual(spring_force(spring, Ball(2, 0)), (0, 0))
        fx, fy = spring_force(spring, ball)
        self.assertEqual((fx, fy), (-10, 0))

    def test_rope_slack_and_taut(self):
        ball = Ball(1, 0)
        scene = Scene(g=0, balls=[ball], ropes=[Rope(ball.id, 0, 0, length=2)])
        Simulator(scene).step()
        self.assertEqual((ball.x, ball.y), (1, 0))
        ball.x, ball.vx = 2.1, 1
        Simulator(scene).step()
        self.assertLessEqual(math.hypot(ball.x, ball.y), 2.01)
        self.assertLessEqual(ball.vx, 0.01)

    def test_json_roundtrip_and_validation(self):
        scene = board_demo()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"scene.json"
            save_scene(scene, path)
            loaded = load_scene(path)
            self.assertEqual(len(loaded.balls), 1)
            self.assertEqual(loaded.boards[0].length, 5)
        scene.balls[0].mass = -1
        with self.assertRaises(ValueError):
            validate_scene(scene)

    def test_state_inspection(self):
        from inspection import ball_noncontact_force, state_lines
        ball = Ball(2, 3, vx=4)
        scene = Scene(balls=[ball])
        self.assertEqual(ball_noncontact_force(scene, ball), (0, -9.8))
        text = "\n".join(state_lines(scene, ball))
        self.assertIn("速度: 4.000", text)
        self.assertIn("力矩", text)
        spring = Spring(ball.id, 2, 5, rest_length=2)
        scene.springs.append(spring)
        self.assertIn("依赖", "\n".join(state_lines(scene, spring)))

    def test_delete_ball_cascades(self):
        ball = Ball(1, 1)
        scene = Scene(balls=[ball], springs=[Spring(ball.id, 0, 0)], ropes=[Rope(ball.id, 0, 0)])
        scene.remove(ball.id)
        self.assertFalse(scene.springs)
        self.assertFalse(scene.ropes)


class UITests(unittest.TestCase):
    def test_editor_and_controls(self):
        import matplotlib
        matplotlib.use("Agg")
        from main import PhysicsLab
        app = PhysicsLab()
        app.editor.set_tool("添加球")
        app.editor.press(8, 5)
        self.assertEqual(len(app.scene.balls), 2)
        app.editor.set_tool("添加弹簧")
        app.editor.press(8, 5)
        app.editor.press(8, 5.8)
        self.assertEqual(len(app.scene.springs), 1)
        app.editor.change_property("stiffness", "30")
        self.assertEqual(app.scene.springs[0].stiffness, 30)
        app.single_step()
        self.assertGreater(app.simulator.time, 0)
        app.reset()
        self.assertEqual(app.simulator.time, 0)
        app.editor.set_tool("选择")
        app.editor.press(8, 5)
        app.editor.delete()
        self.assertEqual(len(app.scene.springs), 0)
        app.next_preset()
        self.assertEqual(len(app.scene.balls), 1)

    def test_running_lock_and_view_controls(self):
        import matplotlib
        matplotlib.use("Agg")
        from main import PhysicsLab
        app = PhysicsLab()
        app.editor.set_tool("选择")
        app.editor.press(1.55, 2.97)
        ball_count = len(app.scene.balls)
        old_mass = app.editor.selected.mass
        app.toggle_pause()
        self.assertTrue(all(not box.active for box in app.editor.property_boxes))
        app.editor.change_property("mass", "99")
        self.assertEqual(app.editor.selected.mass, old_mass)
        app.editor.delete()
        self.assertEqual(len(app.scene.balls), ball_count)
        before = app.ax.get_xlim()
        app.zoom_view(0.5)
        self.assertNotEqual(app.ax.get_xlim(), before)
        app.full_view()
        self.assertEqual(app.ax.get_xlim(), (0, 10))
        app.toggle_pause()
        self.assertTrue(all(box.active for box in app.editor.property_boxes))
        app.editor.change_property("mass", "2")
        self.assertEqual(app.editor.selected.mass, 2)


if __name__ == "__main__":
    unittest.main()
