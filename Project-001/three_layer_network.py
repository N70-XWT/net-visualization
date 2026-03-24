from dataclasses import dataclass, asdict
from typing import Dict, List, Tuple, Optional, Any
import heapq
import json
import time


# =========================
# 1. 定义节点和链路数据结构
# =========================

@dataclass
class Node:
    node_id: str
    layer: str          # backbone / adhoc / access / terminal
    location: Tuple[float, float]

    state: str = "online"       # online / busy / offline / error
    capacity: float = 100.0
    energy: float = 100.0

    # 额外字段：用于态势分析与前端展示
    name: str = ""
    node_type: str = "generic"  # router / base_station / adhoc_node / terminal / satellite
    online: bool = True
    cpu: float = 0.0            # 0~1
    load: float = 0.0           # 0~1
    cache: float = 0.0
    role: str = "edge"          # core / relay / edge / user
    alarm_level: str = "normal" # normal / warning / danger
    last_update: int = 0        # ms timestamp


@dataclass
class Link:
    src: str
    dst: str
    bandwidth: float    # Mbps
    delay: float        # ms
    loss: float         # 0~1
    link_type: str = "wireless"   # wired / wireless

    # 额外字段：用于态势分析与前端展示
    snr: float = 20.0
    utilization: float = 0.0      # 0~1
    health: str = "good"          # good / warning / danger
    state: str = "up"             # up / down / unstable
    last_update: int = 0          # ms timestamp


# =========================
# 2. 三层网络图结构
# =========================

