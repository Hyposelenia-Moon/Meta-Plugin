#!/usr/bin/env python3
"""record-keys.py — 把按键与单调时钟毫秒录成 RecordingV1（队伍轴编辑器的录制端）

这个脚本只做一件事：把「按键 + 单调时钟毫秒」落成 JSON。它不识别画面、不猜帧、不校验连段；
动作语义由导入端（本仓库的轴编辑器）按键位表解释。

依赖（需自行安装，本仓库不分发）：
    python -m pip install pynput

用法：
    # 先看档位表（与 src/modules/teamSimulation/timeline.ts 的 FRAME_TIERS 保持一致）
    python scripts/record-keys.py --list-tiers

    # 录制：F1 开始（也是起手标记），F2 结束并写文件
    python scripts/record-keys.py \
        --tier fps-60 --game-version 7.1 --keymap-version gs-default-1 \
        --actors itto,gorou,albedo,zhongli --active itto \
        --source record-keys.py@your-name --out out/recording.json

    # 不接键盘、只验证序列化与契约（CI / 无外设环境用）
    python scripts/record-keys.py --selftest

产物（RecordingV1）：
    {
      "schemaVersion": 1,
      "frameTierId": "fps-60",          # 解锁插件里填的帧数档位，脚本不换算
      "keymapVersion": "gs-default-1",
      "events": [{"atMs": 123, "key": "skill", "phase": "down"}, ...],
      "start": {"activeActorId": "itto", "actors": ["itto", ...]},
      "gameVersion": "7.1",
      "source": "record-keys.py@your-name"
    }

硬性约束（导入端会再校验一遍，这里先守住）：
    - 时钟只用 time.monotonic()，不用墙钟；
    - 时间戳在按键回调里立即取，不事后补；
    - 档位 / 键位表版本 / 游戏版本 / 录制者四项缺一即拒；
    - 事件按 atMs 单调不减。
"""

import argparse
import json
import os
import sys
import time

SCHEMA_VERSION = 1

# 与 src/modules/teamSimulation/timeline.ts 的 FRAME_TIERS 手动同步：档位 id -> 标称 fps。
# 脚本不换算帧数，只用来校验档位名与在录制文件里记录；fps 变了要同时改两处。
FRAME_TIERS = {
    "fps-56": 56.31477,
    "fps-60": 60.36144,
    "fps-64": 64.41135,
    "fps-73": 73.5355,
    "fps-104": 105.0891,
    "fps-217": 221.7778,
    "fps-384": 399.1304,
    "fps-625": 665.7423,
}

# 默认键位表（可用 --keymap 覆盖成 JSON：{"j": "normal-1", ...}）。
# key 是导入端用来查动作的键，不是动作 id 本身；动作 id 由数据包定义。
DEFAULT_KEYMAP = {
    "j": "normal-1",
    "k": "charged",
    "e": "skill",
    "q": "burst",
    "1": "switch:1",
    "2": "switch:2",
    "3": "switch:3",
    "4": "switch:4",
}

START_KEY = "\x01"  # 逻辑哨兵：F1
STOP_KEY = "\x02"   # 逻辑哨兵：F2


class Recorder:
    """纯逻辑：不碰键盘，只负责时钟、事件表与输出。selftest 也复用它。"""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._t0 = None
        self.events = []

    def start(self):
        if self._t0 is not None:
            raise RuntimeError("录制已经开始")
        self._t0 = self._clock()

    @property
    def started(self):
        return self._t0 is not None

    def elapse_ms(self):
        if self._t0 is None:
            raise RuntimeError("还没开始录制（先按 F1）")
        return int(round((self._clock() - self._t0) * 1000))

    def feed(self, key, phase):
        """phase: 'down' | 'up'；时间戳取当刻。"""
        if phase not in ("down", "up"):
            raise ValueError(f"未知 phase: {phase!r}")
        at = self.elapse_ms()
        if self.events and at < self.events[-1]["atMs"]:
            raise RuntimeError("时钟倒退：本脚本只接受单调时钟")
        self.events.append({"atMs": at, "key": key, "phase": phase})
        return at


