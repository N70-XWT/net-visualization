// import 语句用于从其他模块或文件导入变量、函数、组件等。
// 这里把同目录下的 logo.svg 导入为变量 `logo`（虽然当前代码没有使用它）。
import logo from './logo.svg';

// 导入当前目录下的样式文件 `App.css`，在 React 项目中引入 CSS 会让这些样式作用于该组件及其子元素。
import './App.css';

// 从 'react' 包导入 React（这是必须的，尤其是在使用 JSX 的文件里）。
import React, { useState } from 'react';

// 从 react-leaflet 包导入需要的组件：MapContainer（地图容器）、TileLayer（地图底图）、Marker（标记）、Popup（弹出信息框）、Polyline（折线）。
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";

// 导入 leaflet 的 CSS，这样 Leaflet 的默认样式（例如控件、弹窗样式）才会生效。
import 'leaflet/dist/leaflet.css';

// 导入 Leaflet 的 JS 库到变量 L。如果需要使用 Leaflet 原生 API（例如创建自定义图标），可以通过 L 来访问。
import L from 'leaflet';

// 导入自定义的 NodeList 组件
import NodeList from './NodeList';

// 定义一个名为 App 的函数组件，这是 React 推荐的一种写组件的方法（函数组件）。
function App() {
  // 以下是组件内部的普通 JavaScript：定义节点数据（数组），每个节点包含 id、name、position（经纬度数组）、layer（网络层级）。
  const nodes = [
    { id: 1, name: "骨干节点 A", position: [39.9, 116.4], layer: "backbone" },
    { id: 2, name: "自组节点 B", position: [39.91, 116.42], layer: "ad-hoc" },
    { id: 3, name: "接入节点 C", position: [39.92, 116.43], layer: "access" },
  ];

  // 链路数据：这里用简单的 from/to 经纬度对表示两端位置，实际项目中通常用节点 id 关联节点对象。
  const links = [
    { from: [39.9, 116.4], to: [39.91, 116.42] },
    { from: [39.91, 116.42], to: [39.92, 116.43] },
  ];

  // 组件的返回值是 JSX（看起来像 HTML，但可以在 JavaScript 中使用），它描述了组件的 UI。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    // 外层 div 使用 className `App`，并在内部横向布局：左侧侧栏、右侧内容
    <div className="App">
      <div className={"sidebar" + (sidebarCollapsed ? ' collapsed' : '')}>
        <div className="node-list-root">
          <NodeList
            nodes={nodes}
            collapsed={sidebarCollapsed}
            onToggle={(v) => setSidebarCollapsed(!!v)}
          />
        </div>
      </div>

      <div className="content">
        {/* 标题放在右侧内容区域 */}
        <h2 style={{ margin: '6px 0' }}>网络态势可视化系统（原型）</h2>

        {/* MapContainer：react-leaflet 提供的地图容器组件
            - center：地图中心点，数组 [纬度, 经度]
            - zoom：初始缩放级别
            - className：用于绑定 CSS 样式（例如设置高度、宽度）
        */}
        <MapContainer center={[39.9, 116.4]} zoom={13} className="map">
        {/* TileLayer：地图瓦片图层（底图），这里使用 OpenStreetMap 的公共瓦片服务 */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap 贡献者"
        />

        {/* 使用 JavaScript 的 map 方法遍历 nodes 数组，为每个节点渲染一个 Marker（标记） */}
        {nodes.map((node) => (
          // Marker 组件显示在地图上的一个点。React 要求列表中元素有唯一的 key，这里使用 node.id。
          <Marker key={node.id} position={node.position}>
            {/* Popup 是 Marker 的子组件，用于显示当点击或打开时的弹窗内容 */}
            <Popup>
              {/* 在 Popup 中显示节点名称和层级信息。JSX 中花括号 {} 用于插入 JavaScript 表达式或变量 */}
              <strong>{node.name}</strong>
              <br />
              网络层级：{node.layer}
            </Popup>
          </Marker>
        ))}

        {/* 绘制链路：遍历 links 数组，为每条链路渲染一个 Polyline（折线）
            - positions 接受一个包含经纬度对的数组，这里传入 [from, to]
            - color：线颜色；weight：线宽
        */}
        {links.map((link, index) => (
          <Polyline
            key={index}
            positions={[link.from, link.to]}
            color="blue"
            weight={2}
          />
        ))}
        </MapContainer>
      </div>
    </div>
  );
}

// 导出 App 组件作为默认导出，其他文件可以通过 `import App from './App'` 引入它。
export default App;
