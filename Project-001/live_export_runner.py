import argparse
import json
import random
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from three_layer_network import Link, Node, ThreeLayerNetwork, build_sample_network


EVENT_FILE_MAP = {
    "node_update": "event_node_update.json",
    "link_update": "event_link_update.json",
    "node_add": "event_node_add.json",
    "node_remove": "event_node_remove.json",
    "link_add": "event_link_add.json",
    "link_remove": "event_link_remove.json",
}
SUPPORTED_COMMAND_TYPES = {"node:add", "node:remove", "node:update"}


def _pick_random_link_endpoints(net: ThreeLayerNetwork) -> Optional[Tuple[str, str]]:
    if not net.links:
        return None
    return random.choice(list(net.links.keys()))


def _pick_random_node_id(net: ThreeLayerNetwork) -> Optional[str]:
    if not net.nodes:
        return None
    return random.choice(list(net.nodes.keys()))


def _random_node_update(net: ThreeLayerNetwork) -> Optional[dict]:
    node_id = _pick_random_node_id(net)
    if not node_id:
        return None

    next_state = random.choices(
        population=["online", "busy", "offline", "error"],
        weights=[0.55, 0.25, 0.15, 0.05],
        k=1,
    )[0]
    next_energy = round(random.uniform(20.0, 100.0), 2)
    next_cpu = round(random.uniform(0.05, 0.95), 3)
    next_load = round(random.uniform(0.05, 0.95), 3)

    return net.event_node_update(
        node_id=node_id,
        state=next_state,
        energy=next_energy,
        cpu=next_cpu,
        load=next_load,
    )


def _random_link_update(net: ThreeLayerNetwork) -> Optional[dict]:
    endpoints = _pick_random_link_endpoints(net)
    if not endpoints:
        return None

    u, v = endpoints
    next_state = random.choices(
        population=["up", "unstable", "down"],
        weights=[0.72, 0.22, 0.06],
        k=1,
    )[0]

    return net.event_link_update(
        u=u,
        v=v,
        delay=round(random.uniform(5.0, 90.0), 2),
        loss=round(random.uniform(0.0, 0.1), 4),
        snr=round(random.uniform(8.0, 30.0), 2),
        utilization=round(random.uniform(0.05, 0.95), 3),
        state=next_state,
    )


def _add_dynamic_terminal(
    net: ThreeLayerNetwork, dynamic_counter: int, attach_node_id: str
) -> Tuple[dict, Optional[dict], str]:
    new_node_id = f"U-LIVE-{dynamic_counter:03d}"
    lat = round(random.uniform(34.20, 34.31), 6)
    lng = round(random.uniform(108.90, 109.08), 6)

    new_node = Node(
        node_id=new_node_id,
        layer="access",
        location=(lat, lng),
        capacity=50.0,
        energy=round(random.uniform(45.0, 95.0), 2),
        name=f"Live-Terminal-{dynamic_counter}",
        node_type="terminal",
        role="user",
        cpu=round(random.uniform(0.05, 0.35), 3),
        load=round(random.uniform(0.08, 0.4), 3),
    )
    node_event = net.event_node_add(new_node)

    link_event = None
    if net.has_node(attach_node_id):
        link_event = net.event_link_add(
            Link(
                src=attach_node_id,
                dst=new_node_id,
                bandwidth=20.0,
                delay=round(random.uniform(6.0, 16.0), 2),
                loss=round(random.uniform(0.01, 0.06), 4),
                link_type="wireless",
                snr=round(random.uniform(12.0, 24.0), 2),
                utilization=round(random.uniform(0.1, 0.7), 3),
            )
        )

    return node_event, link_event, new_node_id


def _remove_dynamic_terminal(
    net: ThreeLayerNetwork, node_id: str, attach_node_id: str
) -> Tuple[Optional[dict], Optional[dict]]:
    link_event = None
    node_event = None

    if net.has_node(node_id) and net.has_node(attach_node_id) and net.has_link(attach_node_id, node_id):
        link_event = net.event_link_remove(attach_node_id, node_id)

    if net.has_node(node_id):
        node_event = net.event_node_remove(node_id)

    return node_event, link_event


