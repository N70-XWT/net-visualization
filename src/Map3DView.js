import React, { useMemo, useEffect, useState, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { luma } from '@luma.gl/core';
import { webgl2Adapter, WebGLCanvasContext } from '@luma.gl/webgl';

/* 注册 WebGL2 适配器 */
luma.registerAdapters([webgl2Adapter]);

/*
 * 修补 luma.gl v9.2.x 初始化竞态条件：
 * CanvasContext 基类构造函数中 ResizeObserver 可能在子类的 this.device
 * 赋值之前同步触发 _handleResize → getMaxDrawingBufferSize，导致
 * "Cannot read properties of undefined (reading 'maxTextureDimension2D')"。
 * 在 device 尚未就绪时返回安全默认值并跳过 resize 逻辑。
 */
const _origHandleResize = WebGLCanvasContext.prototype._handleResize;
WebGLCanvasContext.prototype._handleResize = function (entries) {
  if (!this.device?.limits) {
    return; // device 还未赋值，跳过这次 resize 回调
  }
  return _origHandleResize.call(this, entries);
};

/* ─── 初始 3D 视角 ─── */
const INITIAL_VIEW_STATE = {
  longitude: 116.42,
  latitude: 39.915,
  zoom: 12.5,
  pitch: 55,
  bearing: -15,
  maxPitch: 75,
  minZoom: 8,
  maxZoom: 18,
};

/* ─── 节点颜色 RGB（与 2D 视图 NODE_TYPE_META 保持一致） ─── */
const NODE_COLORS = {
  router:         [31, 120, 180],
  'base-station': [242, 142, 43],
  'mesh-node':    [89, 161, 79],
  terminal:       [148, 103, 189],
  satellite:      [127, 127, 127],
};

/* ─── 高度图例（右下角面板） ─── */
const ALTITUDE_TIERS = [
  { label: 'LEO 卫星',       example: '~550 km', color: 'rgb(127,127,127)' },
  { label: '无人机 / 自组网', example: '~100-200 m', color: 'rgb(89,161,79)' },
  { label: '基站 / 路由器',   example: '~30-50 m', color: 'rgb(242,142,43)' },
  { label: '终端设备',        example: '~15-20 m', color: 'rgb(148,103,189)' },
];

/* 对数压缩：将 15 m → 550 km 这种跨数量级高度映射到可视范围 */
function getVisualAltitude(altitude) {
  const a = Math.max(0, Number(altitude) || 0);
  if (a < 1) return 0;
  // log10(15)≈1.18 → 1967; log10(120)≈2.08 → 3464; log10(550000)≈5.74 → 9567
  return (Math.log10(a) / 6) * 10000;
}

/* 链路健康色 → RGBA */
function getLinkHealthRgba(link, alpha) {
  const lr = typeof link.lossRate === 'number' ? link.lossRate : null;
  const snr = typeof link.snrDb === 'number' ? link.snrDb : null;
  if ((lr !== null && lr >= 0.03) || (snr !== null && snr < 10)) return [249, 93, 93, alpha];
  if ((lr !== null && lr >= 0.015) || (snr !== null && snr < 18)) return [244, 200, 74, alpha];
  return [53, 242, 154, alpha];
}

/* 高度图例面板 */
function AltitudeLegend() {
  return (
    <div className="absolute bottom-5 right-5 z-[1000] rounded-2xl border border-white/15 bg-[#07182fdd] px-4 py-3 text-xs text-slate-200 backdrop-blur-xl shadow-2xl select-none pointer-events-auto">
      <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">Altitude Scale</p>
      <div className="flex flex-col gap-1.5">
        {ALTITUDE_TIERS.map((tier) => (
          <div key={tier.label} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tier.color }} />
            <span className="text-slate-300 whitespace-nowrap">{tier.label}</span>
            <span className="ml-auto text-slate-500 pl-3">{tier.example}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── 主组件 ─── */
export default function Map3DView({
  nodes,
  links,
  nodeStateRef,
  nodeMapRef,
  selectedNodeId,
  onSelectNode,
}) {
  /* 定时 tick 驱动动态数据刷新（nodeStateRef 是 ref，不触发 React 重渲染） */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1200);
    return () => clearInterval(id);
  }, []);

  /* 获取节点动态 geo（优先 WebSocket，回退到基础数据） */
  const getDynGeo = useCallback(
    (nodeId) => {
      const dyn = nodeStateRef.current[nodeId]?.location?.geo;
      return dyn || nodeMapRef.current[nodeId]?.location?.geo || null;
    },
    [nodeStateRef, nodeMapRef],
  );

  /* ─── 构建节点层数据 ─── */
  const nodeData = useMemo(() => {
    return nodes
      .map((node) => {
        const geo = getDynGeo(node.id);
        if (!geo) return null;
        const alt = getVisualAltitude(geo.altitude);
        return {
          id: node.id,
          name: node.name,
          type: node.type,
          layer: node.layer,
          rawAltitude: geo.altitude || 0,
          position: [geo.lng, geo.lat, alt],
          groundPosition: [geo.lng, geo.lat, 0],
          color: NODE_COLORS[node.type] || [127, 127, 127],
          isSelected: node.id === selectedNodeId,
        };
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, getDynGeo, selectedNodeId, tick]);

  /* ─── 构建链路层数据 ─── */
  const linkData = useMemo(() => {
    return links
      .map((link) => {
        const fromGeo = getDynGeo(link.from);
        const toGeo = getDynGeo(link.to);
        if (!fromGeo || !toGeo) return null;
        return {
          id: link.id,
          sourcePosition: [fromGeo.lng, fromGeo.lat, getVisualAltitude(fromGeo.altitude)],
          targetPosition: [toGeo.lng, toGeo.lat, getVisualAltitude(toGeo.altitude)],
          healthColor: getLinkHealthRgba(link, 170),
        };
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, getDynGeo, tick]);

  /* 高空节点（展示投影柱和地面阴影） */
  const elevatedNodes = useMemo(() => nodeData.filter((d) => d.position[2] > 200), [nodeData]);

  /* ─── deck.gl 图层 ─── */
  const layers = useMemo(
    () => [
      /* 链路连线 — 3D 直线，在源/目标高度之间 */
      new LineLayer({
        id: 'link-lines',
        data: linkData,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => d.targetPosition,
        getColor: (d) => d.healthColor,
        getWidth: 2.5,
        widthMinPixels: 1.5,
        widthMaxPixels: 5,
      }),
      /* 高度参考柱 — 从地面到节点的细线 */
      new LineLayer({
        id: 'altitude-pillars',
        data: elevatedNodes,
        getSourcePosition: (d) => d.groundPosition,
        getTargetPosition: (d) => d.position,
        getColor: (d) => [...d.color, 45],
        getWidth: 1,
        widthMinPixels: 1,
      }),
      /* 地面投影圆 — 半透明圆点显示节点地理位置的投影 */
      new ScatterplotLayer({
        id: 'ground-shadows',
        data: elevatedNodes,
        getPosition: (d) => d.groundPosition,
        getRadius: 60,
        getFillColor: (d) => [...d.color, 30],
        stroked: false,
        radiusMinPixels: 3,
        radiusMaxPixels: 10,
      }),
      /* 节点圆 — 3D 位置的主要可交互图层 */
      new ScatterplotLayer({
        id: 'node-circles',
        data: nodeData,
        getPosition: (d) => d.position,
        getRadius: (d) => (d.isSelected ? 160 : 90),
        getFillColor: (d) => [...d.color, d.isSelected ? 240 : 190],
        getLineColor: (d) => (d.isSelected ? [255, 255, 255, 255] : [200, 220, 240, 100]),
        getLineWidth: (d) => (d.isSelected ? 3 : 1.5),
        stroked: true,
        pickable: true,
        radiusMinPixels: 6,
        radiusMaxPixels: 22,
        onClick: (info) => info.object && onSelectNode(info.object.id),
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
      }),
      /* 节点名称标签 */
      new TextLayer({
        id: 'node-labels',
        data: nodeData,
        getPosition: (d) => d.position,
        getText: (d) => d.name,
        getSize: 13,
        getColor: [226, 239, 255, 210],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        getPixelOffset: [14, -4],
        fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
        fontWeight: 500,
        outlineWidth: 3,
        outlineColor: [5, 15, 30, 210],
        billboard: true,
      }),
    ],
    [nodeData, linkData, elevatedNodes, onSelectNode],
  );

  /* ─── Tooltip ─── */
  const getTooltip = useCallback(({ object }) => {
    if (!object || !object.name) return null;
    return {
      html: `<div style="padding:2px"><b>${object.name}</b><br/>类型：${object.type || '-'}<br/>高度：${object.rawAltitude ?? '-'} m</div>`,
      style: {
        backgroundColor: 'rgba(8,24,48,0.92)',
        color: '#e2f7ff',
        borderRadius: '10px',
        border: '1px solid rgba(94,247,193,0.3)',
        fontSize: '12px',
        padding: '6px 10px',
        fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      },
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layers}
        getTooltip={getTooltip}
        useDevicePixels={true}
      >
        <Map
          reuseMaps
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        />
      </DeckGL>
      <AltitudeLegend />
    </div>
  );
}
