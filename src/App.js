// 导入当前目录下的样式文件 `App.css`，在 React 项目中引入 CSS 会让这些样式作用于该组件及其子元素。
import './App.css';

// 从 'react' 包导入 React（这是必须的，尤其是在使用 JSX 的文件里）。
import React, { useState, useRef, useEffect } from 'react';

// 从 react-leaflet 包导入需要的组件：MapContainer（地图容器）、TileLayer（地图底图）、Marker（标记）、Popup（弹出信息框）、Polyline（折线）。
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";

// 导入 leaflet 的 CSS，这样 Leaflet 的默认样式（例如控件、弹窗样式）才会生效。
import 'leaflet/dist/leaflet.css';

// 导入 Leaflet 的 JS 库到变量 L。如果需要使用 Leaflet 原生 API（例如创建自定义图标），可以通过 L 来访问。
import L from 'leaflet';

// 导入自定义的 NodeList 组件
import NodeList from './NodeList';

// 导入矢量图标资源
import groundStationIconUrl from './assets/icons/ground-station.svg';
import uavIconUrl from './assets/icons/uav.svg';
import groundUserIconUrl from './assets/icons/ground-user.svg';
import satelliteIconUrl from './assets/icons/satellite.svg';

const NODE_TYPE_META = {
  'ground-station': { label: '地面基站', color: '#1f78b4', icon: groundStationIconUrl },
  uav: { label: '无人机', color: '#f28e2b', icon: uavIconUrl },
  'ground-user': { label: '地面用户', color: '#59a14f', icon: groundUserIconUrl },
  satellite: { label: '卫星', color: '#9467bd', icon: satelliteIconUrl },
};

const ICON_CACHE = {};

function createLeafletIcon(meta) {
  return L.icon({
    iconUrl: meta.icon,
    iconSize: meta.iconSize || [44, 44],
    iconAnchor: meta.iconAnchor || [22, 38],
    popupAnchor: meta.popupAnchor || [0, -28],
    className: 'network-node-icon',
  });
}

function createFallbackIcon() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="#7f7f7f" stroke="#ffffff" stroke-width="2"/><text x="18" y="22" text-anchor="middle" font-size="14" font-family="Arial, sans-serif" fill="#ffffff">节</text></svg>';
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [36, 36],
    iconAnchor: [18, 30],
    popupAnchor: [0, -22],
    className: 'network-node-icon',
  });
}

const DEFAULT_NODE_ICON = createFallbackIcon();

function getIconForType(type) {
  const meta = NODE_TYPE_META[type];
  if (!meta) {
    return DEFAULT_NODE_ICON;
  }
  if (!ICON_CACHE[type]) {
    ICON_CACHE[type] = createLeafletIcon(meta);
  }
  return ICON_CACHE[type];
}

