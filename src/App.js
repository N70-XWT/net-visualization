// 导入当前目录下的样式文件 `App.css`，在 React 项目中引入 CSS 会让这些样式作用于该组件及其子元素。
import './App.css';

// 从 'react' 包导入 React（这是必须的，尤其是在使用 JSX 的文件里）。
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

// 从 react-leaflet 包导入需要的组件：MapContainer（地图容器）、TileLayer（地图底图）、Marker（标记）、Popup（弹出信息框）、Polyline（折线）。
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";

// 导入 leaflet 的 CSS，这样 Leaflet 的默认样式（例如控件、弹窗样式）才会生效。
import 'leaflet/dist/leaflet.css';

// 导入 Leaflet 的 JS 库到变量 L。如果需要使用 Leaflet 原生 API（例如创建自定义图标），可以通过 L 来访问。
import L from 'leaflet';

// 导入自定义的 NodeList 组件
import NodeList from './NodeList';
import Map3DView from './Map3DView';

import { topology } from './services/topologyModel';
import { buildInitialNodeState } from './services/mockNodeStream';
import { useWebSocketTopology } from './hooks/useWebSocketTopology';

// 导入矢量图标资源
import groundStationIconUrl from './assets/icons/ground-station.svg';
import uavIconUrl from './assets/icons/uav.svg';
import groundUserIconUrl from './assets/icons/ground-user.svg';
import satelliteIconUrl from './assets/icons/satellite.svg';