def _coerce_float(value: object, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _normalize_layer(raw_layer: object) -> str:
    layer = str(raw_layer or "access").strip().lower().replace("_", "-")
    if layer == "mesh":
        return "adhoc"
    if layer == "edge":
        return "access"
    if layer in {"backbone", "adhoc", "access", "terminal"}:
        return layer
    return "access"


def _normalize_node_type(raw_type: object) -> str:
    node_type = str(raw_type or "terminal").strip().lower().replace("-", "_")
    if node_type == "mesh_node":
        return "adhoc_node"
    if node_type == "base_station":
        return "base_station"
    if node_type in {"router", "terminal", "satellite", "adhoc_node"}:
        return node_type
    return "terminal"


def _normalize_status_for_python(raw_status: object) -> str:
    status = str(raw_status or "").strip().lower()
    if status in {"online", "normal", "up"}:
        return "online"
    if status in {"busy", "warning", "degraded"}:
        return "busy"
    if status in {"offline", "down"}:
        return "offline"
    if status in {"error", "danger", "critical"}:
        return "error"
    return "online"


def _load_queue_offset(offset_file_path: Path) -> int:
    if not offset_file_path.exists():
        return 0
    try:
        raw_text = offset_file_path.read_text(encoding="utf-8").strip()
        return max(0, int(raw_text or "0"))
    except (ValueError, OSError):
        return 0


def _save_queue_offset(offset_file_path: Path, offset: int) -> None:
    offset_file_path.write_text(str(max(0, offset)), encoding="utf-8")


def _read_new_commands(queue_file_path: Path, offset: int) -> Tuple[List[dict], int]:
    if not queue_file_path.exists():
        return [], offset

    with queue_file_path.open("rb") as handle:
        file_size = handle.seek(0, 2)
        safe_offset = min(max(0, offset), file_size)
        handle.seek(safe_offset)
        raw_lines = handle.readlines()
        next_offset = handle.tell()

    commands: List[dict] = []
    for raw_line in raw_lines:
        line = raw_line.decode("utf-8", errors="ignore").strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(command, dict):
            commands.append(command)
    return commands, next_offset


def _build_node_from_command_payload(payload: dict) -> Node:
    raw_node = payload.get("node") if isinstance(payload.get("node"), dict) else payload
    node_id = str(raw_node.get("id") or "").strip()
    if not node_id:
        raise ValueError("node:add requires node id")

    geo = raw_node.get("location", {}).get("geo", {}) if isinstance(raw_node.get("location"), dict) else {}
    lat = _coerce_float(raw_node.get("lat", geo.get("lat", 34.25)), 34.25)
    lng = _coerce_float(raw_node.get("lng", geo.get("lng", 108.95)), 108.95)

    raw_state = raw_node.get("state")
    if isinstance(raw_state, dict):
        raw_status = raw_state.get("status")
        raw_online = raw_state.get("online")
    else:
        raw_status = raw_state
        raw_online = None

    status = _normalize_status_for_python(raw_status)
    online = bool(raw_online) if isinstance(raw_online, bool) else status != "offline"
    if not online:
        status = "offline"

    return Node(
        node_id=node_id,
        layer=_normalize_layer(raw_node.get("layer")),
        location=(lat, lng),
        state=status,
        capacity=_coerce_float(raw_node.get("capacity", 50.0), 50.0),
        energy=_coerce_float(raw_node.get("energy", 80.0), 80.0),
        name=str(raw_node.get("name") or node_id),
        node_type=_normalize_node_type(raw_node.get("type") or raw_node.get("node_type")),
        role=str(raw_node.get("role") or "user"),
        online=online,
        cpu=_coerce_float(raw_node.get("cpu", 0.2), 0.2),
        load=_coerce_float(raw_node.get("load", 0.3), 0.3),
        cache=_coerce_float(raw_node.get("cache", 0.0), 0.0),
    )


def _apply_command(
    net: ThreeLayerNetwork, command: dict, latest_events: Dict[str, Optional[dict]]
) -> Optional[str]:
    command_type = str(command.get("type") or "").strip()
    if command_type not in SUPPORTED_COMMAND_TYPES:
        return None

    payload = command.get("payload")
    if not isinstance(payload, dict):
        return None

    if command_type == "node:add":
        node = _build_node_from_command_payload(payload)
        if net.has_node(node.node_id):
            raise ValueError(f"node {node.node_id} already exists")
        latest_events["node_add"] = net.event_node_add(node)
        return f"node:add:{node.node_id}"

    if command_type == "node:remove":
        node_id = str(payload.get("nodeId") or payload.get("id") or "").strip()
        if not node_id:
            raise ValueError("node:remove requires nodeId")
        if not net.has_node(node_id):
            raise ValueError(f"node {node_id} does not exist")
        latest_events["node_remove"] = net.event_node_remove(node_id)
        return f"node:remove:{node_id}"

    if command_type == "node:update":
        node_id = str(payload.get("nodeId") or payload.get("id") or "").strip()
        if not node_id:
            raise ValueError("node:update requires nodeId")
        if not net.has_node(node_id):
            raise ValueError(f"node {node_id} does not exist")

        status = payload.get("status")
        changes = {
            "state": _normalize_status_for_python(status) if status is not None else None,
            "energy": _coerce_float(payload.get("energy"), 0.0) if payload.get("energy") is not None else None,
            "cpu": _coerce_float(payload.get("cpu"), 0.0) if payload.get("cpu") is not None else None,
            "load": _coerce_float(payload.get("load"), 0.0) if payload.get("load") is not None else None,
            "online": payload.get("online") if isinstance(payload.get("online"), bool) else None,
        }
        latest_events["node_update"] = net.event_node_update(
            node_id=node_id,
            **changes,
        )
        return f"node:update:{node_id}"

    return None


def _save_exports(
    net: ThreeLayerNetwork, output_dir: Path, latest_events: Dict[str, Optional[dict]]
) -> None:
    snapshot = net.export_snapshot()
    metrics = net.export_metrics()
    net.save_json(snapshot, str(output_dir / "snapshot.json"))
    net.save_json(metrics, str(output_dir / "metrics.json"))

    for event_key, file_name in EVENT_FILE_MAP.items():
        payload = latest_events.get(event_key)
        if payload is not None:
            net.save_json(payload, str(output_dir / file_name))


def run_live_export(interval_seconds: float, iterations: int, output_dir: Path) -> None:
    net = build_sample_network()
    output_dir.mkdir(parents=True, exist_ok=True)
    queue_file_path = output_dir / "command_queue.jsonl"
    queue_offset_path = output_dir / "command_queue.offset"
    queue_offset = _load_queue_offset(queue_offset_path)

    latest_events: Dict[str, Optional[dict]] = {key: None for key in EVENT_FILE_MAP}
    dynamic_node_id: Optional[str] = None
    dynamic_counter = 1
    attach_node_id = "A5" if net.has_node("A5") else "A1"

    _save_exports(net, output_dir, latest_events)
    print(
        f"[live-export] initialized, nodes={len(net.nodes)}, links={len(net.links)}, output={output_dir}"
    )
    print(f"[live-export] command queue: {queue_file_path}")

    loop_index = 0
    while iterations <= 0 or loop_index < iterations:
        loop_index += 1

        latest_events["node_update"] = _random_node_update(net)
        latest_events["link_update"] = _random_link_update(net)

        if loop_index % 6 == 0 and dynamic_node_id:
            node_event, link_event = _remove_dynamic_terminal(net, dynamic_node_id, attach_node_id)
            latest_events["node_remove"] = node_event
            if link_event is not None:
                latest_events["link_remove"] = link_event
            dynamic_node_id = None
        elif loop_index % 3 == 0 and dynamic_node_id is None:
            node_event, link_event, new_node_id = _add_dynamic_terminal(
                net, dynamic_counter=dynamic_counter, attach_node_id=attach_node_id
            )
            latest_events["node_add"] = node_event
            if link_event is not None:
                latest_events["link_add"] = link_event
            dynamic_node_id = new_node_id
            dynamic_counter += 1

        commands, queue_offset = _read_new_commands(queue_file_path, queue_offset)
        _save_queue_offset(queue_offset_path, queue_offset)
        for command in commands:
            command_id = command.get("id", "UNKNOWN")
            command_type = command.get("type", "UNKNOWN")
            try:
                apply_result = _apply_command(net, command, latest_events)
                if apply_result:
                    print(f"[live-export] applied command {command_id} ({command_type}) -> {apply_result}")
                else:
                    print(f"[live-export] ignored command {command_id} ({command_type})")
            except Exception as error:
                print(f"[live-export] failed command {command_id} ({command_type}): {error}")

        _save_exports(net, output_dir, latest_events)
        print(f"[live-export] tick={loop_index}, nodes={len(net.nodes)}, links={len(net.links)}")
        time.sleep(interval_seconds)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Continuously export Python topology/events/metrics JSON for frontend polling."
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=3.0,
        help="Export interval in seconds (default: 3.0).",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=0,
        help="Number of ticks to run. 0 means run forever (default: 0).",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(Path(__file__).resolve().parent),
        help="Directory used to write snapshot/metrics/event files.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Optional random seed for deterministic demo output.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.seed is not None:
        random.seed(args.seed)

    try:
        run_live_export(
            interval_seconds=max(0.5, float(args.interval)),
            iterations=int(args.iterations),
            output_dir=Path(args.output_dir).resolve(),
        )
    except KeyboardInterrupt:
        print("[live-export] stopped by user")