// 定义一个名为 App 的函数组件，这是 React 推荐的一种写组件的方法（函数组件）。
function App() {
  // 以下是组件内部的普通 JavaScript：定义节点数据（数组），每个节点包含 id、name、position（经纬度数组）、layer（网络层级）。
  const nodes = [
    { id: 1, name: "地面基站 A", position: [39.9, 116.4], type: 'ground-station', layer: 'backbone' },
    { id: 2, name: "无人机中继 B", position: [39.91, 116.42], type: 'uav', layer: 'air' },
    { id: 3, name: "地面用户 C", position: [39.92, 116.43], type: 'ground-user', layer: 'access' },
    { id: 4, name: "无人机中继 D", position: [39.915, 116.45], type: 'uav', layer: 'air' },
    { id: 5, name: "地面基站 E", position: [39.905, 116.41], type: 'ground-station', layer: 'backbone' },
    { id: 6, name: "卫星中继 F", position: [39.93, 116.4], type: 'satellite', layer: 'space' },
  ];

  // 链路数据：这里用简单的 from/to 经纬度对表示两端位置，实际项目中通常用节点 id 关联节点对象。
  const links = [
    { from: [39.9, 116.4], to: [39.91, 116.42] },
    { from: [39.91, 116.42], to: [39.92, 116.43] },
  ];

  // 组件的返回值是 JSX（看起来像 HTML，但可以在 JavaScript 中使用），它描述了组件的 UI。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id || null);

  const markerRefs = useRef({});

  const mapRef = useRef(null);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  function SelectedNodeController({ node }) {
    const map = useMap();

    useEffect(() => {
      mapRef.current = map;
    }, [map]);

    useEffect(() => {
      if (!node) {
        return;
      }

      const marker = markerRefs.current[node.id];
      const currentZoom = map.getZoom ? map.getZoom() : 13;
      const targetZoom = Math.max(currentZoom, 15);

      map.flyTo(node.position, targetZoom, {
        duration: 0.8,
        easeLinearity: 0.25,
      });

      let cleanupTimer = null;
      const openPopup = () => {
        const activeMarker = markerRefs.current[node.id];
        if (activeMarker) {
          activeMarker.openPopup();
          activeMarker.setZIndexOffset(1000);
        }
      };

      if (marker) {
        cleanupTimer = setTimeout(openPopup, 400);
      } else {
        cleanupTimer = setTimeout(openPopup, 500);
      }

      return () => {
        if (cleanupTimer) {
          clearTimeout(cleanupTimer);
        }
        const activeMarker = markerRefs.current[node.id];
        if (activeMarker) {
          activeMarker.setZIndexOffset(0);
        }
      };
    }, [map, node]);

    return null;
  }

  return (
    // 外层容器采用深色渐变背景与整体仪表盘布局
    <div className="App bg-gradient-to-br from-deep-navy via-[#0d1f3c] to-[#030915] text-slate-100">
      <div
        className={`flex flex-col transition-all duration-300 ease-out border-r border-white/10 backdrop-blur-lg bg-white/10 shadow-soft-glow flex-shrink-0 ${sidebarCollapsed ? 'w-20' : 'w-80'}`}
      >
        <NodeList
          nodes={nodes}
          collapsed={sidebarCollapsed}
          onToggle={(v) => setSidebarCollapsed(!!v)}
          typeMeta={NODE_TYPE_META}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
        />
      </div>

      <div className="flex flex-1 flex-col gap-6 p-6">
        <header className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/10 px-6 py-4 backdrop-blur-xl shadow-soft-glow">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-aurora-green/80">Aerial-Ground Network</p>
            <h2 className="mt-2 text-2xl font-semibold text-aurora-green">网络态势可视化系统（原型）</h2>
          </div>
        </header>

        {/* MapContainer：react-leaflet 提供的地图容器组件
            - center：地图中心点，数组 [纬度, 经度]
            - zoom：初始缩放级别
            - className：用于绑定 CSS 样式（例如设置高度、宽度）
        */}
        <MapContainer
          center={[39.9, 116.4]}
          zoom={13}
          className="h-[calc(100vh-220px)] min-h-[420px] w-full overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md shadow-soft-glow"
        >
          <SelectedNodeController node={selectedNode} />
          {/* TileLayer：地图瓦片图层（底图），这里使用 OpenStreetMap 的公共瓦片服务 */}
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap 贡献者"
          />

          {/* 使用 JavaScript 的 map 方法遍历 nodes 数组，为每个节点渲染一个 Marker（标记） */}
          {nodes.map((node) => {
            const typeMeta = NODE_TYPE_META[node.type] || { label: node.type || '未知节点', color: '#7f7f7f' };
            return (
              // Marker 组件显示在地图上的一个点。React 要求列表中元素有唯一的 key，这里使用 node.id。
              <Marker
                key={node.id}
                position={node.position}
                icon={getIconForType(node.type)}
                ref={(marker) => {
                  if (marker) {
                    markerRefs.current[node.id] = marker;
                  } else {
                    delete markerRefs.current[node.id];
                  }
                }}
              >
                {/* Popup 是 Marker 的子组件，用于显示当点击或打开时的弹窗内容 */}
                <Popup>
                  {/* 在 Popup 中显示节点名称和层级信息。JSX 中花括号 {} 用于插入 JavaScript 表达式或变量 */}
                  <strong>{node.name}</strong>
                  <br />
                  类型：{typeMeta.label}
                  <br />
                  网络层级：{node.layer}
                </Popup>
              </Marker>
            );
          })}

          {/* 绘制链路：遍历 links 数组，为每条链路渲染一个 Polyline（折线）
              - positions 接受一个包含经纬度对的数组，这里传入 [from, to]
              - color：线颜色；weight：线宽
          */}
          {links.map((link, index) => (
            <Polyline
              key={index}
              positions={[link.from, link.to]}
              pathOptions={{ color: '#5ef7c1', weight: 2, opacity: 0.8 }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

// 导出 App 组件作为默认导出，其他文件可以通过 `import App from './App'` 引入它。
export default App;
