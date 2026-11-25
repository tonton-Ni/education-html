"""版本化 JSON 场景保存、加载和边界校验。"""
import json
import math
from dataclasses import asdict, fields
from pathlib import Path

from core import Ball, Board, Rope, Scene, Spring, Wall


TYPES = {"balls": Ball, "boards": Board, "walls": Wall,
         "springs": Spring, "ropes": Rope}


def save_scene(scene: Scene, path: str | Path) -> None:
    data = {"version": 1, "name": scene.name, "g": scene.g, "air_drag": scene.air_drag}
    data.update({key: [asdict(item) for item in getattr(scene, key)] for key in TYPES})
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_scene(path: str | Path) -> Scene:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("version") != 1:
        raise ValueError("不支持的场景版本")
    scene = Scene(name=str(data.get("name", "我的力学世界")),
                  g=float(data.get("g", 9.8)), air_drag=float(data.get("air_drag", 0)))
    for key, cls in TYPES.items():
        allowed = {f.name for f in fields(cls)}
        for raw in data.get(key, []):
            if not isinstance(raw, dict) or not set(raw) <= allowed:
                raise ValueError(f"{key} 含未知字段")
            setattr(scene, key, [*getattr(scene, key), cls(**raw)])
    validate_scene(scene)
    return scene


def validate_scene(scene: Scene) -> None:
    groups = [scene.balls, scene.boards, scene.walls, scene.springs, scene.ropes]
    ids = [item.id for items in groups for item in items]
    if len(ids) != len(set(ids)):
        raise ValueError("器材 ID 不能重复")
    values = {"g": scene.g, "air_drag": scene.air_drag,
              "objects": [asdict(item) for items in groups for item in items]}

    def check(value):
        if isinstance(value, dict):
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)
        elif isinstance(value, (int, float)) and not math.isfinite(value):
            raise ValueError("参数必须是有限数值")

    check(values)
    for ball in scene.balls:
        if ball.mass <= 0 or ball.radius <= 0:
            raise ValueError("质量和半径必须大于零")
    for board in scene.boards:
        if board.length <= 0 or board.thickness <= 0:
            raise ValueError("木板长度和厚度必须大于零")
    for items in (scene.balls, scene.boards, scene.walls):
        for item in items:
            if not 0 <= item.restitution <= 1 or item.friction < 0:
                raise ValueError("恢复系数应在 0~1，摩擦不能为负")
    ball_ids = {ball.id for ball in scene.balls}
    for spring in scene.springs:
        if spring.ball_id not in ball_ids or spring.stiffness < 0 or spring.rest_length < 0:
            raise ValueError("弹簧参数或连接无效")
    for rope in scene.ropes:
        if rope.ball_id not in ball_ids or rope.length <= 0:
            raise ValueError("绳参数或连接无效")