class ThreeLayerNetwork:
    def __init__(self, topology_id: str = "network-demo-001", version: int = 1):
        # 节点字典：node_id -> Node
        self.nodes: Dict[str, Node] = {}

        # 邻接表：node_id -> [neighbor1, neighbor2, ...]
        self.adj: Dict[str, List[str]] = {}

        # 链路字典：key=(min_id,max_id) -> Link
        # 无向图存法，避免重复
        self.links: Dict[Tuple[str, str], Link] = {}

        # 导出数据时的元信息
        self.topology_id = topology_id
        self.version = version

    # ---------- 工具函数 ----------
    def _edge_key(self, u: str, v: str) -> Tuple[str, str]:
        return tuple(sorted((u, v)))

    def _link_id(self, u: str, v: str) -> str:
        a, b = sorted((u, v))
        return f"L-{a}-{b}"

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def has_node(self, node_id: str) -> bool:
        return node_id in self.nodes

    def has_link(self, u: str, v: str) -> bool:
        return self._edge_key(u, v) in self.links

    # ---------- 节点/链路健康推断 ----------
    def _infer_node_alarm(self, node: Node) -> str:
        if node.state in ("offline", "error") or not node.online:
            return "danger"
        if node.energy < 20 or node.cpu > 0.85 or node.load > 0.85:
            return "warning"
        return "normal"

    def _infer_link_health(self, link: Link) -> str:
        if link.state == "down":
            return "danger"
        if link.loss > 0.08 or link.delay > 60 or link.snr < 10:
            return "danger"
        if link.loss > 0.03 or link.delay > 25 or link.snr < 18:
            return "warning"
        return "good"

    # ---------- 节点操作 ----------
    def add_node(self, node: Node) -> None:
        if node.node_id in self.nodes:
            raise ValueError(f"节点 {node.node_id} 已存在")

        if not node.name:
            node.name = node.node_id
        if node.last_update == 0:
            node.last_update = self._now_ms()

        # 同步在线状态
        if node.state == "offline":
            node.online = False

        node.alarm_level = self._infer_node_alarm(node)

        self.nodes[node.node_id] = node
        self.adj[node.node_id] = []

    def remove_node(self, node_id: str) -> None:
        if node_id not in self.nodes:
            raise ValueError(f"节点 {node_id} 不存在")

        # 删除与该节点相关的所有链路
        neighbors = self.adj[node_id].copy()
        for nb in neighbors:
            self.remove_link(node_id, nb)

        # 删除节点本身
        del self.nodes[node_id]
        del self.adj[node_id]

    def update_node_state(
        self,
        node_id: str,
        state: Optional[str] = None,
        capacity: Optional[float] = None,
        energy: Optional[float] = None,
        online: Optional[bool] = None,
        cpu: Optional[float] = None,
        load: Optional[float] = None,
        cache: Optional[float] = None,
        name: Optional[str] = None,
        node_type: Optional[str] = None,
        role: Optional[str] = None,
        location: Optional[Tuple[float, float]] = None,
    ) -> None:
        if node_id not in self.nodes:
            raise ValueError(f"节点 {node_id} 不存在")

        node = self.nodes[node_id]

        if state is not None:
            node.state = state
        if capacity is not None:
            node.capacity = capacity
        if energy is not None:
            node.energy = energy
        if online is not None:
            node.online = online
        if cpu is not None:
            node.cpu = cpu
        if load is not None:
            node.load = load
        if cache is not None:
            node.cache = cache
        if name is not None:
            node.name = name
        if node_type is not None:
            node.node_type = node_type
        if role is not None:
            node.role = role
        if location is not None:
            node.location = location

        # 同步状态
        if node.state == "offline":
            node.online = False
        elif online is None:
            node.online = True

        node.last_update = self._now_ms()
        node.alarm_level = self._infer_node_alarm(node)

    # ---------- 链路操作 ----------
    def add_link(self, link: Link) -> None:
        u, v = link.src, link.dst

        if u not in self.nodes or v not in self.nodes:
            raise ValueError("链路两端节点必须都已存在")

        key = self._edge_key(u, v)
        if key in self.links:
            raise ValueError(f"链路 {u} - {v} 已存在")

        if link.last_update == 0:
            link.last_update = self._now_ms()
        link.health = self._infer_link_health(link)

        self.links[key] = link
        self.adj[u].append(v)
        self.adj[v].append(u)

    def remove_link(self, u: str, v: str) -> None:
        key = self._edge_key(u, v)
        if key not in self.links:
            raise ValueError(f"链路 {u} - {v} 不存在")

        del self.links[key]
        if v in self.adj[u]:
            self.adj[u].remove(v)
        if u in self.adj[v]:
            self.adj[v].remove(u)

    def update_link(
        self,
        u: str,
        v: str,
        bandwidth: Optional[float] = None,
        delay: Optional[float] = None,
        loss: Optional[float] = None,
        snr: Optional[float] = None,
        utilization: Optional[float] = None,
        state: Optional[str] = None,
        link_type: Optional[str] = None,
    ) -> None:
        key = self._edge_key(u, v)
        if key not in self.links:
            raise ValueError(f"链路 {u} - {v} 不存在")

        link = self.links[key]
        if bandwidth is not None:
            link.bandwidth = bandwidth
        if delay is not None:
            link.delay = delay
        if loss is not None:
            link.loss = loss
        if snr is not None:
            link.snr = snr
        if utilization is not None:
            link.utilization = utilization
        if state is not None:
            link.state = state
        if link_type is not None:
            link.link_type = link_type

        link.last_update = self._now_ms()
        link.health = self._infer_link_health(link)

    # ---------- 查询功能 ----------
    def get_neighbors(self, node_id: str) -> List[str]:
        if node_id not in self.adj:
            raise ValueError(f"节点 {node_id} 不存在")
        return self.adj[node_id][:]

    def degree(self, node_id: str) -> int:
        return len(self.get_neighbors(node_id))

    def get_link(self, u: str, v: str) -> Link:
        key = self._edge_key(u, v)
        if key not in self.links:
            raise ValueError(f"链路 {u} - {v} 不存在")
        return self.links[key]

    def adjacency_table(self) -> Dict[str, List[str]]:
        return {k: v[:] for k, v in self.adj.items()}

    # ---------- 连通性 ----------
    def is_connected(self) -> bool:
        if not self.nodes:
            return True

        start = next(iter(self.nodes))
        visited = set()
        stack = [start]

        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            for nb in self.adj[cur]:
                if nb not in visited:
                    stack.append(nb)

        return len(visited) == len(self.nodes)

    # ---------- 最短路径 ----------
    # 这里用“时延 delay”作为边权
    def shortest_path(self, start: str, end: str) -> Tuple[float, List[str]]:
        if start not in self.nodes or end not in self.nodes:
            raise ValueError("起点或终点不存在")

        dist = {node_id: float("inf") for node_id in self.nodes}
        prev = {node_id: None for node_id in self.nodes}
        dist[start] = 0.0

        pq = [(0.0, start)]

        while pq:
            cur_dist, u = heapq.heappop(pq)

            if cur_dist > dist[u]:
                continue

            if u == end:
                break

            for v in self.adj[u]:
                link = self.get_link(u, v)

                # 如果链路断了，则不参与路径计算
                if link.state == "down":
                    continue

                weight = link.delay
                new_dist = dist[u] + weight

                if new_dist < dist[v]:
                    dist[v] = new_dist
                    prev[v] = u
                    heapq.heappush(pq, (new_dist, v))

        if dist[end] == float("inf"):
            return float("inf"), []

        # 还原路径
        path = []
        cur = end
        while cur is not None:
            path.append(cur)
            cur = prev[cur]
        path.reverse()

        return dist[end], path

    # ---------- 基础指标 ----------
    def compute_metrics(self) -> Dict[str, Any]:
        node_count = len(self.nodes)
        link_count = len(self.links)

        if node_count == 0:
            return {
                "networkHealth": 0.0,
                "onlineRate": 0.0,
                "avgDelay": 0.0,
                "avgLoss": 0.0,
                "avgLoad": 0.0,
                "connected": True,
                "nodeCount": 0,
                "linkCount": 0
            }

        online_count = sum(1 for n in self.nodes.values() if n.online)
        online_rate = online_count / node_count

        avg_load = sum(n.load for n in self.nodes.values()) / node_count

        if link_count > 0:
            avg_delay = sum(l.delay for l in self.links.values()) / link_count
            avg_loss = sum(l.loss for l in self.links.values()) / link_count
        else:
            avg_delay = 0.0
            avg_loss = 0.0

        connected = self.is_connected()

        delay_norm = min(avg_delay / 100.0, 1.0)
        loss_norm = min(max(avg_loss, 0.0), 1.0)
        load_norm = min(max(avg_load, 0.0), 1.0)
        conn_score = 1.0 if connected else 0.0

        network_health = (
            0.30 * online_rate +
            0.20 * (1.0 - delay_norm) +
            0.20 * (1.0 - loss_norm) +
            0.20 * (1.0 - load_norm) +
            0.10 * conn_score
        )

        network_health = round(max(0.0, min(network_health, 1.0)), 4)

        return {
            "networkHealth": network_health,
            "onlineRate": round(online_rate, 4),
            "avgDelay": round(avg_delay, 4),
            "avgLoss": round(avg_loss, 4),
            "avgLoad": round(avg_load, 4),
            "connected": connected,
            "nodeCount": node_count,
            "linkCount": link_count
        }

    # ---------- 导出为原始字典 ----------
    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": [asdict(node) for node in self.nodes.values()],
            "links": [asdict(link) for link in self.links.values()]
        }

    # ---------- 导出节点/链路（兼容当前前端字段） ----------
    def export_node(self, node: Node) -> Dict[str, Any]:
        return {
            "id": node.node_id,
            "name": node.name if node.name else node.node_id,
            "type": node.node_type,
            "layer": node.layer,
            "location": {
                "geo": {
                    "lat": node.location[0],
                    "lng": node.location[1],
                    "altitude": 0
                }
            },
            "state": {
                "online": node.online,
                "status": node.state,
                "lastSeen": node.last_update
            },
            "metrics": {
                "cpu": node.cpu,
                "load": node.load,
                "cache": node.cache,
                "energy": node.energy,
                "capacity": node.capacity
            },
            "role": node.role,
            "alarmLevel": node.alarm_level
        }

    def export_link(self, link: Link) -> Dict[str, Any]:
        return {
            "id": self._link_id(link.src, link.dst),
            "from": link.src,
            "to": link.dst,
            "type": link.link_type,
            "bandwidthMbps": link.bandwidth,
            "utilization": link.utilization,
            "delayMs": link.delay,
            "lossRate": link.loss,
            "snrDb": link.snr,
            "health": link.health,
            "state": link.state,
            "lastUpdate": link.last_update
        }

    # ---------- 导出快照（给前端/后端调用） ----------
    def export_snapshot(self) -> Dict[str, Any]:
        return {
            "timestamp": self._now_ms(),
            "nodes": [self.export_node(node) for node in self.nodes.values()],
            "links": [self.export_link(link) for link in self.links.values()],
            "metrics": self.compute_metrics()
        }

    # ---------- 导出基础指标 ----------
    def export_metrics(self) -> Dict[str, Any]:
        return self.compute_metrics()

    # ---------- 导出事件数据（仅算法层，不含网络通信） ----------
    def export_event(self, event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "timestamp": self._now_ms(),
            "eventType": event_type,
            "payload": payload
        }

    # ---------- 事件接口：节点 ----------
    def event_node_add(self, node: Node) -> Dict[str, Any]:
        self.add_node(node)
        return self.export_event("NODE_ADD", {
            "node": self.export_node(node)
        })

    def event_node_remove(self, node_id: str) -> Dict[str, Any]:
        self.remove_node(node_id)
        return self.export_event("NODE_REMOVE", {
            "nodeId": node_id
        })

    def event_node_update(self, node_id: str, **changes: Any) -> Dict[str, Any]:
        self.update_node_state(node_id, **changes)
        node = self.nodes[node_id]

        event_changes = {
            "state": {
                "online": node.online,
                "status": node.state,
                "lastSeen": node.last_update
            },
            "metrics": {
                "cpu": node.cpu,
                "load": node.load,
                "cache": node.cache,
                "energy": node.energy,
                "capacity": node.capacity
            },
            "alarmLevel": node.alarm_level
        }

        return self.export_event("NODE_UPDATE", {
            "nodeId": node_id,
            "changes": event_changes
        })

    # ---------- 事件接口：链路 ----------
    def event_link_add(self, link: Link) -> Dict[str, Any]:
        self.add_link(link)
        return self.export_event("LINK_ADD", {
            "link": self.export_link(link)
        })

    def event_link_remove(self, u: str, v: str) -> Dict[str, Any]:
        link_id = self._link_id(u, v)
        self.remove_link(u, v)
        return self.export_event("LINK_REMOVE", {
            "linkId": link_id,
            "from": u,
            "to": v
        })

    def event_link_update(self, u: str, v: str, **changes: Any) -> Dict[str, Any]:
        self.update_link(u, v, **changes)
        link = self.get_link(u, v)

        event_changes = {
            "bandwidthMbps": link.bandwidth,
            "utilization": link.utilization,
            "delayMs": link.delay,
            "lossRate": link.loss,
            "snrDb": link.snr,
            "health": link.health,
            "state": link.state,
            "lastUpdate": link.last_update
        }

        return self.export_event("LINK_UPDATE", {
            "linkId": self._link_id(u, v),
            "from": u,
            "to": v,
            "changes": event_changes
        })

    # ---------- 导出 JSON 字符串 ----------
    def to_json_str(self, data: Dict[str, Any]) -> str:
        return json.dumps(data, ensure_ascii=False, indent=2)

    # ---------- 保存 JSON 文件 ----------
    def save_json(self, data: Dict[str, Any], file_path: str) -> None:
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # ---------- 打印摘要 ----------
    def summary(self) -> None:
        print("========== 网络摘要 ==========")
        print(f"节点数: {len(self.nodes)}")
        print(f"链路数: {len(self.links)}")
        print(f"是否连通: {self.is_connected()}")
        print("\n各节点度：")
        for node_id in self.nodes:
            print(f"  {node_id}: {self.degree(node_id)}")
        print("==============================")