def build_document(args, events, started_at_known=True):
    if not args.tier:
        raise SystemExit("拒绝：--tier 必填（用 --list-tiers 查看合法值）")
    if args.tier not in FRAME_TIERS:
        raise SystemExit(f"拒绝：未知档位 {args.tier!r}，合法值：{', '.join(FRAME_TIERS)}")
    for name in ("game_version", "keymap_version", "source"):
        if not getattr(args, name):
            raise SystemExit(f"拒绝：--{name.replace('_', '-')} 必填（缺了就无法复现，也无法判断是哪版键位表）")
    actors = [a.strip() for a in (args.actors or "").split(",") if a.strip()]
    if not actors:
        raise SystemExit("拒绝：--actors 必填（逗号分隔的角色 id，按队伍顺序）")
    if args.active not in actors:
        raise SystemExit(f"拒绝：--active {args.active!r} 不在 --actors 里")
    if not events:
        raise SystemExit("拒绝：没有录到任何事件")
    if not any(e["phase"] == "down" for e in events):
        raise SystemExit("拒绝：没有按下事件，这条录制解释不出任何动作")
    if events != sorted(events, key=lambda e: e["atMs"]):
        raise SystemExit("拒绝：事件时间戳不是单调不减")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "frameTierId": args.tier,
        "keymapVersion": args.keymap_version,
        "events": events,
        "start": {"activeActorId": args.active, "actors": actors},
        "gameVersion": args.game_version,
        "source": args.source,
    }


def cmd_list_tiers(_args):
    for tier, fps in FRAME_TIERS.items():
        print(f"{tier}\t{fps:>10.5f} fps")
    return 0


def cmd_selftest(args):
    """不接键盘：用假时钟喂一段事件，验证序列化与契约。"""
    fake = {"t": 1000.0}

    def clock():
        return fake["t"]

    rec = Recorder(clock=clock)
    rec.start()
    for key, phase, dt in [
        ("e", "down", 0.120), ("e", "up", 0.180),
        ("1", "down", 0.500), ("1", "up", 0.560),
        ("j", "down", 0.900), ("j", "up", 0.940),
    ]:
        fake["t"] += dt
        rec.feed(key, phase)
    doc = build_document(args, rec.events)
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    assert doc["schemaVersion"] == 1
    assert doc["start"]["actors"] == ["itto", "gorou", "albedo", "zhongli"]
    assert [e["atMs"] for e in doc["events"]] == sorted(e["atMs"] for e in doc["events"])
    assert doc["events"][0] == {"atMs": 120, "key": "e", "phase": "down"}, doc["events"][0]
    if not args.out:
        print(text)
    else:
        write_out(args.out, text)
        print(f"selftest ok -> {args.out}")
    return 0


def cmd_record(args):
    try:
        from pynput import keyboard  # noqa: PLC0415 —— 只在真录制时才需要，selftest 不该被依赖拖住
    except ImportError:
        raise SystemExit("缺少 pynput：先执行 `python -m pip install pynput`（本仓库不代装依赖）")

    keymap = dict(DEFAULT_KEYMAP)
    if args.keymap:
        with open(args.keymap, "r", encoding="utf-8") as fh:
            keymap.update(json.load(fh))

    rec = Recorder()
    state = {"stop": False}

    def handle(key, phase):
        ch = getattr(key, "char", None)
        if ch in keymap:
            if not rec.started:
                print("提示：还没按 F1 开始，本次按键忽略", file=sys.stderr)
                return None
            return rec.feed(keymap[ch], phase)
        return None

    def on_press(key):
        if key == keyboard.Key.f1 and not rec.started:
            rec.start()
            print("录制中：F2 结束", file=sys.stderr)
            return None
        if key == keyboard.Key.f2:
            state["stop"] = True
            return False
        return handle(key, "down")

    def on_release(key):
        if key in (keyboard.Key.f1, keyboard.Key.f2):
            return None
        return handle(key, "up")

    with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
        listener.join()

    doc = build_document(args, rec.events)
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    write_out(args.out, text)
    downs = sum(1 for e in doc["events"] if e["phase"] == "down")
    print(f"已写入 {args.out}：{len(doc['events'])} 个事件（{downs} 次按下），窗口 {doc['events'][-1]['atMs']} ms", file=sys.stderr)
    return 0


def write_out(path, text):
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text + "\n")


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="把按键与单调时钟毫秒录成 RecordingV1（队伍轴编辑器的录制端）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--tier", help="帧率档位 id（--list-tiers 查看）")
    parser.add_argument("--game-version", dest="game_version", help="游戏版本，如 7.1")
    parser.add_argument("--keymap-version", dest="keymap_version", help="键位表版本，如 gs-default-1")
    parser.add_argument("--source", help="录制者标识，格式 <脚本名>@<录制者>")
    parser.add_argument("--actors", default="itto,gorou,albedo,zhongli", help="队伍角色 id，逗号分隔")
    parser.add_argument("--active", default="itto", help="录制开始时前台角色 id")
    parser.add_argument("--out", default="out/recording.json", help="输出路径")
    parser.add_argument("--keymap", help="自定义键位表 JSON（键 -> 动作键）")
    parser.add_argument("--list-tiers", action="store_true", help="列出可用帧率档位")
    parser.add_argument("--selftest", action="store_true", help="不接键盘，验证序列化与契约")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if args.list_tiers:
        return cmd_list_tiers(args)
    if args.selftest:
        return cmd_selftest(args)
    return cmd_record(args)


if __name__ == "__main__":
    sys.exit(main())