const NODE_TYPE_META = {
  router: { label: '路由器', color: '#1f78b4', icon: groundStationIconUrl },
  'base-station': { label: '基站', color: '#f28e2b', icon: groundStationIconUrl },
  'mesh-node': { label: '自组网节点', color: '#59a14f', icon: uavIconUrl },
  terminal: { label: '终端', color: '#9467bd', icon: groundUserIconUrl },
  satellite: { label: '卫星', color: '#7f7f7f', icon: satelliteIconUrl },
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

function buildNodeMap(nodes) {
  return nodes.reduce((acc, node) => {
    acc[node.id] = node;
    return acc;
  }, {});
}

function getNodePosition(node) {
  if (!node || !node.location || !node.location.geo) {
    return null;
  }
  return [node.location.geo.lat, node.location.geo.lng];
}

function getNodeGeo(node) {
  return node?.location?.geo || null;
}

function getAltitudeLiftPx(altitude) {
  const safeAltitude = Number.isFinite(altitude) ? Math.max(0, altitude) : 0;
  // 对数压缩高度量级，避免卫星高度造成视觉失真。
  const normalized = Math.min(1, Math.log10(safeAltitude + 10) / 6);
  return Math.round(normalized * 42);
}

function buildLinkArcPositions(fromPosition, toPosition, fromAltitude, toAltitude, is3dMode) {
  if (!is3dMode) {
    return [fromPosition, toPosition];
  }

  const averageLift = (getAltitudeLiftPx(fromAltitude) + getAltitudeLiftPx(toAltitude)) / 2;
  const arcOffset = Math.min(0.0016, averageLift / 65000);
  const midLat = (fromPosition[0] + toPosition[0]) / 2 + arcOffset;
  const midLng = (fromPosition[1] + toPosition[1]) / 2;

  return [fromPosition, [midLat, midLng], toPosition];
}

function getLinkStyle(link) {
  if (link.type === 'wired') {
    return { color: '#36c2ff', weight: 2.4, opacity: 0.85, dashArray: '4 6' };
  }
  if (link.type === 'wireless') {
    return { color: '#5ef7c1', weight: 2, opacity: 0.8 };
  }
  return { color: '#9aa4b2', weight: 2, opacity: 0.7 };
}

function getLinkHealthColor(link) {
  const lossRate = typeof link.lossRate === 'number' ? link.lossRate : null;
  const snrDb = typeof link.snrDb === 'number' ? link.snrDb : null;

  const isCriticalLoss = lossRate !== null && lossRate >= 0.03;
  const isWarningLoss = lossRate !== null && lossRate >= 0.015;
  const isCriticalSnr = snrDb !== null && snrDb < 10;
  const isWarningSnr = snrDb !== null && snrDb < 18;

  if (isCriticalLoss || isCriticalSnr) {
    return '#f95d5d';
  }
  if (isWarningLoss || isWarningSnr) {
    return '#f4c84a';
  }
  return '#35f29a';
}

function getLinkFlowSpeedClass(link) {
  const utilization = typeof link.utilization === 'number' ? link.utilization : null;
  const delayMs = typeof link.delayMs === 'number' ? link.delayMs : null;

  if (utilization !== null) {
    if (utilization >= 0.75) {
      return 'link-flow--fast';
    }
    if (utilization >= 0.4) {
      return 'link-flow--medium';
    }
    return 'link-flow--slow';
  }

  if (delayMs !== null) {
    if (delayMs <= 10) {
      return 'link-flow--fast';
    }
    if (delayMs <= 20) {
      return 'link-flow--medium';
    }
    return 'link-flow--slow';
  }

  return 'link-flow--medium';
}

// 节点 Popup 内容组件，支持刷新按钮
function NodePopupContent({ node, typeMeta, nodeStateRef }) {
  const [refreshCount, setRefreshCount] = useState(0);

  const handleRefresh = () => {
    setRefreshCount((prev) => prev + 1);
  };

  const getDynState = () => nodeStateRef.current[node.id];

  return (
    <div className="text-sm text-slate-900">
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold text-slate-900">{node.name}</div>
        <button
          onClick={handleRefresh}
          className="ml-2 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          title="刷新数据"
        >
          🔄
        </button>
      </div>
      <div className="mt-2 space-y-1 text-slate-800">
        <div>节点 ID：{node.id}</div>
        <div>节点类型：{typeMeta.label}</div>
        <div>层级：{node.layer || '-'}</div>
        <div>
          状态：
          {(() => {
            const dynState = getDynState();
            const online = dynState?.state?.online ?? node.state?.online;
            const status = dynState?.state?.status ?? node.state?.status ?? '-';
            return `${online ? '在线' : '离线'} (${status})`;
          })()}
        </div>
        <div>
          时间戳：
          {(() => {
            const dynState = getDynState();
            const ts = dynState?.timestamp || node.state?.lastSeen || '-';
            // 刷新计数变化时会重新渲染，从而获取最新时间戳
            return `${ts}${refreshCount > 0 ? '' : ''}`;
          })()}
        </div>
        <div>
          位置：
          {(() => {
            const dynState = getDynState();
            const geo = dynState?.location?.geo || node.location?.geo;
            if (!geo) return '-';
            return `${geo.lat?.toFixed(5) ?? '-'}, ${geo.lng?.toFixed(5) ?? '-'}`;
          })()}
        </div>
        <div>
          高度：
          {(() => {
            const dynState = getDynState();
            const geo = dynState?.location?.geo || node.location?.geo;
            return geo?.altitude ?? '-';
          })()}
        </div>
      </div>
    </div>
  );
}

function App() {
  const baseNodes = useMemo(() => topology.nodes, []);
  const links = topology.links;

  // 使用 useRef 保存 Marker 实例字典，避免关联任何 React 状态
  const markerRefsById = useRef({});
  // 使用 useRef 保存链路 Polyline 实例字典，用于实时位置更新
  const linkPolylineRefsById = useRef({});
  // 使用 useRef 保存动态节点状态，仅供查询，不触发重渲染
  const nodeStateRef = useRef(buildInitialNodeState(baseNodes));

  const mapRef = useRef(null);
  const nodeMapRef = useRef(buildNodeMap(baseNodes));

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(baseNodes[0]?.id || null);
  const [focusRequestId, setFocusRequestId] = useState(null);
  const [mapViewMode, setMapViewMode] = useState('2d');

  const getDynamicNodeGeo = useCallback((nodeId) => {
    const dynGeo = nodeStateRef.current[nodeId]?.location?.geo;
    if (dynGeo) {
      return dynGeo;
    }
    return getNodeGeo(nodeMapRef.current[nodeId]);
  }, []);

  const getDynamicNodePosition = useCallback((nodeId) => {
    const geo = getDynamicNodeGeo(nodeId);
    if (!geo) {
      return null;
    }
    return [geo.lat, geo.lng];
  }, [getDynamicNodeGeo]);

  const getDynamicNodeAltitude = useCallback((nodeId) => {
    return getDynamicNodeGeo(nodeId)?.altitude ?? 0;
  }, [getDynamicNodeGeo]);

  const applyMarkerAltitudeVisual = useCallback((marker, nodeId) => {
    if (!marker) {
      return;
    }

    const markerElement = marker.getElement?.();
    if (!markerElement) {
      return;
    }

    const altitude = getDynamicNodeAltitude(nodeId);
    const liftPx = mapViewMode === '3d' ? getAltitudeLiftPx(altitude) : 0;
    markerElement.style.marginTop = `${-liftPx}px`;

    const selectedBoost = selectedNodeId === nodeId ? 220 : 0;
    marker.setZIndexOffset(liftPx + selectedBoost);
  }, [getDynamicNodeAltitude, mapViewMode, selectedNodeId]);

  useEffect(() => {
    nodeMapRef.current = buildNodeMap(baseNodes);
  }, [baseNodes]);

  // 直接更新 Marker 位置和图标，无需触发 React 重渲染
  const handleUpdateNodeStates = useCallback((updates) => {
    const currentState = nodeStateRef.current;
    updates.forEach((update) => {
      const previous = currentState[update.id] || {};
      const nextState = {
        ...previous,
        ...update,
        location: update.location || previous.location,
        state: update.state || previous.state,
      };
      currentState[update.id] = nextState;

      const marker = markerRefsById.current[update.id];
      if (!marker) {
        return;
      }

      if (update.location?.geo) {
        const latLng = [update.location.geo.lat, update.location.geo.lng];
        marker.setLatLng(latLng);
      }

      if (update.state?.online !== undefined) {
        const baseNode = baseNodes.find((n) => n.id === update.id);
        if (baseNode) {
          marker.setIcon(getIconForType(baseNode.type));
        }
      }

      applyMarkerAltitudeVisual(marker, update.id);
    });

    links.forEach((link) => {
      const polylineRefs = linkPolylineRefsById.current[link.id];
      if (!polylineRefs) {
        return;
      }

      const fromPosition = getDynamicNodePosition(link.from);
      const toPosition = getDynamicNodePosition(link.to);
      if (!fromPosition || !toPosition) {
        return;
      }

      const linkPositions = buildLinkArcPositions(
        fromPosition,
        toPosition,
        getDynamicNodeAltitude(link.from),
        getDynamicNodeAltitude(link.to),
        mapViewMode === '3d'
      );

      polylineRefs.forEach((polyline) => {
        if (polyline && polyline.setLatLngs) {
          polyline.setLatLngs(linkPositions);
        }
      });
    });
  }, [applyMarkerAltitudeVisual, baseNodes, getDynamicNodeAltitude, getDynamicNodePosition, links, mapViewMode]);

  const handleWebSocketData = useCallback((data) => {
    if (!data || !Array.isArray(data.nodes)) {
      return;
    }

    const updates = data.nodes.map((node) => ({
      id: node.id,
      location: {
        geo: {
          lat: node.lat,
          lng: node.lng,
          altitude: node.altitude,
        },
      },
      state: {
        online: node.status !== 'offline',
        status: node.status,
      },
      timestamp: new Date(data.timestamp).toISOString(),
    }));

    handleUpdateNodeStates(updates);
  }, [handleUpdateNodeStates]);

  useWebSocketTopology(handleWebSocketData, 'ws://localhost:8080');

  const handleToggleSidebar = useCallback((value) => {
    const nextCollapsed = !!value;
    setSidebarCollapsed(nextCollapsed);
    if (nextCollapsed) {
      setSelectedNodeId(null);
      setFocusRequestId(null);
    }
  }, []);

  const handleSelectNode = useCallback((nodeId) => {
    setSelectedNodeId((prev) => {
      if (prev === nodeId) {
        setFocusRequestId(null);
        return null;
      }
      setFocusRequestId(nodeId);
      return nodeId;
    });
  }, []);

  const handleFocusConsumed = useCallback(() => {
    setFocusRequestId(null);
  }, []);

  const handleToggleMapViewMode = useCallback(() => {
    setMapViewMode((prev) => (prev === '2d' ? '3d' : '2d'));
  }, []);

  useEffect(() => {
    Object.entries(markerRefsById.current).forEach(([nodeId, marker]) => {
      applyMarkerAltitudeVisual(marker, nodeId);
    });

    links.forEach((link) => {
      const polylineRefs = linkPolylineRefsById.current[link.id];
      if (!polylineRefs) {
        return;
      }

      const fromPosition = getDynamicNodePosition(link.from);
      const toPosition = getDynamicNodePosition(link.to);
      if (!fromPosition || !toPosition) {
        return;
      }

      const linkPositions = buildLinkArcPositions(
        fromPosition,
        toPosition,
        getDynamicNodeAltitude(link.from),
        getDynamicNodeAltitude(link.to),
        mapViewMode === '3d'
      );

      polylineRefs.forEach((polyline) => {
        if (polyline && polyline.setLatLngs) {
          polyline.setLatLngs(linkPositions);
        }
      });
    });
  }, [applyMarkerAltitudeVisual, getDynamicNodeAltitude, getDynamicNodePosition, links, mapViewMode]);

  function MapMovementController() {
    const map = useMap();

    useEffect(() => {
      const container = map.getContainer();
      if (!container) {
        return undefined;
      }

      const addClass = () => container.classList.add('map-moving');
      const removeClass = () => container.classList.remove('map-moving');

      map.on('movestart', addClass);
      map.on('moveend', removeClass);
      map.on('zoomstart', addClass);
      map.on('zoomend', removeClass);

      return () => {
        map.off('movestart', addClass);
        map.off('moveend', removeClass);
        map.off('zoomstart', addClass);
        map.off('zoomend', removeClass);
        container.classList.remove('map-moving');
      };
    }, [map]);

    return null;
  }

  function SelectedNodeController({ nodeId, focusId, onFocusHandled }) {
    const map = useMap();

    useEffect(() => {
      mapRef.current = map;
    }, [map]);

    useEffect(() => {
      if (!nodeId) {
        map.closePopup();
        return;
      }

      const marker = markerRefsById.current[nodeId];
      let cleanupTimer = null;
      const openPopup = () => {
        const activeMarker = markerRefsById.current[nodeId];
        if (activeMarker) {
          activeMarker.openPopup();
          activeMarker.setZIndexOffset(1000);
        }
      };

      if (marker) {
        cleanupTimer = setTimeout(openPopup, 200);
      } else {
        cleanupTimer = setTimeout(openPopup, 400);
      }

      return () => {
        if (cleanupTimer) {
          clearTimeout(cleanupTimer);
        }
        const activeMarker = markerRefsById.current[nodeId];
        if (activeMarker) {
          activeMarker.setZIndexOffset(0);
        }
      };
    }, [map, nodeId]);

    useEffect(() => {
      if (!nodeId || focusId !== nodeId) {
        return;
      }

      // 使用动态位置而不是静态位置，确保卫星等移动节点聚焦到实时位置
      const dynState = nodeStateRef.current[nodeId];
      let nodePosition = null;
      
      if (dynState?.location?.geo) {
        nodePosition = [dynState.location.geo.lat, dynState.location.geo.lng];
      } else {
        const baseNode = nodeMapRef.current[nodeId];
        nodePosition = getNodePosition(baseNode);
      }

      if (!nodePosition) {
        onFocusHandled && onFocusHandled();
        return;
      }

      const currentZoom = map.getZoom ? map.getZoom() : 13;
      const targetZoom = Math.max(currentZoom, 15);
      map.flyTo(nodePosition, targetZoom, {
        duration: 0.8,
        easeLinearity: 0.25,
      });

      onFocusHandled && onFocusHandled();
    }, [map, nodeId, focusId, onFocusHandled]);

    return null;
  }

  // 渲染 Marker 的基础数据来自 baseNodes，位置和状态在 Marker 挂载后直接由 Leaflet 更新
  // 使用 useMemo 缓存 markerElements，避免每次 render 时 Marker 被重新挂载导致闪烁
  const markerElements = useMemo(() => baseNodes.map((node) => {
    const typeMeta = NODE_TYPE_META[node.type] || { label: node.type || '未知节点', color: '#7f7f7f' };
    const position = getNodePosition(node);
    if (!position) {
      return null;
    }

    return (
      <Marker
        key={node.id}
        position={position}
        icon={getIconForType(node.type)}
        eventHandlers={{
          click: () => handleSelectNode(node.id),
        }}
        ref={(marker) => {
          if (marker) {
            markerRefsById.current[node.id] = marker;
            applyMarkerAltitudeVisual(marker, node.id);
          } else {
            delete markerRefsById.current[node.id];
          }
        }}
      >
        <Popup>
          <NodePopupContent
            node={node}
            typeMeta={typeMeta}
            nodeStateRef={nodeStateRef}
          />
        </Popup>
      </Marker>
    );
  }), [applyMarkerAltitudeVisual, baseNodes, handleSelectNode]);

  // 链路渲染使用动态位置，确保连线跟随节点实时更新
  // 为了让 Polyline 能被 ref 捕获，我们需要使用一个闭包技巧将 ref 回调传递给 Polyline 的 eventHandlers
  // 不使用 useMemo 因为 linkElements 中的位置需要实时更新（每次 WebSocket 数据到达时）
  const linkElements = links.map((link) => {
    const fromPosition = getDynamicNodePosition(link.from);
    const toPosition = getDynamicNodePosition(link.to);
    if (!fromPosition || !toPosition) {
      return null;
    }

    const linkPositions = buildLinkArcPositions(
      fromPosition,
      toPosition,
      getDynamicNodeAltitude(link.from),
      getDynamicNodeAltitude(link.to),
      mapViewMode === '3d'
    );

    const healthColor = getLinkHealthColor(link);
    const flowClass = `link-line link-line--flow ${getLinkFlowSpeedClass(link)}`;
    const baseOpacity = typeof link.availability === 'number'
      ? Math.min(1, Math.max(0.4, link.availability))
      : 0.8;

    // 健康线 ref 回调
    const healthLineRefCallback = (polyline) => {
      if (polyline && !linkPolylineRefsById.current[link.id]) {
        linkPolylineRefsById.current[link.id] = [];
      }
      if (polyline && linkPolylineRefsById.current[link.id]) {
        linkPolylineRefsById.current[link.id][0] = polyline;
      }
    };

    // 流量线 ref 回调
    const flowLineRefCallback = (polyline) => {
      if (polyline && !linkPolylineRefsById.current[link.id]) {
        linkPolylineRefsById.current[link.id] = [];
      }
      if (polyline && linkPolylineRefsById.current[link.id]) {
        linkPolylineRefsById.current[link.id][1] = polyline;
      }
    };

    return (
      <React.Fragment key={link.id}>
        <Polyline
          ref={healthLineRefCallback}
          positions={linkPositions}
          pathOptions={{
            ...getLinkStyle(link),
            color: healthColor,
            opacity: baseOpacity,
            className: 'link-line link-line--health',
          }}
        />
        <Polyline
          ref={flowLineRefCallback}
          positions={linkPositions}
          pathOptions={{
            color: healthColor,
            weight: 3,
            opacity: 0.9,
            className: flowClass,
          }}
        />
      </React.Fragment>
    );
  });

  return (
    <div className="App relative h-screen w-screen bg-gradient-to-br from-deep-navy via-[#0d1f3c] to-[#030915] text-slate-100 overflow-hidden">
      <div
        className={`absolute top-0 left-0 z-10 h-full transition-all duration-300 ease-out border-r border-white/20 backdrop-blur-2xl bg-white/5 shadow-2xl flex-shrink-0 ${sidebarCollapsed ? 'w-20' : 'w-80'}`}
      >
        <NodeList
          nodes={baseNodes}
          collapsed={sidebarCollapsed}
          onToggle={handleToggleSidebar}
          typeMeta={NODE_TYPE_META}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
        />
      </div>

      <div className="map-mode-panel absolute right-5 top-5 z-[1000] rounded-2xl border border-white/20 bg-[#07182fcc] p-3 text-xs text-slate-100 backdrop-blur-xl shadow-2xl">
        <p className="tracking-[0.2em] uppercase text-[10px] text-cyan-200/90">Map View</p>
        <button
          type="button"
          onClick={handleToggleMapViewMode}
          className="map-mode-toggle mt-2"
          aria-label="切换 2D / 3D 地图视图"
        >
          <span className={mapViewMode === '2d' ? 'is-active' : ''}>2D</span>
          <span className={mapViewMode === '3d' ? 'is-active' : ''}>3D</span>
        </button>
        <p className="mt-2 text-[11px] text-slate-300/90">
          {mapViewMode === '3d' ? '3D 视角：空天地节点按真实高度分层显示。' : '2D 模式：保持平面拓扑表现。'}
        </p>
      </div>

      {mapViewMode === '2d' ? (
        <MapContainer
          center={[39.9, 116.4]}
          zoom={13}
          className="absolute inset-0 h-full w-full z-0"
        >
          <MapMovementController />
          <SelectedNodeController
            nodeId={selectedNodeId}
            focusId={focusRequestId}
            onFocusHandled={handleFocusConsumed}
          />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap 贡献者"
          />
          {markerElements}
          {linkElements}
        </MapContainer>
      ) : (
        <Map3DView
          nodes={baseNodes}
          links={links}
          nodeStateRef={nodeStateRef}
          nodeMapRef={nodeMapRef}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
        />
      )}
    </div>
  );
}

export default App;
