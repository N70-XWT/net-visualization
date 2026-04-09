import React, { useMemo, useEffect, useState, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { luma } from '@luma.gl/core';
import { webgl2Adapter, WebGLCanvasContext } from '@luma.gl/webgl';
import { XDU_CAMPUS_DEFAULT_CENTER, XDU_CAMPUS_NODE_TYPE_META } from './services/xduCampusPreset';

luma.registerAdapters([webgl2Adapter]);

const _origHandleResize = WebGLCanvasContext.prototype._handleResize;
WebGLCanvasContext.prototype._handleResize = function (entries) {
  if (!this.device?.limits) {
    return;
  }
  return _origHandleResize.call(this, entries);
};

const INITIAL_VIEW_STATE = {
  longitude: XDU_CAMPUS_DEFAULT_CENTER.lng,
  latitude: XDU_CAMPUS_DEFAULT_CENTER.lat,
  zoom: 16.2,
  pitch: 55,
  bearing: -18,
  maxPitch: 75,
  minZoom: 12,
  maxZoom: 20,
};

function hexToRgb(hexColor) {
  const value = String(hexColor || '').trim();
  const normalized = value.startsWith('#') ? value.slice(1) : value;
  if (normalized.length !== 6) {
    return [148, 163, 184];
  }
  const parsed = Number.parseInt(normalized, 16);
  if (!Number.isFinite(parsed)) {
    return [148, 163, 184];
  }
  return [
    (parsed >> 16) & 255,
    (parsed >> 8) & 255,
    parsed & 255,
  ];
}

const NODE_COLORS = Object.entries(XDU_CAMPUS_NODE_TYPE_META).reduce((acc, [key, meta]) => {
  acc[key] = hexToRgb(meta?.color);
  return acc;
}, {});

const ALTITUDE_TIERS = [
  { label: 'Core Network', example: '~30-45 m', color: 'rgb(96,165,250)' },
  { label: 'Aggregation Layer', example: '~15-28 m', color: 'rgb(34,211,238)' },
  { label: 'Edge Transport', example: '~8-18 m', color: 'rgb(52,211,153)' },
  { label: 'Access Sensing', example: '~1-8 m', color: 'rgb(249,115,22)' },
];
const MAP3D_REFRESH_INTERVAL_MS = 2000;
const MAP3D_DEVICE_PIXELS = 1;

function getVisualAltitude(altitude) {
  const value = Math.max(0, Number(altitude) || 0);
  if (value < 1) {
    return 0;
  }
  return Math.min(1800, Math.sqrt(value) * 220);
}

function getLinkHealthRgba(link, alpha) {
  const lossRate = typeof link.lossRate === 'number' ? link.lossRate : null;
  const snrDb = typeof link.snrDb === 'number' ? link.snrDb : null;
  if ((lossRate !== null && lossRate >= 0.03) || (snrDb !== null && snrDb < 10)) {
    return [249, 93, 93, alpha];
  }
  if ((lossRate !== null && lossRate >= 0.015) || (snrDb !== null && snrDb < 18)) {
    return [244, 200, 74, alpha];
  }
  return [53, 242, 154, alpha];
}

function AltitudeLegend() {
  return (
    <div className="absolute bottom-5 right-5 z-[1000] rounded-2xl border border-white/15 bg-[#07182fdd] px-4 py-3 text-xs text-slate-200 backdrop-blur-xl shadow-2xl select-none pointer-events-auto">
      <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-cyan-200/80">Layer Altitude</p>
      <div className="flex flex-col gap-1.5">
        {ALTITUDE_TIERS.map((tier) => (
          <div key={tier.label} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: tier.color }}
            />
            <span className="text-slate-300 whitespace-nowrap">{tier.label}</span>
            <span className="ml-auto text-slate-500 pl-3">{tier.example}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Map3DView({
  nodes,
  links,
  nodeStateRef,
  nodeMapRef,
  selectedNodeId,
  onSelectNode,
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((prev) => prev + 1), MAP3D_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const getDynGeo = useCallback(
    (nodeId) => {
      const dyn = nodeStateRef.current[nodeId]?.location?.geo;
      return dyn || nodeMapRef.current[nodeId]?.location?.geo || null;
    },
    [nodeStateRef, nodeMapRef],
  );

  const nodeData = useMemo(() => {
    return nodes
      .map((node) => {
        const geo = getDynGeo(node.id);
        if (!geo) {
          return null;
        }
        const altitude = getVisualAltitude(geo.altitude);
        return {
          id: node.id,
          name: node.name,
          type: node.type,
          layer: node.layer,
          rawAltitude: geo.altitude || 0,
          position: [geo.lng, geo.lat, altitude],
          groundPosition: [geo.lng, geo.lat, 0],
          color: NODE_COLORS[node.type] || [148, 163, 184],
          isSelected: node.id === selectedNodeId,
        };
      })
      .filter(Boolean);
    // `tick` is intentionally used to re-read dynamic geo from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDynGeo, nodes, selectedNodeId, tick]);

  const linkData = useMemo(() => {
    return links
      .map((link) => {
        const fromGeo = getDynGeo(link.from);
        const toGeo = getDynGeo(link.to);
        if (!fromGeo || !toGeo) {
          return null;
        }
        return {
          id: link.id,
          sourcePosition: [fromGeo.lng, fromGeo.lat, getVisualAltitude(fromGeo.altitude)],
          targetPosition: [toGeo.lng, toGeo.lat, getVisualAltitude(toGeo.altitude)],
          healthColor: getLinkHealthRgba(link, 170),
        };
      })
      .filter(Boolean);
    // `tick` is intentionally used to re-read dynamic geo from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDynGeo, links, tick]);

  const elevatedNodes = useMemo(() => nodeData.filter((item) => item.position[2] > 120), [nodeData]);

  const layers = useMemo(
    () => [
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
      new LineLayer({
        id: 'altitude-pillars',
        data: elevatedNodes,
        getSourcePosition: (d) => d.groundPosition,
        getTargetPosition: (d) => d.position,
        getColor: (d) => [...d.color, 45],
        getWidth: 1,
        widthMinPixels: 1,
      }),
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
    [elevatedNodes, linkData, nodeData, onSelectNode],
  );

  const getTooltip = useCallback(({ object }) => {
    if (!object || !object.name) {
      return null;
    }
    const typeLabel = XDU_CAMPUS_NODE_TYPE_META[object.type]?.label || object.type || '-';
    return {
      html: `<div style="padding:2px"><b>${object.name}</b><br/>Type: ${typeLabel}<br/>Height: ${object.rawAltitude ?? '-'} m</div>`,
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
        useDevicePixels={MAP3D_DEVICE_PIXELS}
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

export default React.memo(Map3DView);