# =========================
# 3. 构建三层网络样例
# =========================

def build_sample_network() -> ThreeLayerNetwork:
    net = ThreeLayerNetwork()

    # ---- 1) 添加骨干网节点 ----
    backbone_nodes = [
        Node("B1", "backbone", (34.20, 108.90), capacity=500, energy=100,
             name="Backbone-1", node_type="router", role="core", cpu=0.32, load=0.41),
        Node("B2", "backbone", (34.25, 108.98), capacity=500, energy=100,
             name="Backbone-2", node_type="router", role="core", cpu=0.28, load=0.35),
        Node("B3", "backbone", (34.30, 109.05), capacity=500, energy=100,
             name="Backbone-3", node_type="satellite", role="core", cpu=0.22, load=0.30),
    ]

    # ---- 2) 添加自组网节点 ----
    adhoc_nodes = [
        Node("A1", "adhoc", (34.21, 108.91), capacity=200, energy=90,
             name="Adhoc-1", node_type="adhoc_node", role="relay", cpu=0.45, load=0.52),
        Node("A2", "adhoc", (34.23, 108.95), capacity=200, energy=85,
             name="Adhoc-2", node_type="adhoc_node", role="relay", cpu=0.50, load=0.57),
        Node("A3", "adhoc", (34.26, 108.99), capacity=200, energy=88,
             name="Adhoc-3", node_type="adhoc_node", role="relay", cpu=0.46, load=0.49),
        Node("A4", "adhoc", (34.28, 109.02), capacity=200, energy=80,
             name="Adhoc-4", node_type="adhoc_node", role="relay", cpu=0.55, load=0.60),
        Node("A5", "adhoc", (34.29, 109.06), capacity=200, energy=78,
             name="Adhoc-5", node_type="adhoc_node", role="relay", cpu=0.58, load=0.63),
    ]

    # ---- 3) 添加接入网节点 ----
    access_nodes = [
        Node("U1", "access", (34.211, 108.912), capacity=50, energy=70,
             name="Terminal-1", node_type="terminal", role="user", cpu=0.10, load=0.20),
        Node("U2", "access", (34.212, 108.914), capacity=50, energy=68,
             name="Terminal-2", node_type="terminal", role="user", cpu=0.11, load=0.22),
        Node("U3", "access", (34.231, 108.951), capacity=50, energy=72,
             name="Terminal-3", node_type="terminal", role="user", cpu=0.09, load=0.18),
        Node("U4", "access", (34.232, 108.952), capacity=50, energy=66,
             name="Terminal-4", node_type="terminal", role="user", cpu=0.13, load=0.25),
        Node("U5", "access", (34.261, 108.991), capacity=50, energy=75,
             name="Terminal-5", node_type="terminal", role="user", cpu=0.08, load=0.17),
        Node("U6", "access", (34.262, 108.993), capacity=50, energy=74,
             name="Terminal-6", node_type="terminal", role="user", cpu=0.09, load=0.16),
        Node("U7", "access", (34.281, 109.021), capacity=50, energy=69,
             name="Terminal-7", node_type="terminal", role="user", cpu=0.10, load=0.21),
        Node("U8", "access", (34.282, 109.023), capacity=50, energy=65,
             name="Terminal-8", node_type="terminal", role="user", cpu=0.14, load=0.26),
        Node("U9", "access", (34.291, 109.061), capacity=50, energy=64,
             name="Terminal-9", node_type="terminal", role="user", cpu=0.13, load=0.24),
        Node("U10", "access", (34.292, 109.062), capacity=50, energy=63,
             name="Terminal-10", node_type="terminal", role="user", cpu=0.15, load=0.27),
    ]

    for node in backbone_nodes + adhoc_nodes + access_nodes:
        net.add_node(node)

    # ---- 4) 添加骨干网内部链路 ----
    backbone_links = [
        Link("B1", "B2", bandwidth=1000, delay=5, loss=0.001, link_type="wired",
             snr=30, utilization=0.35),
        Link("B2", "B3", bandwidth=1000, delay=5, loss=0.001, link_type="wired",
             snr=30, utilization=0.33),
        Link("B1", "B3", bandwidth=800, delay=8, loss=0.002, link_type="wired",
             snr=28, utilization=0.40),
    ]

    # ---- 5) 添加骨干网和自组网跨层链路 ----
    cross_links_1 = [
        Link("B1", "A1", bandwidth=100, delay=15, loss=0.01, link_type="wireless",
             snr=24, utilization=0.46),
        Link("B1", "A2", bandwidth=100, delay=18, loss=0.01, link_type="wireless",
             snr=22, utilization=0.44),
        Link("B2", "A3", bandwidth=100, delay=15, loss=0.01, link_type="wireless",
             snr=23, utilization=0.45),
        Link("B3", "A4", bandwidth=100, delay=16, loss=0.01, link_type="wireless",
             snr=21, utilization=0.49),
        Link("B3", "A5", bandwidth=100, delay=20, loss=0.02, link_type="wireless",
             snr=19, utilization=0.54),
    ]

    # ---- 6) 添加自组网内部链路 ----
    adhoc_links = [
        Link("A1", "A2", bandwidth=50, delay=10, loss=0.02, link_type="wireless",
             snr=21, utilization=0.52),
        Link("A2", "A3", bandwidth=50, delay=12, loss=0.03, link_type="wireless",
             snr=19, utilization=0.56),
        Link("A3", "A4", bandwidth=50, delay=10, loss=0.02, link_type="wireless",
             snr=20, utilization=0.50),
        Link("A4", "A5", bandwidth=50, delay=9, loss=0.02, link_type="wireless",
             snr=20, utilization=0.53),
    ]

    # ---- 7) 添加接入网到自组网的跨层链路 ----
    cross_links_2 = [
        Link("A1", "U1", bandwidth=20, delay=6, loss=0.03, snr=18, utilization=0.22),
        Link("A1", "U2", bandwidth=20, delay=6, loss=0.03, snr=18, utilization=0.24),
        Link("A2", "U3", bandwidth=20, delay=7, loss=0.03, snr=17, utilization=0.20),
        Link("A2", "U4", bandwidth=20, delay=7, loss=0.03, snr=17, utilization=0.25),
        Link("A3", "U5", bandwidth=20, delay=6, loss=0.03, snr=18, utilization=0.21),
        Link("A3", "U6", bandwidth=20, delay=6, loss=0.03, snr=18, utilization=0.19),
        Link("A4", "U7", bandwidth=20, delay=7, loss=0.03, snr=17, utilization=0.23),
        Link("A4", "U8", bandwidth=20, delay=7, loss=0.03, snr=16, utilization=0.27),
        Link("A5", "U9", bandwidth=20, delay=8, loss=0.04, snr=15, utilization=0.28),
        Link("A5", "U10", bandwidth=20, delay=8, loss=0.04, snr=15, utilization=0.30),
    ]

    for link in backbone_links + cross_links_1 + adhoc_links + cross_links_2:
        net.add_link(link)

    return net


# =========================
# 4. 测试运行
# =========================

if __name__ == "__main__":
    net = build_sample_network()

    # 打印摘要
    net.summary()

    # 打印邻接表
    print("\n邻接表：")
    for node_id, neighbors in net.adjacency_table().items():
        print(f"{node_id}: {neighbors}")

    # 查看最短路径（按时延）
    dist, path = net.shortest_path("B1", "U10")
    print("\n从 B1 到 U10 的最短路径（按时延）:")
    print("路径:", " -> ".join(path))
    print("总代价(时延):", dist, "ms")

    # 模拟一个简单操作
    print("\n把 A3 节点状态改为 busy，能量改为 60，cpu改为0.62，load改为0.71")
    net.update_node_state("A3", state="busy", energy=60, cpu=0.62, load=0.71)
    print(net.nodes["A3"])

    print("\n把 A2 - A3 链路时延改为 30ms，利用率改为0.56")
    net.update_link("A2", "A3", delay=30, utilization=0.56)
    print(net.get_link("A2", "A3"))

    print("\n导出原始字典：")
    raw_data = net.to_dict()
    print("nodes条数:", len(raw_data["nodes"]))
    print("links条数:", len(raw_data["links"]))

    print("\n导出当前前端兼容 snapshot：")
    snapshot = net.export_snapshot()
    print(net.to_json_str(snapshot))

    print("\n导出 metrics：")
    metrics_data = net.export_metrics()
    print(net.to_json_str(metrics_data))

    print("\n演示 NODE_UPDATE 事件：")
    event1 = net.event_node_update("A4", state="busy", energy=55, cpu=0.66, load=0.72)
    print(net.to_json_str(event1))

    print("\n演示 LINK_UPDATE 事件：")
    event2 = net.event_link_update("A4", "U8", delay=20, loss=0.06, snr=12, utilization=0.61)
    print(net.to_json_str(event2))

    print("\n演示 NODE_ADD 事件：")
    new_node = Node(
        "U11", "access", (34.295, 109.063),
        capacity=50, energy=62,
        name="Terminal-11", node_type="terminal", role="user", cpu=0.12, load=0.21
    )
    event3 = net.event_node_add(new_node)
    print(net.to_json_str(event3))

    print("\n演示 LINK_ADD 事件：")
    new_link = Link("A5", "U11", bandwidth=20, delay=8, loss=0.04, snr=16, utilization=0.35)
    event4 = net.event_link_add(new_link)
    print(net.to_json_str(event4))

    print("\n演示 NODE_REMOVE 事件：")
    event5 = net.event_node_remove("U11")
    print(net.to_json_str(event5))

    # 保存 JSON 文件，方便联调
    net.save_json(snapshot, "snapshot.json")
    net.save_json(metrics_data, "metrics.json")
    net.save_json(event1, "event_node_update.json")
    net.save_json(event2, "event_link_update.json")

    print("\n已导出文件：snapshot.json, metrics.json, event_node_update.json, event_link_update.json")