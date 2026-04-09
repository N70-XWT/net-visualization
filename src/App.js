import './App.css';
import React, { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import NodeList from './NodeList';

import { mockTopology } from './services/mockTopologyData';
import { buildInitialNodeState } from './services/mockNodeStream';
import {
  getAlerts,
  getConnectivityAnalysis,
  getEvents,
  getLinkById,
  getNodeById,
  getPlaybackFrames,
  getShortestPathAnalysis,
  sendPythonCommand,
  getSituationCurrent,
  getTopology,
} from './services/networkApi';
import {
  applyXduCampusPreset,
  getCampusPointByZone,
  mapNodeToXduCampus,
  XDU_CAMPUS_DEFAULT_CENTER,
  XDU_CAMPUS_DEVICE_TYPE_BY_KEY,
  XDU_CAMPUS_DEVICE_TYPE_OPTIONS,
  XDU_CAMPUS_LAYER_OPTIONS,
  XDU_CAMPUS_NODE_TYPE_META,
  XDU_CAMPUS_ZONE_OPTIONS,
} from './services/xduCampusPreset';
import { normalizeToWgs84 } from './services/coordinateUtils';

const Map3DView = lazy(() => import('./Map3DView'));

const NODE_TYPE_META = XDU_CAMPUS_NODE_TYPE_META;
const LAYER_OPTIONS = XDU_CAMPUS_LAYER_OPTIONS;
const LAYER_LABEL_BY_KEY = LAYER_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});
const DEFAULT_ADD_NODE_TYPE = XDU_CAMPUS_DEVICE_TYPE_OPTIONS[0]?.value || 'camera';
const DEFAULT_ADD_NODE_PROFILE = XDU_CAMPUS_DEVICE_TYPE_BY_KEY[DEFAULT_ADD_NODE_TYPE] || null;
const DEFAULT_ADD_NODE_ZONE = DEFAULT_ADD_NODE_PROFILE?.defaultZone || 'teaching-area';
const DEFAULT_ADD_NODE_GEO = getCampusPointByZone(DEFAULT_ADD_NODE_ZONE, 'xdu-campus-default-add-node', 0);
const INITIAL_TOPOLOGY = applyXduCampusPreset(mockTopology);
const POLLING_INTERVAL_MS = Math.max(
  2000,
  Number.parseInt(process.env.REACT_APP_TOPOLOGY_POLLING_MS || '5000', 10) || 5000
);
const EVENT_FETCH_LIMIT = 20;
const ALERT_FETCH_LIMIT = 24;
const EVENT_LIST_MAX_ITEMS = 24;
const ALERT_LIST_MAX_ITEMS = 24;
const PLAYBACK_FRAME_FETCH_LIMIT = 30;
const PLAYBACK_STEP_INTERVAL_MS = 1000;
const KPI_HISTORY_MAX_POINTS = 30;
const NODE_DETAILS_CACHE_MAX_ITEMS = 80;
const LINK_DETAILS_CACHE_MAX_ITEMS = 120;
const FOCUS_PULSE_DURATION_MS = 1800;
const CONTROL_PANEL_COLLAPSED_STORAGE_KEY = 'netviz:control-panel-collapsed';
const MAP_LEGEND_COLLAPSED_STORAGE_KEY = 'netviz:map-legend-collapsed';
const CONTROL_PANEL_SECTIONS_STORAGE_KEY = 'netviz:control-panel-sections';
const CONTROL_PANEL_SECTION_DEFAULTS = {
  search: true,
  playback: true,
  python: false,
  analysis: true,
  kpi: true,
  alerts: false,
};
const NODE_SEVERITY_COLORS = {
  normal: '#35f29a',
  warning: '#f4c84a',
  critical: '#f95d5d',
};
const ALERT_SEVERITY_COLORS = {
  info: '#67e8f9',
  warning: '#f4c84a',
  critical: '#f95d5d',
};

const ICON_CACHE = {};

function createCampusNodeSvg(meta) {
  const color = String(meta?.color || '#94a3b8');
  const badge = String(meta?.badge || 'Io').slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <defs>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.16"/>
    </radialGradient>
  </defs>
  <circle cx="22" cy="22" r="18" fill="url(#halo)" />
  <circle cx="22" cy="22" r="12" fill="${color}" stroke="#ffffff" stroke-width="1.6" />
  <text x="22" y="25.8" text-anchor="middle" font-size="10.6" font-family="Arial, sans-serif" font-weight="700" fill="#f8fafc">${badge}</text>
</svg>`;
}

function createLeafletIcon(meta) {
  const svg = createCampusNodeSvg(meta);
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [44, 44],
    iconAnchor: [22, 36],
    popupAnchor: [0, -28],
    className: 'network-node-icon',
  });
}

function createFallbackIcon() {
  const svg = createCampusNodeSvg({
    color: '#64748b',
    badge: 'Io',
  });
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [44, 44],
    iconAnchor: [22, 36],
    popupAnchor: [0, -28],
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

function toLimitedList(items, maxItems) {
  if (!Array.isArray(items)) {
    return [];
  }
  if (!Number.isFinite(maxItems) || maxItems <= 0) {
    return [];
  }
  if (items.length <= maxItems) {
    return items.slice();
  }
  return items.slice(items.length - maxItems);
}

function compactEventItem(eventItem, index) {
  if (!eventItem || typeof eventItem !== 'object') {
    return null;
  }
  return {
    id: String(eventItem.id || eventItem.eventId || `event-${index + 1}`),
    type: eventItem.type || 'event',
    severity: eventItem.severity || 'info',
    message: eventItem.message || eventItem.title || eventItem.type || 'event',
    occurredAt: eventItem.occurredAt || eventItem.timestamp || null,
    timestamp: eventItem.timestamp || eventItem.occurredAt || null,
    entityType: eventItem.entityType || null,
    entityId: eventItem.entityId || null,
  };
}

function compactAlertItem(alertItem, index) {
  if (!alertItem || typeof alertItem !== 'object') {
    return null;
  }
  return {
    id: String(alertItem.id || alertItem.alertId || `alert-${index + 1}`),
    type: alertItem.type || 'alert',
    title: alertItem.title || alertItem.type || 'Alert',
    message: alertItem.message || '',
    severity: alertItem.severity || 'info',
    active: alertItem.active !== false,
    timestamp: alertItem.timestamp || alertItem.updatedAt || alertItem.createdAt || null,
    entityType: alertItem.entityType || null,
    entityId: alertItem.entityId || null,
  };
}

function upsertLimitedRecord(prev, key, value, maxItems) {
  if (!key) {
    return prev;
  }
  const next = { ...prev };
  if (Object.prototype.hasOwnProperty.call(next, key)) {
    delete next[key];
  }
  next[key] = value;
  const keys = Object.keys(next);
  if (keys.length <= maxItems) {
    return next;
  }
  const overflow = keys.length - maxItems;
  for (let index = 0; index < overflow; index += 1) {
    delete next[keys[index]];
  }
  return next;
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return '-';
  }
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }
  return parsed.toLocaleTimeString();
}

function formatTimestampWithDate(isoString) {
  if (!isoString) {
    return '-';
  }
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }
  return parsed.toLocaleString();
}

function toFiniteNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMetricNumber(value, fractionDigits = 1) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(fractionDigits);
}

function formatMetricPercent(value, fractionDigits = 1) {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

function normalizeAlertSeverity(rawSeverity) {
  const severity = String(rawSeverity || '').toLowerCase();
  if (severity === 'critical') {
    return 'critical';
  }
  if (severity === 'warning' || severity === 'major') {
    return 'warning';
  }
  return 'info';
}

function getAlertSeverityColor(rawSeverity) {
  const severity = normalizeAlertSeverity(rawSeverity);
  return ALERT_SEVERITY_COLORS[severity] || ALERT_SEVERITY_COLORS.info;
}

function getNodeSeverity(nodeLike) {
  const online = nodeLike?.state?.online;
  const status = String(nodeLike?.state?.status || '').toLowerCase();
  const alarmLevel = String(nodeLike?.alarmLevel || '').toLowerCase();

  if (online === false || status === 'offline' || status === 'error' || status === 'down' || alarmLevel === 'danger') {
    return 'critical';
  }
  if (status === 'warning' || status === 'busy' || status === 'degraded' || alarmLevel === 'warning') {
    return 'warning';
  }
  return 'normal';
}

function getNodeSeverityColor(nodeLike) {
  return NODE_SEVERITY_COLORS[getNodeSeverity(nodeLike)] || NODE_SEVERITY_COLORS.normal;
}

function buildOrderedUniqueValues(values, fallbackValues = []) {
  const seen = new Set();
  const ordered = [];
  [...values, ...fallbackValues].forEach((value) => {
    const text = String(value || '').trim();
    if (!text) {
      return;
    }
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    ordered.push(text);
  });
  return ordered;
}

function formatOptionLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '-';
  }
  return text
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function getLayerLabel(layer) {
  const key = String(layer || '').trim();
  return LAYER_LABEL_BY_KEY[key] || formatOptionLabel(key);
}

function getNodeTypeLabel(type) {
  const key = String(type || '').trim();
  return NODE_TYPE_META[key]?.label || formatOptionLabel(key);
}

function getAddNodeTypeProfile(type) {
  const key = String(type || '').trim();
  return XDU_CAMPUS_DEVICE_TYPE_BY_KEY[key] || null;
}

function inferRoleForNewNode(type) {
  const profile = getAddNodeTypeProfile(type);
  return String(profile?.role || type || 'iot-device');
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
  const state = String(link?.state || 'up').toLowerCase();
  if (state !== 'up') {
    return '#f95d5d';
  }

  const delayMs = typeof link.delayMs === 'number' ? link.delayMs : null;
  const lossRate = typeof link.lossRate === 'number' ? link.lossRate : null;
  const utilization = typeof link.utilization === 'number' ? link.utilization : null;
  const snrDb = typeof link.snrDb === 'number' ? link.snrDb : null;

  const isCriticalDelay = delayMs !== null && delayMs >= 60;
  const isWarningDelay = delayMs !== null && delayMs >= 25;
  const isCriticalLoss = lossRate !== null && lossRate >= 0.08;
  const isWarningLoss = lossRate !== null && lossRate >= 0.03;
  const isCriticalSnr = snrDb !== null && snrDb < 10;
  const isWarningSnr = snrDb !== null && snrDb < 18;
  const isWarningUtilization = utilization !== null && utilization >= 0.85;

  if (isCriticalDelay || isCriticalLoss || isCriticalSnr) {
    return '#f95d5d';
  }
  if (isWarningDelay || isWarningLoss || isWarningSnr || isWarningUtilization) {
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

function NodePopupContent({ node, typeMeta, nodeStateRef }) {
  const getDynState = () => nodeStateRef.current[node.id];
  const dynState = getDynState();
  const mergedState = dynState?.state || node.state || {};
  const mergedGeo = dynState?.location?.geo || node.location?.geo;
  const metrics = node?.metrics || {};
  const cpu = toFiniteNumberOrNull(metrics.cpu ?? node?.cpu);
  const load = toFiniteNumberOrNull(metrics.load ?? node?.load);
  const energy = toFiniteNumberOrNull(metrics.energy ?? node?.energy);
  const capacity = toFiniteNumberOrNull(metrics.capacity ?? node?.capacity);
  const alarmLevel = String(node?.alarmLevel || '-');
  const role = String(node?.role || '-');
  const zone = String(node?.campusZone || node?.zone || '-');
  const lastSeen = mergedState?.lastSeen ? formatTimestampWithDate(mergedState.lastSeen) : '-';

  return (
    <div className="text-sm text-slate-900">
      <div className="text-base font-semibold text-slate-900">{node.name}</div>
      <div className="mt-2 space-y-1 text-slate-800">
        <div>Node ID: {node.id}</div>
        <div>Type: {typeMeta.label}</div>
        <div>Layer: {getLayerLabel(node.layer)}</div>
        <div>Role: {role}</div>
        <div>Zone: {zone}</div>
        <div>Alarm Level: {alarmLevel}</div>
        <div>
          Status:{' '}
          {`${mergedState?.online ? 'online' : 'offline'} (${mergedState?.status ?? '-'})`}
        </div>
        <div>
          Position:{' '}
          {mergedGeo ? `${mergedGeo.lat?.toFixed(5) ?? '-'}, ${mergedGeo.lng?.toFixed(5) ?? '-'}` : '-'}
        </div>
        <div>Last Seen: {lastSeen}</div>
        <div>CPU: {cpu !== null ? `${(cpu * 100).toFixed(1)}%` : '-'}</div>
        <div>Load: {load !== null ? `${(load * 100).toFixed(1)}%` : '-'}</div>
        <div>Energy: {energy !== null ? energy.toFixed(1) : '-'}</div>
        <div>Capacity: {capacity !== null ? capacity.toFixed(1) : '-'}</div>
      </div>
    </div>
  );
}

function CollapsibleSection({ title, isOpen, onToggle, children, className = '' }) {
  return (
    <div className={`rounded-lg border border-white/15 bg-white/5 p-2 text-[11px] ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-1 py-1 text-left transition-colors hover:bg-white/10"
        aria-expanded={isOpen}
      >
        <span className="font-semibold text-slate-100">{title}</span>
        <span
          className={`inline-block text-[12px] text-slate-300 transition-transform duration-200 ${
            isOpen ? 'rotate-0' : '-rotate-90'
          }`}
        >
          >
        </span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? 'mt-2 max-h-[900px] opacity-100' : 'mt-0 max-h-0 opacity-0'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function getTrendDirection(points) {
  const validPoints = points.filter((value) => Number.isFinite(value));
  if (validPoints.length < 2) {
    return 'flat';
  }
  const first = validPoints[0];
  const last = validPoints[validPoints.length - 1];
  const delta = last - first;
  const base = Math.max(1, Math.abs(first));
  if (Math.abs(delta) / base < 0.03) {
    return 'flat';
  }
  return delta > 0 ? 'up' : 'down';
}

const KpiSparkline = React.memo(function KpiSparkline({ points, color = '#35f29a' }) {
  const validPoints = points.filter((value) => Number.isFinite(value));
  if (validPoints.length < 2) {
    return (
      <div className="mt-1 h-8 rounded border border-white/10 bg-white/[0.03] text-[10px] text-slate-500 flex items-center justify-center">
        no trend
      </div>
    );
  }

  const min = Math.min(...validPoints);
  const max = Math.max(...validPoints);
  const range = Math.max(1e-9, max - min);

  const linePoints = validPoints
    .map((value, index) => {
      const x = (index / (validPoints.length - 1)) * 100;
      const y = 22 - ((value - min) / range) * 18;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      className="mt-1 h-8 w-full rounded border border-white/10 bg-white/[0.03]"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={linePoints}
      />
    </svg>
  );
});

function App() {
  const [topologyData, setTopologyData] = useState(() => ({
    nodes: Array.isArray(INITIAL_TOPOLOGY.nodes) ? INITIAL_TOPOLOGY.nodes : [],
    links: Array.isArray(INITIAL_TOPOLOGY.links) ? INITIAL_TOPOLOGY.links : [],
    crossLayerRelations: Array.isArray(INITIAL_TOPOLOGY.crossLayerRelations)
      ? INITIAL_TOPOLOGY.crossLayerRelations
      : [],
  }));
  const [dataSource, setDataSource] = useState('mock');
  const [apiError, setApiError] = useState('');
  const [situationCurrent, setSituationCurrent] = useState(null);
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [nodeDetailsById, setNodeDetailsById] = useState({});
  const [linkDetailsById, setLinkDetailsById] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [addNodeForm, setAddNodeForm] = useState({
    nodeId: '',
    nodeName: '',
    type: DEFAULT_ADD_NODE_TYPE,
    layer: DEFAULT_ADD_NODE_PROFILE?.defaultLayer || 'edge',
    zone: DEFAULT_ADD_NODE_ZONE,
    status: 'normal',
    online: true,
    coordSystem: 'wgs84',
    lat: Number(DEFAULT_ADD_NODE_GEO.lat).toFixed(6),
    lng: Number(DEFAULT_ADD_NODE_GEO.lng).toFixed(6),
    attachTo: '',
  });
  const [addNodeNameTouched, setAddNodeNameTouched] = useState(false);
  const [addAttachSearch, setAddAttachSearch] = useState('');
  const [removeNodeId, setRemoveNodeId] = useState('');
  const [removeNodeSearch, setRemoveNodeSearch] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandBusyAction, setCommandBusyAction] = useState('');
  const [commandResult, setCommandResult] = useState('');
  const [commandResultKind, setCommandResultKind] = useState('info');
  const [connectivityAnalysis, setConnectivityAnalysis] = useState(null);
  const [connectivityError, setConnectivityError] = useState('');
  const [pathAnalysisForm, setPathAnalysisForm] = useState({
    fromNodeId: '',
    toNodeId: '',
  });
  const [pathAnalysisResult, setPathAnalysisResult] = useState(null);
  const [pathAnalysisLoading, setPathAnalysisLoading] = useState(false);
  const [pathAnalysisError, setPathAnalysisError] = useState('');
  const [playbackMode, setPlaybackMode] = useState('live');
  const [playbackFrames, setPlaybackFrames] = useState([]);
  const [playbackFrameIndex, setPlaybackFrameIndex] = useState(0);
  const [playbackPlaying, setPlaybackPlaying] = useState(false);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [playbackFrameFlash, setPlaybackFrameFlash] = useState(false);
  const [controlPanelCollapsed, setControlPanelCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(CONTROL_PANEL_COLLAPSED_STORAGE_KEY) === '1';
    } catch (_error) {
      return false;
    }
  });
  const [mapLegendCollapsed, setMapLegendCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(MAP_LEGEND_COLLAPSED_STORAGE_KEY) === '1';
    } catch (_error) {
      return false;
    }
  });
  const [controlPanelSections, setControlPanelSections] = useState(() => {
    try {
      const stored = window.localStorage.getItem(CONTROL_PANEL_SECTIONS_STORAGE_KEY);
      if (!stored) {
        return CONTROL_PANEL_SECTION_DEFAULTS;
      }
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return CONTROL_PANEL_SECTION_DEFAULTS;
      }
      return {
        ...CONTROL_PANEL_SECTION_DEFAULTS,
        ...parsed,
      };
    } catch (_error) {
      return CONTROL_PANEL_SECTION_DEFAULTS;
    }
  });
  const [kpiHistory, setKpiHistory] = useState(() => ({
    onlineNodes: [],
    activeAlerts: [],
    avgDelay: [],
    avgLoss: [],
    avgUtilization: [],
  }));
  const refreshInFlightRef = useRef(false);

  const activePlaybackFrame = useMemo(() => {
    if (playbackMode !== 'playback') {
      return null;
    }
    if (!playbackFrames.length) {
      return null;
    }
    return playbackFrames[playbackFrameIndex] || null;
  }, [playbackFrameIndex, playbackFrames, playbackMode]);

  const playbackFrameCount = playbackFrames.length;
  const playbackFrameNumber = playbackFrameCount
    ? Math.min(playbackFrameIndex, playbackFrameCount - 1) + 1
    : 0;
  const playbackProgressPercent = playbackFrameCount > 1
    ? (Math.min(playbackFrameIndex, playbackFrameCount - 1) / (playbackFrameCount - 1)) * 100
    : 0;
  const isPlaybackVisualFlash = playbackMode === 'playback' && playbackFrameFlash;

  const effectiveTopologyData = useMemo(() => {
    if (playbackMode === 'playback') {
      const frameTopology = applyXduCampusPreset(activePlaybackFrame?.topology || {});
      return {
        nodes: Array.isArray(frameTopology.nodes) ? frameTopology.nodes : [],
        links: Array.isArray(frameTopology.links) ? frameTopology.links : [],
        crossLayerRelations: Array.isArray(frameTopology.crossLayerRelations)
          ? frameTopology.crossLayerRelations
          : [],
      };
    }
    return topologyData;
  }, [activePlaybackFrame, playbackMode, topologyData]);

  const effectiveSituationCurrent = playbackMode === 'playback'
    ? (activePlaybackFrame?.situation || null)
    : situationCurrent;
  const effectiveEvents = useMemo(() => {
    if (playbackMode === 'playback') {
      return Array.isArray(activePlaybackFrame?.events) ? activePlaybackFrame.events : [];
    }
    return events;
  }, [activePlaybackFrame, events, playbackMode]);
  const effectiveAlerts = useMemo(() => {
    if (playbackMode === 'playback') {
      return Array.isArray(activePlaybackFrame?.alerts) ? activePlaybackFrame.alerts : [];
    }
    return alerts;
  }, [activePlaybackFrame, alerts, playbackMode]);

  const baseNodes = useMemo(
    () => (Array.isArray(effectiveTopologyData.nodes) ? effectiveTopologyData.nodes : []),
    [effectiveTopologyData.nodes]
  );
  const links = useMemo(
    () => (Array.isArray(effectiveTopologyData.links) ? effectiveTopologyData.links : []),
    [effectiveTopologyData.links]
  );
  const crossLayerRelations = useMemo(
    () => (
      Array.isArray(effectiveTopologyData.crossLayerRelations)
        ? effectiveTopologyData.crossLayerRelations
        : []
    ),
    [effectiveTopologyData.crossLayerRelations]
  );

  const markerRefsById = useRef({});
  const linkPolylineRefsById = useRef({});
  const nodeStateRef = useRef(buildInitialNodeState(baseNodes));

  const mapRef = useRef(null);
  const nodeMapRef = useRef(buildNodeMap(baseNodes));

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [selectedLinkId, setSelectedLinkId] = useState(null);
  const [hoveredLinkId, setHoveredLinkId] = useState(null);
  const [focusedLinkId, setFocusedLinkId] = useState(null);
  const [focusRequestId, setFocusRequestId] = useState(null);
  const [mapViewMode, setMapViewMode] = useState('2d');
  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [enabledLayers, setEnabledLayers] = useState(() => LAYER_OPTIONS.map((item) => item.key));
  const nodeFocusTimerRef = useRef(null);
  const linkFocusTimerRef = useRef(null);
  const playbackFlashTimerRef = useRef(null);

  const enabledLayerSet = useMemo(() => new Set(enabledLayers), [enabledLayers]);

  const visibleNodes = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return baseNodes.filter((node) => {
      if (!enabledLayerSet.has(node.layer)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return (
        node.id.toLowerCase().includes(keyword) ||
        (node.name || '').toLowerCase().includes(keyword)
      );
    });
  }, [baseNodes, enabledLayerSet, searchKeyword]);

  const visibleNodeSet = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes]
  );

  const visibleLinks = useMemo(() => {
    return links.filter((link) => {
      return visibleNodeSet.has(link.from) && visibleNodeSet.has(link.to);
    });
  }, [links, visibleNodeSet]);

  useEffect(() => {
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    Object.keys(markerRefsById.current).forEach((nodeId) => {
      if (!visibleNodeIds.has(nodeId)) {
        delete markerRefsById.current[nodeId];
      }
    });
  }, [visibleNodes]);

  useEffect(() => {
    const visibleLinkIds = new Set(visibleLinks.map((link) => link.id));
    Object.keys(linkPolylineRefsById.current).forEach((linkId) => {
      if (!visibleLinkIds.has(linkId)) {
        delete linkPolylineRefsById.current[linkId];
      }
    });
  }, [visibleLinks]);

  useEffect(() => {
    const validNodeIds = new Set(baseNodes.map((node) => node.id));
    setNodeDetailsById((prev) => {
      const keys = Object.keys(prev);
      if (!keys.length) {
        return prev;
      }
      let changed = false;
      const next = {};
      keys.forEach((nodeId) => {
        if (validNodeIds.has(nodeId)) {
          next[nodeId] = prev[nodeId];
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [baseNodes]);

  useEffect(() => {
    const validLinkIds = new Set(links.map((link) => link.id));
    setLinkDetailsById((prev) => {
      const keys = Object.keys(prev);
      if (!keys.length) {
        return prev;
      }
      let changed = false;
      const next = {};
      keys.forEach((linkId) => {
        if (validLinkIds.has(linkId)) {
          next[linkId] = prev[linkId];
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [links]);

  const commandSourceNodes = useMemo(() => {
    const fromBackend = baseNodes.filter((node) => !node?.synthetic);
    return fromBackend.length ? fromBackend : baseNodes;
  }, [baseNodes]);

  const nodeSelectionOptions = useMemo(() => {
    const options = commandSourceNodes
      .map((node) => {
        const id = String(node?.id || '').trim();
        if (!id) {
          return null;
        }
        const name = String(node?.name || id).trim() || id;
        return {
          id,
          name,
          label: `${name} (${id})`,
          type: String(node?.type || '').trim(),
          layer: String(node?.layer || '').trim(),
          status: String(node?.state?.status || '').trim(),
        };
      })
      .filter(Boolean);

    options.sort((left, right) => left.label.localeCompare(right.label));
    return options;
  }, [commandSourceNodes]);

  const existingNodeIdSet = useMemo(() => {
    const allIds = baseNodes
      .map((item) => String(item?.id || '').trim().toLowerCase())
      .filter((item) => !!item);
    return new Set(allIds);
  }, [baseNodes]);

  const addNodeTypeOptions = useMemo(() => {
    const fromNodes = nodeSelectionOptions.map((item) => item.type);
    return buildOrderedUniqueValues(fromNodes, [
      ...XDU_CAMPUS_DEVICE_TYPE_OPTIONS.map((item) => item.value),
      'iot-device',
    ]);
  }, [nodeSelectionOptions]);

  const addNodeLayerOptions = useMemo(() => {
    const fromNodes = nodeSelectionOptions.map((item) => item.layer);
    return buildOrderedUniqueValues(fromNodes, LAYER_OPTIONS.map((item) => item.key));
  }, [nodeSelectionOptions]);

  const addNodeStatusOptions = useMemo(() => {
    const fromNodes = nodeSelectionOptions.map((item) => item.status);
    return buildOrderedUniqueValues(fromNodes, ['normal', 'online', 'busy', 'warning', 'offline', 'error']);
  }, [nodeSelectionOptions]);

  const legendNodeTypeItems = useMemo(() => {
    const baselineOrder = [
      'network-center',
      'campus-gateway',
      'building-gateway',
      'edge-server',
      'camera',
      'env-sensor',
      'access-control',
      'smart-meter',
      'parking-sensor',
      'iot-device',
    ];
    const allKeys = buildOrderedUniqueValues(
      baseNodes.map((node) => node.type),
      baselineOrder
    );
    return allKeys.slice(0, 10).map((key) => ({
      key,
      label: getNodeTypeLabel(key),
      color: NODE_TYPE_META[key]?.color || '#94a3b8',
      badge: NODE_TYPE_META[key]?.badge || 'Io',
    }));
  }, [baseNodes]);

  const filteredAttachOptions = useMemo(() => {
    const keyword = addAttachSearch.trim().toLowerCase();
    const currentNodeId = addNodeForm.nodeId.trim().toLowerCase();
    const filtered = nodeSelectionOptions.filter((item) => {
      if (item.id.toLowerCase() === currentNodeId) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return item.id.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword);
    });

    if (
      addNodeForm.attachTo &&
      !filtered.some((item) => item.id === addNodeForm.attachTo)
    ) {
      const selected = nodeSelectionOptions.find((item) => item.id === addNodeForm.attachTo);
      if (selected) {
        return [selected, ...filtered];
      }
    }

    return filtered;
  }, [addAttachSearch, addNodeForm.attachTo, addNodeForm.nodeId, nodeSelectionOptions]);

  const filteredRemoveOptions = useMemo(() => {
    const keyword = removeNodeSearch.trim().toLowerCase();
    const filtered = nodeSelectionOptions.filter((item) => {
      if (!keyword) {
        return true;
      }
      return item.id.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword);
    });

    if (removeNodeId && !filtered.some((item) => item.id === removeNodeId)) {
      const selected = nodeSelectionOptions.find((item) => item.id === removeNodeId);
      if (selected) {
        return [selected, ...filtered];
      }
    }

    return filtered;
  }, [nodeSelectionOptions, removeNodeId, removeNodeSearch]);

  const trimmedAddNodeId = addNodeForm.nodeId.trim();
  const isAddNodeIdDuplicate = trimmedAddNodeId
    ? existingNodeIdSet.has(trimmedAddNodeId.toLowerCase())
    : false;

  const selectedLink = useMemo(() => {
    const matched = visibleLinks.find((item) => item.id === selectedLinkId);
    if (!matched) {
      return null;
    }
    if (playbackMode === 'playback') {
      return matched;
    }
    return linkDetailsById[selectedLinkId] || matched;
  }, [linkDetailsById, playbackMode, selectedLinkId, visibleLinks]);

  const pathHighlightNodeIdSet = useMemo(() => {
    if (!pathAnalysisResult?.reachable || !Array.isArray(pathAnalysisResult.pathNodeIds)) {
      return new Set();
    }
    return new Set(pathAnalysisResult.pathNodeIds);
  }, [pathAnalysisResult]);

  const pathHighlightLinkIdSet = useMemo(() => {
    if (!pathAnalysisResult?.reachable || !Array.isArray(pathAnalysisResult.pathLinkIds)) {
      return new Set();
    }
    return new Set(pathAnalysisResult.pathLinkIds);
  }, [pathAnalysisResult]);

  const networkHealthPercent = useMemo(() => {
    const byScore = toFiniteNumberOrNull(effectiveSituationCurrent?.healthScore);
    if (byScore !== null) {
      return Math.max(0, Math.min(100, Math.round(byScore)));
    }
    const metric = toFiniteNumberOrNull(effectiveSituationCurrent?.pythonMetrics?.networkHealth);
    if (metric !== null) {
      return Math.max(0, Math.min(100, Math.round(metric * 100)));
    }
    return null;
  }, [effectiveSituationCurrent]);

  const backendConnectivityState = useMemo(() => {
    const pythonConnected = effectiveSituationCurrent?.pythonMetrics?.connected;
    if (typeof pythonConnected === 'boolean') {
      return pythonConnected;
    }
    if (typeof connectivityAnalysis?.connected === 'boolean') {
      return connectivityAnalysis.connected;
    }
    return null;
  }, [connectivityAnalysis, effectiveSituationCurrent]);

  const pathEndpointOptions = useMemo(() => nodeSelectionOptions, [nodeSelectionOptions]);

  const kpiData = useMemo(() => {
    const totalNodes = baseNodes.length;
    const onlineNodes = baseNodes.filter((node) => getNodeSeverity(node) !== 'critical').length;
    const activeAlerts = effectiveAlerts.filter((alertItem) => alertItem?.active !== false).length;

    const delayValues = links
      .map((link) => toFiniteNumberOrNull(link.delayMs))
      .filter((value) => value !== null);
    const lossValues = links
      .map((link) => toFiniteNumberOrNull(link.lossRate))
      .filter((value) => value !== null);
    const utilizationValues = links
      .map((link) => toFiniteNumberOrNull(link.utilization))
      .filter((value) => value !== null);

    const avgDelayFromLinks = delayValues.length
      ? delayValues.reduce((sum, value) => sum + value, 0) / delayValues.length
      : null;
    const avgLossFromLinks = lossValues.length
      ? lossValues.reduce((sum, value) => sum + value, 0) / lossValues.length
      : null;
    const avgUtilizationFromLinks = utilizationValues.length
      ? utilizationValues.reduce((sum, value) => sum + value, 0) / utilizationValues.length
      : null;

    const pythonMetrics = effectiveSituationCurrent?.pythonMetrics || {};
    const avgDelay = toFiniteNumberOrNull(pythonMetrics.avgDelay) ?? avgDelayFromLinks;
    const avgLoss = toFiniteNumberOrNull(pythonMetrics.avgLoss) ?? avgLossFromLinks;
    const avgUtilization =
      toFiniteNumberOrNull(pythonMetrics.avgUtilization) ??
      toFiniteNumberOrNull(pythonMetrics.avgLoad) ??
      avgUtilizationFromLinks;

    return {
      totalNodes,
      onlineNodes,
      activeAlerts,
      avgDelay,
      avgLoss,
      avgUtilization,
    };
  }, [baseNodes, effectiveAlerts, effectiveSituationCurrent, links]);

  useEffect(() => {
    if (playbackMode !== 'live' || !lastRefreshAt) {
      return;
    }

    const appendPoint = (series, value) => {
      if (!Number.isFinite(value)) {
        return series;
      }
      const nextSeries = [...series, value];
      if (nextSeries.length > KPI_HISTORY_MAX_POINTS) {
        return nextSeries.slice(nextSeries.length - KPI_HISTORY_MAX_POINTS);
      }
      return nextSeries;
    };

    setKpiHistory((prev) => ({
      onlineNodes: appendPoint(prev.onlineNodes, kpiData.onlineNodes),
      activeAlerts: appendPoint(prev.activeAlerts, kpiData.activeAlerts),
      avgDelay: appendPoint(prev.avgDelay, kpiData.avgDelay),
      avgLoss: appendPoint(prev.avgLoss, kpiData.avgLoss),
      avgUtilization: appendPoint(prev.avgUtilization, kpiData.avgUtilization),
    }));
  }, [
    kpiData.activeAlerts,
    kpiData.avgDelay,
    kpiData.avgLoss,
    kpiData.avgUtilization,
    kpiData.onlineNodes,
    lastRefreshAt,
    playbackMode,
  ]);

  const kpiTrend = useMemo(() => ({
    onlineNodes: getTrendDirection(kpiHistory.onlineNodes),
    activeAlerts: getTrendDirection(kpiHistory.activeAlerts),
    avgDelay: getTrendDirection(kpiHistory.avgDelay),
    avgLoss: getTrendDirection(kpiHistory.avgLoss),
    avgUtilization: getTrendDirection(kpiHistory.avgUtilization),
  }), [kpiHistory]);

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

    const focusedBoost = focusedNodeId === nodeId ? 320 : 0;
    const selectedBoost = selectedNodeId === nodeId ? 220 : 0;
    const hoverBoost = hoveredNodeId === nodeId ? 120 : 0;
    marker.setZIndexOffset(liftPx + focusedBoost + selectedBoost + hoverBoost);
  }, [focusedNodeId, getDynamicNodeAltitude, hoveredNodeId, mapViewMode, selectedNodeId]);

  const applyMarkerInteractiveVisual = useCallback((marker, nodeId) => {
    if (!marker) {
      return;
    }
    const markerElement = marker.getElement?.();
    if (!markerElement) {
      return;
    }
    const isFocused = focusedNodeId === nodeId;
    const isSelected = selectedNodeId === nodeId;
    const isHovered = hoveredNodeId === nodeId && !isSelected && !isFocused;
    const isPathNode = pathHighlightNodeIdSet.has(nodeId);
    markerElement.classList.toggle('node-marker--focused', isFocused);
    markerElement.classList.toggle('node-marker--hover', isHovered);
    markerElement.classList.toggle('node-marker--selected', isSelected);
    markerElement.classList.toggle('node-marker--path', isPathNode && !isFocused && !isSelected);
    markerElement.style.cursor = 'pointer';
  }, [focusedNodeId, hoveredNodeId, pathHighlightNodeIdSet, selectedNodeId]);

  useEffect(() => {
    nodeMapRef.current = buildNodeMap(baseNodes);
    nodeStateRef.current = buildInitialNodeState(baseNodes);
  }, [baseNodes]);

  useEffect(() => {
    if (!nodeSelectionOptions.length) {
      setAddNodeForm((prev) => {
        if (!prev.attachTo) {
          return prev;
        }
        return {
          ...prev,
          attachTo: '',
        };
      });
      setRemoveNodeId('');
      setPathAnalysisForm({
        fromNodeId: '',
        toNodeId: '',
      });
      setPathAnalysisResult(null);
      return;
    }

    setAddNodeForm((prev) => {
      if (prev.attachTo && nodeSelectionOptions.some((item) => item.id === prev.attachTo)) {
        return prev;
      }
      return {
        ...prev,
        attachTo: nodeSelectionOptions[0].id,
      };
    });

    setRemoveNodeId((prev) => {
      if (prev && nodeSelectionOptions.some((item) => item.id === prev)) {
        return prev;
      }
      return '';
    });

    setPathAnalysisForm((prev) => {
      const validFrom = prev.fromNodeId && nodeSelectionOptions.some((item) => item.id === prev.fromNodeId);
      const validTo = prev.toNodeId && nodeSelectionOptions.some((item) => item.id === prev.toNodeId);
      const fallbackFrom = nodeSelectionOptions[0]?.id || '';
      const fallbackTo =
        nodeSelectionOptions.find((item) => item.id !== fallbackFrom)?.id || fallbackFrom;
      const nextFrom = validFrom ? prev.fromNodeId : fallbackFrom;
      const nextTo = validTo && prev.toNodeId !== nextFrom
        ? prev.toNodeId
        : (fallbackTo === nextFrom ? '' : fallbackTo);
      if (nextFrom === prev.fromNodeId && nextTo === prev.toNodeId) {
        return prev;
      }
      return {
        fromNodeId: nextFrom,
        toNodeId: nextTo,
      };
    });
  }, [nodeSelectionOptions]);

  const loadTopologyFromApi = useCallback(async () => {
    const topology = await getTopology();
    const campusTopology = applyXduCampusPreset(topology || {});
    setTopologyData({
      nodes: Array.isArray(campusTopology?.nodes) ? campusTopology.nodes : [],
      links: Array.isArray(campusTopology?.links) ? campusTopology.links : [],
      crossLayerRelations: Array.isArray(campusTopology?.crossLayerRelations)
        ? campusTopology.crossLayerRelations
        : [],
    });
  }, []);

  const loadSituationAndEventsFromApi = useCallback(async () => {
    const [situation, eventItems, alertItems, connectivityPayload] = await Promise.all([
      getSituationCurrent(),
      getEvents(EVENT_FETCH_LIMIT),
      getAlerts(ALERT_FETCH_LIMIT, true).catch(() => []),
      getConnectivityAnalysis()
        .then((data) => ({ data, error: '' }))
        .catch((error) => ({ data: null, error: error?.message || 'Connectivity analysis unavailable' })),
    ]);
    setSituationCurrent(situation || null);
    setConnectivityAnalysis(connectivityPayload?.data || null);
    setConnectivityError(connectivityPayload?.error || '');
    const normalizedEvents = toLimitedList(eventItems, EVENT_LIST_MAX_ITEMS)
      .map((eventItem, index) => compactEventItem(eventItem, index))
      .filter(Boolean);
    const normalizedAlerts = toLimitedList(alertItems, ALERT_LIST_MAX_ITEMS)
      .map((alertItem, index) => compactAlertItem(alertItem, index))
      .filter(Boolean);
    setEvents(normalizedEvents);
    setAlerts(normalizedAlerts);
  }, []);

  const loadPlaybackFramesFromApi = useCallback(async (limit = PLAYBACK_FRAME_FETCH_LIMIT) => {
    const playbackPayload = await getPlaybackFrames(limit);
    const rawFrames = Array.isArray(playbackPayload?.frames) ? playbackPayload.frames : [];
    const limitedFrames = toLimitedList(rawFrames, PLAYBACK_FRAME_FETCH_LIMIT);
    return limitedFrames.map((frame) => {
      const campusTopology = applyXduCampusPreset(frame?.topology || {});
      return {
        timestamp: frame?.timestamp || null,
        topology: {
          meta: campusTopology?.meta || null,
          nodes: Array.isArray(campusTopology?.nodes) ? campusTopology.nodes : [],
          links: Array.isArray(campusTopology?.links) ? campusTopology.links : [],
          crossLayerRelations: Array.isArray(campusTopology?.crossLayerRelations)
            ? campusTopology.crossLayerRelations
            : [],
        },
        situation: frame?.situation || null,
        events: toLimitedList(frame?.events, EVENT_LIST_MAX_ITEMS)
          .map((eventItem, index) => compactEventItem(eventItem, index))
          .filter(Boolean),
        alerts: toLimitedList(frame?.alerts, ALERT_LIST_MAX_ITEMS)
          .map((alertItem, index) => compactAlertItem(alertItem, index))
          .filter(Boolean),
      };
    });
  }, []);

  const refreshAllData = useCallback(async ({ silent = false } = {}) => {
    if (playbackMode === 'playback') {
      return;
    }
    if (refreshInFlightRef.current) {
      return;
    }
    refreshInFlightRef.current = true;
    if (!silent) {
      setIsRefreshing(true);
    }

    let topologyLoaded = false;
    let situationLoaded = false;
    let topologyError = null;
    let situationError = null;

    try {
      await loadTopologyFromApi();
      topologyLoaded = true;
      setDataSource('api');
    } catch (error) {
      topologyError = error;
    }

    try {
      await loadSituationAndEventsFromApi();
      situationLoaded = true;
    } catch (error) {
      situationError = error;
    }

    if (!topologyLoaded && !situationLoaded) {
      setDataSource((prev) => (prev === 'api' ? prev : 'mock'));
    }

    const firstError = topologyError || situationError;
    if (firstError) {
      setApiError(firstError?.message || 'Failed to refresh data from REST API');
    } else {
      setApiError('');
    }

    if (topologyLoaded || situationLoaded) {
      setLastRefreshAt(new Date().toISOString());
    }

    if (!silent) {
      setIsRefreshing(false);
    }
    refreshInFlightRef.current = false;
  }, [loadSituationAndEventsFromApi, loadTopologyFromApi, playbackMode]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  useEffect(() => {
    if (playbackMode !== 'live') {
      return undefined;
    }
    const timer = setInterval(() => {
      refreshAllData({ silent: true });
    }, POLLING_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [playbackMode, refreshAllData]);

  useEffect(() => {
    if (playbackMode !== 'playback') {
      setPlaybackPlaying(false);
      return;
    }
    if (!playbackFrames.length) {
      setPlaybackPlaying(false);
      setPlaybackFrameIndex(0);
      return;
    }
    if (playbackFrameIndex >= playbackFrames.length) {
      setPlaybackFrameIndex(playbackFrames.length - 1);
    }
  }, [playbackFrameIndex, playbackFrames.length, playbackMode]);

  useEffect(() => {
    if (playbackMode !== 'playback' || !playbackPlaying) {
      return undefined;
    }

    const timer = setInterval(() => {
      setPlaybackFrameIndex((prev) => {
        if (prev >= playbackFrames.length - 1) {
          setPlaybackPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, PLAYBACK_STEP_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [playbackFrames.length, playbackMode, playbackPlaying]);

  useEffect(() => {
    if (playbackMode !== 'live') {
      return;
    }
    refreshAllData({ silent: true });
  }, [playbackMode, refreshAllData]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CONTROL_PANEL_COLLAPSED_STORAGE_KEY,
        controlPanelCollapsed ? '1' : '0'
      );
    } catch (_error) {
      // Ignore localStorage errors in restricted environments.
    }
  }, [controlPanelCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        MAP_LEGEND_COLLAPSED_STORAGE_KEY,
        mapLegendCollapsed ? '1' : '0'
      );
    } catch (_error) {
      // Ignore localStorage errors in restricted environments.
    }
  }, [mapLegendCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CONTROL_PANEL_SECTIONS_STORAGE_KEY,
        JSON.stringify(controlPanelSections)
      );
    } catch (_error) {
      // Ignore localStorage errors in restricted environments.
    }
  }, [controlPanelSections]);

  useEffect(() => {
    if (!mapRef.current?.invalidateSize) {
      return undefined;
    }
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize?.();
    }, 320);
    return () => clearTimeout(timer);
  }, [controlPanelCollapsed]);

  useEffect(() => {
    return () => {
      if (nodeFocusTimerRef.current) {
        clearTimeout(nodeFocusTimerRef.current);
      }
      if (linkFocusTimerRef.current) {
        clearTimeout(linkFocusTimerRef.current);
      }
      if (playbackFlashTimerRef.current) {
        clearTimeout(playbackFlashTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (playbackMode !== 'playback' || !playbackFrames.length) {
      setPlaybackFrameFlash(false);
      return;
    }
    setPlaybackFrameFlash(true);
    if (playbackFlashTimerRef.current) {
      clearTimeout(playbackFlashTimerRef.current);
    }
    playbackFlashTimerRef.current = setTimeout(() => {
      setPlaybackFrameFlash(false);
      playbackFlashTimerRef.current = null;
    }, 260);
  }, [playbackFrameIndex, playbackFrames.length, playbackMode]);

  useEffect(() => {
    if (playbackMode === 'playback') {
      return undefined;
    }
    if (!selectedNodeId) {
      return undefined;
    }
    if (nodeDetailsById[selectedNodeId]) {
      return undefined;
    }

    let cancelled = false;

    getNodeById(selectedNodeId)
      .then((nodeDetail) => {
        if (!cancelled && nodeDetail) {
          const mappedNodeDetail = mapNodeToXduCampus(nodeDetail);
          setNodeDetailsById((prev) => upsertLimitedRecord(
            prev,
            selectedNodeId,
            mappedNodeDetail,
            NODE_DETAILS_CACHE_MAX_ITEMS
          ));
        }
      })
      .catch(() => {
        // Keep popup usable with base topology fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [nodeDetailsById, playbackMode, selectedNodeId]);

  useEffect(() => {
    if (playbackMode === 'playback') {
      return undefined;
    }
    if (!selectedLinkId) {
      return undefined;
    }
    if (linkDetailsById[selectedLinkId]) {
      return undefined;
    }

    let cancelled = false;

    getLinkById(selectedLinkId)
      .then((linkDetail) => {
        if (!cancelled && linkDetail) {
          setLinkDetailsById((prev) => upsertLimitedRecord(
            prev,
            selectedLinkId,
            linkDetail,
            LINK_DETAILS_CACHE_MAX_ITEMS
          ));
        }
      })
      .catch(() => {
        // Keep popup usable with base topology fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [linkDetailsById, playbackMode, selectedLinkId]);

  useEffect(() => {
    if (selectedNodeId && !visibleNodeSet.has(selectedNodeId)) {
      setSelectedNodeId(null);
      setFocusRequestId(null);
    }
  }, [selectedNodeId, visibleNodeSet]);

  useEffect(() => {
    if (hoveredNodeId && !visibleNodeSet.has(hoveredNodeId)) {
      setHoveredNodeId(null);
    }
  }, [hoveredNodeId, visibleNodeSet]);

  useEffect(() => {
    if (focusedNodeId && !visibleNodeSet.has(focusedNodeId)) {
      setFocusedNodeId(null);
    }
  }, [focusedNodeId, visibleNodeSet]);

  useEffect(() => {
    if (selectedLinkId && !visibleLinks.some((item) => item.id === selectedLinkId)) {
      setSelectedLinkId(null);
    }
  }, [selectedLinkId, visibleLinks]);

  useEffect(() => {
    if (hoveredLinkId && !visibleLinks.some((item) => item.id === hoveredLinkId)) {
      setHoveredLinkId(null);
    }
  }, [hoveredLinkId, visibleLinks]);

  useEffect(() => {
    if (focusedLinkId && !visibleLinks.some((item) => item.id === focusedLinkId)) {
      setFocusedLinkId(null);
    }
  }, [focusedLinkId, visibleLinks]);

  const startNodeFocusPulse = useCallback((nodeId) => {
    if (!nodeId) {
      return;
    }
    setFocusedNodeId(nodeId);
    if (nodeFocusTimerRef.current) {
      clearTimeout(nodeFocusTimerRef.current);
    }
    nodeFocusTimerRef.current = setTimeout(() => {
      setFocusedNodeId((prev) => (prev === nodeId ? null : prev));
      nodeFocusTimerRef.current = null;
    }, FOCUS_PULSE_DURATION_MS);
  }, []);

  const startLinkFocusPulse = useCallback((linkId) => {
    if (!linkId) {
      return;
    }
    setFocusedLinkId(linkId);
    if (linkFocusTimerRef.current) {
      clearTimeout(linkFocusTimerRef.current);
    }
    linkFocusTimerRef.current = setTimeout(() => {
      setFocusedLinkId((prev) => (prev === linkId ? null : prev));
      linkFocusTimerRef.current = null;
    }, FOCUS_PULSE_DURATION_MS);
  }, []);

  const focusMapToLink = useCallback((linkId) => {
    if (!linkId) {
      return;
    }
    const map = mapRef.current;
    if (!map?.flyToBounds) {
      return;
    }
    const matchedLink = links.find((item) => item.id === linkId);
    if (!matchedLink) {
      return;
    }
    const fromPosition = getDynamicNodePosition(matchedLink.from);
    const toPosition = getDynamicNodePosition(matchedLink.to);
    if (!fromPosition || !toPosition) {
      return;
    }
    const bounds = L.latLngBounds([fromPosition, toPosition]);
    map.flyToBounds(bounds, {
      padding: [70, 70],
      maxZoom: 15,
      duration: 0.8,
    });
  }, [getDynamicNodePosition, links]);

  const focusMapToNodeIds = useCallback((nodeIds) => {
    if (!Array.isArray(nodeIds) || !nodeIds.length) {
      return;
    }
    const map = mapRef.current;
    if (!map?.flyToBounds) {
      return;
    }
    const positions = nodeIds
      .map((nodeId) => getDynamicNodePosition(nodeId))
      .filter(Boolean);
    if (!positions.length) {
      return;
    }
    if (positions.length === 1) {
      map.flyTo(positions[0], Math.max(map.getZoom?.() || 13, 15), {
        duration: 0.75,
        easeLinearity: 0.25,
      });
      return;
    }
    const bounds = L.latLngBounds(positions);
    map.flyToBounds(bounds, {
      padding: [70, 70],
      maxZoom: 15,
      duration: 0.8,
    });
  }, [getDynamicNodePosition]);

  const handleToggleSidebar = useCallback((value) => {
    const nextCollapsed = !!value;
    setSidebarCollapsed(nextCollapsed);
    if (nextCollapsed) {
      setSelectedNodeId(null);
      setFocusRequestId(null);
      setFocusedNodeId(null);
    }
  }, []);

  const handleSelectNode = useCallback((nodeId) => {
    setSelectedLinkId(null);
    setFocusedLinkId(null);
    setSelectedNodeId(nodeId);
    setFocusRequestId(nodeId);
    startNodeFocusPulse(nodeId);
  }, [startNodeFocusPulse]);

  const handleAlertFocus = useCallback((alertItem) => {
    if (!alertItem || typeof alertItem !== 'object') {
      return;
    }
    if (alertItem.entityType === 'node' && alertItem.entityId) {
      setSelectedLinkId(null);
      setFocusedLinkId(null);
      setSelectedNodeId(alertItem.entityId);
      setFocusRequestId(alertItem.entityId);
      startNodeFocusPulse(alertItem.entityId);
      return;
    }
    if (alertItem.entityType === 'link' && alertItem.entityId) {
      setSelectedNodeId(null);
      setFocusedNodeId(null);
      setFocusRequestId(null);
      setSelectedLinkId(alertItem.entityId);
      startLinkFocusPulse(alertItem.entityId);
      focusMapToLink(alertItem.entityId);
    }
  }, [focusMapToLink, startLinkFocusPulse, startNodeFocusPulse]);

  const handleLayerToggle = useCallback((layerKey) => {
    setEnabledLayers((prev) => {
      if (prev.includes(layerKey)) {
        return prev.filter((item) => item !== layerKey);
      }
      return [...prev, layerKey];
    });
  }, []);

  const handleSearchSubmit = useCallback(() => {
    const keyword = searchInput.trim().toLowerCase();
    setSearchKeyword(keyword);

    const matchedNodes = baseNodes.filter((node) => {
      if (!enabledLayerSet.has(node.layer)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return (
        node.id.toLowerCase().includes(keyword) ||
        (node.name || '').toLowerCase().includes(keyword)
      );
    });

    if (!matchedNodes.length) {
      setSelectedNodeId(null);
      setFocusRequestId(null);
      setFocusedNodeId(null);
      return;
    }

    setSelectedLinkId(null);
    setFocusedLinkId(null);
    setSelectedNodeId(matchedNodes[0].id);
    setFocusRequestId(matchedNodes[0].id);
    startNodeFocusPulse(matchedNodes[0].id);
  }, [baseNodes, enabledLayerSet, searchInput, startNodeFocusPulse]);

  const handleFocusConsumed = useCallback(() => {
    setFocusRequestId(null);
  }, []);

  const handleToggleMapViewMode = useCallback(() => {
    setMapViewMode((prev) => (prev === '2d' ? '3d' : '2d'));
  }, []);

  const handleToggleControlPanel = useCallback(() => {
    setControlPanelCollapsed((prev) => !prev);
  }, []);

  const handleToggleLegend = useCallback(() => {
    setMapLegendCollapsed((prev) => !prev);
  }, []);

  const handleToggleControlSection = useCallback((sectionKey) => {
    setControlPanelSections((prev) => ({
      ...prev,
      [sectionKey]: !(prev[sectionKey] ?? CONTROL_PANEL_SECTION_DEFAULTS[sectionKey]),
    }));
  }, []);

  const handleManualRefresh = useCallback(() => {
    refreshAllData();
  }, [refreshAllData]);

  const handleTogglePlaybackMode = useCallback(async () => {
    if (playbackMode === 'playback') {
      setPlaybackPlaying(false);
      setPlaybackError('');
      setPlaybackFrames([]);
      setPlaybackFrameIndex(0);
      setPlaybackMode('live');
      return;
    }

    setPlaybackLoading(true);
    setPlaybackPlaying(false);
    setPlaybackError('');
    try {
      const frames = await loadPlaybackFramesFromApi(PLAYBACK_FRAME_FETCH_LIMIT);
      if (!frames.length) {
        setPlaybackError('No playback frames available yet. Please wait for polling to collect frames.');
        return;
      }

      setPlaybackFrames(toLimitedList(frames, PLAYBACK_FRAME_FETCH_LIMIT));
      setPlaybackFrameIndex(Math.max(0, frames.length - 1));
      setPlaybackMode('playback');
      setPlaybackError('');
    } catch (error) {
      setPlaybackError(error?.message || 'Failed to load playback frames');
    } finally {
      setPlaybackLoading(false);
    }
  }, [loadPlaybackFramesFromApi, playbackMode]);

  const handlePlaybackPlayPause = useCallback(() => {
    if (playbackMode !== 'playback' || !playbackFrames.length) {
      return;
    }
    if (!playbackPlaying && playbackFrameIndex >= playbackFrames.length - 1) {
      setPlaybackFrameIndex(0);
    }
    setPlaybackPlaying((prev) => !prev);
  }, [playbackFrameIndex, playbackFrames.length, playbackMode, playbackPlaying]);

  const handlePlaybackPrevFrame = useCallback(() => {
    if (playbackMode !== 'playback' || !playbackFrames.length) {
      return;
    }
    setPlaybackPlaying(false);
    setPlaybackFrameIndex((prev) => Math.max(0, prev - 1));
  }, [playbackFrames.length, playbackMode]);

  const handlePlaybackNextFrame = useCallback(() => {
    if (playbackMode !== 'playback' || !playbackFrames.length) {
      return;
    }
    setPlaybackPlaying(false);
    setPlaybackFrameIndex((prev) => Math.min(playbackFrames.length - 1, prev + 1));
  }, [playbackFrames.length, playbackMode]);

  const handlePlaybackSliderChange = useCallback((event) => {
    const nextIndex = Number.parseInt(event.target.value, 10);
    if (!Number.isFinite(nextIndex)) {
      return;
    }
    setPlaybackPlaying(false);
    setPlaybackFrameIndex(nextIndex);
  }, []);

  const submitPythonCommand = useCallback(async (command, options = {}) => {
    const action = String(options.action || command?.type || 'command');
    if (commandBusy) {
      return false;
    }
    setCommandBusy(true);
    setCommandBusyAction(action);
    setCommandResultKind('info');
    setCommandResult('');
    try {
      const created = await sendPythonCommand(command);

      if (typeof options.onSuccess === 'function') {
        options.onSuccess(created);
      }

      setCommandResultKind('success');
      setCommandResult(options.successMessage || `Queued ${created.type} (${created.id})`);
      await refreshAllData();
      return true;
    } catch (error) {
      setCommandResultKind('error');
      setCommandResult(error?.message || `Failed to queue ${action}`);
      return false;
    } finally {
      setCommandBusy(false);
      setCommandBusyAction('');
    }
  }, [commandBusy, refreshAllData]);

  const handleAddNodeIdChange = useCallback((event) => {
    const nextValue = event.target.value;
    setAddNodeForm((prev) => ({
      ...prev,
      nodeId: nextValue,
      nodeName: addNodeNameTouched ? prev.nodeName : nextValue.trim(),
    }));
  }, [addNodeNameTouched]);

  const handleAddNodeNameChange = useCallback((event) => {
    setAddNodeNameTouched(true);
    setAddNodeForm((prev) => ({
      ...prev,
      nodeName: event.target.value,
    }));
  }, []);

  const handleUseAttachNodeLocation = useCallback(() => {
    const selected = baseNodes.find((node) => node.id === addNodeForm.attachTo);
    const geo = selected?.location?.geo;
    const lat = toFiniteNumberOrNull(geo?.lat);
    const lng = toFiniteNumberOrNull(geo?.lng);

    if (lat === null || lng === null) {
      setCommandResultKind('error');
      setCommandResult('Selected attach node has no valid location');
      return;
    }

    setCommandResultKind('info');
    setCommandResult('');
    setAddNodeForm((prev) => ({
      ...prev,
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
      zone: selected?.campusZone || prev.zone,
      coordSystem: 'wgs84',
    }));
  }, [addNodeForm.attachTo, baseNodes]);

  const handleUseZoneLocation = useCallback(() => {
    const zone = String(addNodeForm.zone || '').trim() || DEFAULT_ADD_NODE_ZONE;
    const seed = addNodeForm.nodeId.trim() || `${zone}-${addNodeForm.type || 'campus-node'}`;
    const point = getCampusPointByZone(zone, seed, 0);
    setCommandResultKind('info');
    setCommandResult('');
    setAddNodeForm((prev) => ({
      ...prev,
      lat: Number(point.lat).toFixed(6),
      lng: Number(point.lng).toFixed(6),
      coordSystem: 'wgs84',
    }));
  }, [addNodeForm.nodeId, addNodeForm.type, addNodeForm.zone]);

  const handleAddNodeCommand = useCallback(async () => {
    const nodeId = addNodeForm.nodeId.trim();
    const nodeName = addNodeForm.nodeName.trim();
    const nodeType = String(addNodeForm.type || '').trim();
    const nodeLayer = String(addNodeForm.layer || '').trim();
    const nodeZone = String(addNodeForm.zone || '').trim();
    const nodeStatus = String(addNodeForm.status || '').trim();
    const coordSystem = String(addNodeForm.coordSystem || 'wgs84').trim().toLowerCase();
    const attachTo = String(addNodeForm.attachTo || '').trim();
    const online = !!addNodeForm.online;
    const nodeProfile = getAddNodeTypeProfile(nodeType);
    const backendNodeType = String(nodeProfile?.baseType || 'terminal');

    if (!nodeId) {
      setCommandResultKind('error');
      setCommandResult('Node ID is required');
      return;
    }
    if (!nodeName) {
      setCommandResultKind('error');
      setCommandResult('Node Name is required');
      return;
    }
    if (existingNodeIdSet.has(nodeId.toLowerCase())) {
      setCommandResultKind('error');
      setCommandResult(`Node ID "${nodeId}" already exists`);
      return;
    }
    if (!nodeType) {
      setCommandResultKind('error');
      setCommandResult('Type is required');
      return;
    }
    if (!nodeLayer) {
      setCommandResultKind('error');
      setCommandResult('Layer is required');
      return;
    }
    if (!nodeZone) {
      setCommandResultKind('error');
      setCommandResult('Site Zone is required');
      return;
    }
    if (!XDU_CAMPUS_ZONE_OPTIONS.some((item) => item.value === nodeZone)) {
      setCommandResultKind('error');
      setCommandResult('Site Zone is invalid');
      return;
    }
    if (!nodeStatus) {
      setCommandResultKind('error');
      setCommandResult('Status is required');
      return;
    }
    if (coordSystem !== 'wgs84' && coordSystem !== 'gcj02') {
      setCommandResultKind('error');
      setCommandResult('Coordinate system must be WGS84 or GCJ-02');
      return;
    }
    if (!attachTo) {
      setCommandResultKind('error');
      setCommandResult('Attach To is required');
      return;
    }
    if (!nodeSelectionOptions.some((item) => item.id === attachTo)) {
      setCommandResultKind('error');
      setCommandResult('Attach To target is invalid');
      return;
    }
    if (attachTo.toLowerCase() === nodeId.toLowerCase()) {
      setCommandResultKind('error');
      setCommandResult('Attach To cannot be the same as the new Node ID');
      return;
    }

    const lat = Number(addNodeForm.lat);
    const lng = Number(addNodeForm.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setCommandResultKind('error');
      setCommandResult('Latitude must be a valid number between -90 and 90');
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setCommandResultKind('error');
      setCommandResult('Longitude must be a valid number between -180 and 180');
      return;
    }

    const normalizedGeo = normalizeToWgs84({
      lng,
      lat,
      coordSystem,
    });
    const wgsLat = Number(normalizedGeo.lat);
    const wgsLng = Number(normalizedGeo.lng);
    if (!Number.isFinite(wgsLat) || !Number.isFinite(wgsLng)) {
      setCommandResultKind('error');
      setCommandResult('Failed to normalize coordinate to WGS84');
      return;
    }

    await submitPythonCommand(
      {
        type: 'node:add',
        payload: {
          node: {
            id: nodeId,
            name: nodeName,
            type: backendNodeType,
            layer: nodeLayer,
            campusZone: nodeZone,
            location: {
              geo: {
                lat: Number(wgsLat.toFixed(6)),
                lng: Number(wgsLng.toFixed(6)),
                altitude: 0,
              },
            },
            state: {
              online,
              status: nodeStatus,
            },
            energy: 80,
            capacity: 50,
            cpu: 0.2,
            load: 0.25,
            role: inferRoleForNewNode(nodeType),
          },
          attachTo,
        },
      },
      {
        action: 'add',
        successMessage: `Queued node:add (${nodeId})`,
        onSuccess: () => {
          setAddNodeNameTouched(false);
          setAddNodeForm((prev) => ({
            ...prev,
            nodeId: '',
            nodeName: '',
          }));
        },
      }
    );
  }, [addNodeForm, existingNodeIdSet, nodeSelectionOptions, submitPythonCommand]);

  const handleRemoveNodeCommand = useCallback(async () => {
    const nodeId = removeNodeId.trim();
    if (!nodeId) {
      setCommandResultKind('error');
      setCommandResult('Please select a node to remove');
      return;
    }

    const targetNode = nodeSelectionOptions.find((item) => item.id === nodeId);
    if (!targetNode) {
      setCommandResultKind('error');
      setCommandResult(`Node "${nodeId}" no longer exists in current topology`);
      return;
    }

    const confirmed = window.confirm(`Confirm removing node "${targetNode.name}" (${targetNode.id})?`);
    if (!confirmed) {
      return;
    }

    await submitPythonCommand(
      {
        type: 'node:remove',
        payload: {
          nodeId,
        },
      },
      {
        action: 'remove',
        successMessage: `Queued node:remove (${nodeId})`,
        onSuccess: () => {
          setRemoveNodeId('');
          setRemoveNodeSearch('');
          setNodeDetailsById((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, nodeId)) {
              return prev;
            }
            const next = { ...prev };
            delete next[nodeId];
            return next;
          });

          if (
            selectedNodeId === nodeId ||
            hoveredNodeId === nodeId ||
            focusedNodeId === nodeId ||
            focusRequestId === nodeId
          ) {
            setSelectedNodeId(null);
            setHoveredNodeId(null);
            setFocusedNodeId(null);
            setFocusRequestId(null);
          }
        },
      }
    );
  }, [focusRequestId, focusedNodeId, hoveredNodeId, nodeSelectionOptions, removeNodeId, selectedNodeId, submitPythonCommand]);

  const handleRunPathAnalysis = useCallback(async () => {
    if (playbackMode === 'playback') {
      setPathAnalysisError('Path analysis uses live backend topology. Switch to Live Mode first.');
      return;
    }

    const fromNodeId = String(pathAnalysisForm.fromNodeId || '').trim();
    const toNodeId = String(pathAnalysisForm.toNodeId || '').trim();
    if (!fromNodeId || !toNodeId) {
      setPathAnalysisError('Please select both source and destination nodes.');
      return;
    }

    if (!pathEndpointOptions.some((item) => item.id === fromNodeId)) {
      setPathAnalysisError('Selected source node is no longer available.');
      return;
    }
    if (!pathEndpointOptions.some((item) => item.id === toNodeId)) {
      setPathAnalysisError('Selected destination node is no longer available.');
      return;
    }

    setPathAnalysisLoading(true);
    setPathAnalysisError('');
    try {
      const result = await getShortestPathAnalysis(fromNodeId, toNodeId);
      setPathAnalysisResult(result || null);

      if (!result?.reachable) {
        setPathAnalysisError('No reachable path found between selected nodes.');
        return;
      }

      const pathNodes = Array.isArray(result.pathNodeIds) ? result.pathNodeIds : [];
      if (pathNodes.length) {
        setSelectedLinkId(null);
        setFocusedLinkId(null);
        setFocusRequestId(pathNodes[0]);
        setSelectedNodeId(pathNodes[0]);
        startNodeFocusPulse(pathNodes[0]);
        focusMapToNodeIds(pathNodes);
      }
    } catch (error) {
      setPathAnalysisResult(null);
      setPathAnalysisError(error?.message || 'Path analysis request failed.');
    } finally {
      setPathAnalysisLoading(false);
    }
  }, [focusMapToNodeIds, pathAnalysisForm.fromNodeId, pathAnalysisForm.toNodeId, pathEndpointOptions, playbackMode, startNodeFocusPulse]);

  const handleClearPathAnalysis = useCallback(() => {
    setPathAnalysisResult(null);
    setPathAnalysisError('');
  }, []);

  useEffect(() => {
    Object.entries(markerRefsById.current).forEach(([nodeId, marker]) => {
      applyMarkerAltitudeVisual(marker, nodeId);
      applyMarkerInteractiveVisual(marker, nodeId);
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
  }, [applyMarkerAltitudeVisual, applyMarkerInteractiveVisual, getDynamicNodeAltitude, getDynamicNodePosition, links, mapViewMode]);

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
        Object.values(markerRefsById.current).forEach((marker) => {
          marker?.closePopup?.();
          marker?.setZIndexOffset?.(0);
        });
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
        cleanupTimer = setTimeout(openPopup, 160);
      } else {
        cleanupTimer = setTimeout(openPopup, 320);
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

      const dynState = nodeStateRef.current[nodeId];
      const nodePosition = dynState?.location?.geo
        ? [dynState.location.geo.lat, dynState.location.geo.lng]
        : getNodePosition(nodeMapRef.current[nodeId]);

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

  const nodeHaloElements = useMemo(() => visibleNodes.map((node) => {
    const position = getNodePosition(node);
    if (!position) {
      return null;
    }

    const isFocused = focusedNodeId === node.id;
    const isSelected = selectedNodeId === node.id;
    const isHovered = hoveredNodeId === node.id && !isSelected && !isFocused;
    const isPathNode = pathHighlightNodeIdSet.has(node.id);
    const dynamicNode = nodeStateRef.current[node.id];
    const statusSource = dynamicNode && dynamicNode.state
      ? { ...node, state: dynamicNode.state }
      : node;
    const nodeStatusColor = getNodeSeverityColor(statusSource);

    return (
      <CircleMarker
        key={`halo-${node.id}`}
        center={position}
        radius={isFocused
          ? (isSelected ? 24 : 22)
          : (isSelected ? 21 : (isPathNode ? 18 : (isHovered ? 17 : 12)))}
        pathOptions={{
          color: nodeStatusColor,
          weight: isFocused ? 3.4 : (isSelected ? 2.8 : (isPathNode ? 2.4 : (isHovered ? 2.2 : 1.2))),
          opacity: isFocused ? 1 : (isSelected ? 0.95 : (isPathNode ? 0.82 : (isHovered ? 0.76 : 0.45))),
          fillColor: isPathNode ? '#38bdf8' : nodeStatusColor,
          fillOpacity: isFocused ? 0.26 : (isSelected ? 0.22 : (isPathNode ? 0.16 : (isHovered ? 0.12 : 0.08))),
          className: `node-halo${isHovered ? ' node-halo--hover' : ''}${isSelected ? ' node-halo--selected' : ''}${isFocused ? ' node-halo--focused' : ''}${isPathNode ? ' node-halo--path' : ''}`,
          interactive: false,
        }}
      />
    );
  }), [focusedNodeId, hoveredNodeId, pathHighlightNodeIdSet, selectedNodeId, visibleNodes]);

  const markerElements = useMemo(() => visibleNodes.map((node) => {
    const popupNode = playbackMode === 'playback' ? node : (nodeDetailsById[node.id] || node);
    const typeMeta = NODE_TYPE_META[popupNode.type] || { label: popupNode.type || 'Unknown', color: '#7f7f7f' };
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
          click: (event) => {
            handleSelectNode(node.id);
            event.target?.openPopup?.();
          },
          popupclose: () => {
            setSelectedNodeId((prev) => (prev === node.id ? null : prev));
            setFocusRequestId((prev) => (prev === node.id ? null : prev));
          },
          mouseover: () => setHoveredNodeId(node.id),
          mouseout: () => {
            setHoveredNodeId((prev) => (prev === node.id ? null : prev));
          },
        }}
        ref={(marker) => {
          if (marker) {
            markerRefsById.current[node.id] = marker;
            applyMarkerAltitudeVisual(marker, node.id);
            applyMarkerInteractiveVisual(marker, node.id);
          } else {
            delete markerRefsById.current[node.id];
          }
        }}
      >
        <Popup>
          <NodePopupContent
            node={popupNode}
            typeMeta={typeMeta}
            nodeStateRef={nodeStateRef}
          />
        </Popup>
      </Marker>
    );
  }), [applyMarkerAltitudeVisual, applyMarkerInteractiveVisual, handleSelectNode, nodeDetailsById, playbackMode, visibleNodes]);

  const linkElements = useMemo(() => visibleLinks.map((link) => {
    const linkDetail = playbackMode === 'playback' ? link : (linkDetailsById[link.id] || link);
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

    const healthColor = getLinkHealthColor(linkDetail);
    const isPathLink = pathHighlightLinkIdSet.has(link.id);
    const isFlowAnimated = hoveredLinkId === link.id || selectedLinkId === link.id || focusedLinkId === link.id;
    const flowClass = [
      'link-line',
      'link-line--flow',
      isFlowAnimated ? 'link-line--flow-active' : '',
      isFlowAnimated ? getLinkFlowSpeedClass(link) : '',
    ].filter(Boolean).join(' ');
    const baseOpacity = typeof link.availability === 'number'
      ? Math.min(1, Math.max(0.4, link.availability))
      : 0.8;
    const linkState = String(linkDetail?.state || link?.state || 'up').toLowerCase();
    const isLinkDown = linkState !== 'up';
    const linkDashArray = isLinkDown ? '10 10' : null;
    const healthOpacity = isLinkDown ? Math.min(baseOpacity, 0.55) : baseOpacity;
    const flowOpacity = isLinkDown ? 0.55 : undefined;

    const healthLineRefCallback = (polyline) => {
      if (polyline && !linkPolylineRefsById.current[link.id]) {
        linkPolylineRefsById.current[link.id] = [];
      }
      if (polyline && linkPolylineRefsById.current[link.id]) {
        linkPolylineRefsById.current[link.id][0] = polyline;
      }
    };

    const flowLineRefCallback = (polyline) => {
      if (polyline && !linkPolylineRefsById.current[link.id]) {
        linkPolylineRefsById.current[link.id] = [];
      }
      if (polyline && linkPolylineRefsById.current[link.id]) {
        linkPolylineRefsById.current[link.id][1] = polyline;
      }
    };

    const baseLinkStyle = getLinkStyle(link);
    const isFocusedLink = focusedLinkId === link.id;
    const isSelectedLink = selectedLinkId === link.id;
    const isHoveredLink = hoveredLinkId === link.id && !isSelectedLink && !isFocusedLink;
    const highlightWeight = isSelectedLink ? 5.2 : (isFocusedLink ? 4.8 : (isHoveredLink ? 4.1 : 3));
    const linkStateClass = `${isHoveredLink ? ' link-line--hover' : ''}${isSelectedLink ? ' link-line--selected' : ''}${isFocusedLink ? ' link-line--focused' : ''}${isPathLink ? ' link-line--path' : ''}`;

    const linkPopupContent = (
      <Popup>
        <div className="text-sm text-slate-900">
          <div className="text-base font-semibold">Link {linkDetail.id}</div>
          <div className="mt-1">From: {linkDetail.from}</div>
          <div>To: {linkDetail.to}</div>
          <div>Type: {linkDetail.type}</div>
          <div>State: {linkState}</div>
          <div>Health: {String(linkDetail.health || '-')}</div>
          <div>Bandwidth: {linkDetail.bandwidthMbps ?? '-'} Mbps</div>
          <div>Delay: {linkDetail.delayMs ?? '-'} ms</div>
          <div>Loss: {typeof linkDetail.lossRate === 'number' ? `${(linkDetail.lossRate * 100).toFixed(2)}%` : '-'}</div>
          <div>Utilization: {typeof linkDetail.utilization === 'number' ? `${(linkDetail.utilization * 100).toFixed(1)}%` : '-'}</div>
          <div>SNR: {typeof linkDetail.snrDb === 'number' ? `${linkDetail.snrDb} dB` : '-'}</div>
          <div>Availability: {typeof linkDetail.availability === 'number' ? `${(linkDetail.availability * 100).toFixed(2)}%` : '-'}</div>
          <div>Last Update: {formatTimestampWithDate(linkDetail.lastUpdate)}</div>
        </div>
      </Popup>
    );

    return (
      <React.Fragment key={link.id}>
        {(isHoveredLink || isFocusedLink) ? (
          <Polyline
            positions={linkPositions}
            pathOptions={{
              color: isFocusedLink ? '#f8fafc' : '#c7ced8',
              weight: isFocusedLink ? 8.8 : 7.6,
              opacity: isFocusedLink ? 0.78 : 0.6,
              className: `link-line ${isFocusedLink ? 'link-line--focus-outline' : 'link-line--hover-outline'}`,
              interactive: false,
            }}
          />
        ) : null}
        {isPathLink ? (
          <Polyline
            positions={linkPositions}
            pathOptions={{
              color: '#38bdf8',
              weight: 6,
              opacity: 0.28,
              className: 'link-line link-line--path',
              interactive: false,
            }}
          />
        ) : null}
        <Polyline
          ref={healthLineRefCallback}
          positions={linkPositions}
          pathOptions={{
            ...baseLinkStyle,
            color: healthColor,
            opacity: isPathLink ? 1 : healthOpacity,
            dashArray: linkDashArray || baseLinkStyle.dashArray,
            className: `link-line link-line--health${linkStateClass}`,
            weight: isSelectedLink
              ? 4.6
              : (isFocusedLink ? 4.2 : (isPathLink ? 3.9 : (isHoveredLink ? 3.4 : baseLinkStyle.weight))),
            interactive: false,
          }}
        />
        <Polyline
          ref={flowLineRefCallback}
          eventHandlers={{
            click: (event) => {
              setSelectedNodeId(null);
              setFocusedNodeId(null);
              setFocusRequestId(null);
              setSelectedLinkId(link.id);
              startLinkFocusPulse(link.id);
              event.target?.openPopup?.();
            },
          }}
          positions={linkPositions}
          pathOptions={{
            color: healthColor,
            weight: highlightWeight,
            opacity: isSelectedLink ? 1 : (isFocusedLink ? 1 : (isHoveredLink ? 0.95 : (flowOpacity ?? 0.88))),
            dashArray: isLinkDown ? '2 16' : undefined,
            className: `${flowClass}${linkStateClass}`,
            interactive: false,
          }}
        />
        <Polyline
          positions={linkPositions}
          eventHandlers={{
            mouseover: () => setHoveredLinkId(link.id),
            mouseout: () => {
              setHoveredLinkId((prev) => (prev === link.id ? null : prev));
            },
            click: (event) => {
              setSelectedNodeId(null);
              setFocusedNodeId(null);
              setFocusRequestId(null);
              setSelectedLinkId(link.id);
              startLinkFocusPulse(link.id);
              event.target?.openPopup?.();
            },
          }}
          pathOptions={{
            color: '#ffffff',
            weight: isSelectedLink ? 18 : (isHoveredLink ? 16 : 14),
            opacity: 0,
            className: `link-hit-area${isHoveredLink ? ' link-hit-area--hover' : ''}${isSelectedLink ? ' link-hit-area--selected' : ''}${isFocusedLink ? ' link-hit-area--focused' : ''}`,
            interactive: true,
          }}
        >
          {linkPopupContent}
        </Polyline>
      </React.Fragment>
    );
  }), [
    focusedLinkId,
    getDynamicNodeAltitude,
    getDynamicNodePosition,
    hoveredLinkId,
    linkDetailsById,
    mapViewMode,
    pathHighlightLinkIdSet,
    playbackMode,
    selectedLinkId,
    startLinkFocusPulse,
    visibleLinks,
  ]);

  return (
    <div className="App relative h-screen w-screen bg-gradient-to-br from-deep-navy via-[#0d1f3c] to-[#030915] text-slate-100 overflow-hidden">
      <div
        className={`absolute top-0 left-0 z-10 h-full transition-all duration-300 ease-out border-r border-white/20 backdrop-blur-2xl bg-white/5 shadow-2xl flex-shrink-0 ${sidebarCollapsed ? 'w-20' : 'w-80'}`}
      >
        <NodeList
          nodes={visibleNodes}
          collapsed={sidebarCollapsed}
          onToggle={handleToggleSidebar}
          typeMeta={NODE_TYPE_META}
          selectedNodeId={selectedNodeId}
          focusedNodeId={focusedNodeId}
          onSelectNode={handleSelectNode}
        />
      </div>

      <div
        className={`absolute top-5 z-[1000] rounded-2xl border border-white/20 bg-[#07182fcc] text-xs text-slate-100 backdrop-blur-xl shadow-2xl transition-all duration-300 ease-out ${
          controlPanelCollapsed ? 'w-14 p-2' : 'w-[320px] p-3'
        }`}
        style={{ left: sidebarCollapsed ? 96 : 336 }}
      >
        <div className={`flex items-center ${controlPanelCollapsed ? 'justify-center' : 'justify-between'} gap-2`}>
          {!controlPanelCollapsed ? (
            <p className="tracking-[0.2em] uppercase text-[10px] text-cyan-200/90">Regional Network Console</p>
          ) : (
            <span className="text-[9px] uppercase tracking-[0.18em] text-cyan-200/75">Ctl</span>
          )}
          <button
            type="button"
            onClick={handleToggleControlPanel}
            className="h-7 w-7 rounded-md border border-white/20 bg-white/10 text-[12px] text-slate-100 transition-colors hover:bg-white/20"
            aria-label={controlPanelCollapsed ? 'Expand control panel' : 'Collapse control panel'}
            title={controlPanelCollapsed ? 'Expand control panel' : 'Collapse control panel'}
          >
            {controlPanelCollapsed ? '>' : '<'}
          </button>
        </div>
        {controlPanelCollapsed ? (
          <div className="mt-3 flex h-[240px] flex-col items-center justify-start gap-2 text-[10px] text-slate-300">
            <button
              type="button"
              onClick={handleManualRefresh}
              className="h-7 w-7 rounded-md border border-cyan-300/40 bg-cyan-400/10 text-[10px] text-cyan-100 transition-colors hover:bg-cyan-400/20"
              title="Refresh"
              aria-label="Refresh"
            >
              R
            </button>
            <div className="w-full border-t border-white/10" />
            <div className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5">
              {playbackMode === 'playback' ? 'PB' : 'LV'}
            </div>
            <div className="rounded-md border border-rose-300/25 bg-rose-400/10 px-1.5 py-0.5 text-rose-100">
              {effectiveAlerts.length}A
            </div>
            <div className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-1.5 py-0.5 text-emerald-100">
              {visibleNodes.length}N
            </div>
            <div className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-slate-200">
              {visibleLinks.length}L
            </div>
          </div>
        ) : (
          <div className="mt-2 max-h-[calc(100vh-84px)] overflow-y-auto pr-1">
        <CollapsibleSection
          title="Search / Refresh"
          isOpen={!!controlPanelSections.search}
          onToggle={() => handleToggleControlSection('search')}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSearchSubmit();
                }
              }}
              className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none"
              placeholder="Search by node ID / name"
            />
            <button
              type="button"
              onClick={handleSearchSubmit}
              className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
            >
              Go
            </button>
            <button
              type="button"
              onClick={handleManualRefresh}
              className="rounded-md border border-cyan-300/40 bg-cyan-400/10 px-2 py-1 text-xs hover:bg-cyan-400/20"
            >
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </CollapsibleSection>
        <CollapsibleSection
          title="Network Playback"
          isOpen={!!controlPanelSections.playback}
          onToggle={() => handleToggleControlSection('playback')}
          className="mt-3"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleTogglePlaybackMode}
              disabled={playbackLoading}
              className="rounded-md border border-cyan-300/40 bg-cyan-400/10 px-2 py-1 text-xs hover:bg-cyan-400/20 disabled:opacity-60"
            >
              {playbackLoading
                ? 'Loading...'
                : (playbackMode === 'playback' ? 'Back To Live' : 'Enter Playback')}
            </button>
            <div
              className={`rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.08em] ${
                playbackMode === 'playback'
                  ? 'border-amber-300/55 bg-amber-400/15 text-amber-100'
                  : 'border-cyan-300/45 bg-cyan-400/10 text-cyan-100'
              }`}
            >
              {playbackMode === 'playback' ? 'PLAYBACK MODE' : 'LIVE MODE'}
            </div>
          </div>
          {playbackMode === 'playback' ? (
            <div className={`mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-2 ${isPlaybackVisualFlash ? 'playback-data-flash' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] text-slate-200">
                  <span className="font-semibold tracking-[0.08em] text-amber-100">
                    Playback {playbackFrameNumber}/{playbackFrameCount}
                  </span>
                  <span className="mx-1 text-slate-400">|</span>
                  <span className="text-slate-300">{formatTimestampWithDate(activePlaybackFrame?.timestamp)}</span>
                </div>
                <div className={`playback-state-pill ${playbackPlaying ? 'playback-state-pill--playing' : 'playback-state-pill--paused'}`}>
                  <span className={`playback-state-dot ${playbackPlaying ? 'playback-state-dot--playing' : ''}`} />
                  {playbackPlaying ? 'Playing' : 'Paused'}
                </div>
              </div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-slate-300">Timeline</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-300 to-amber-300 transition-all duration-300 ease-out"
                  style={{ width: `${playbackProgressPercent}%` }}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handlePlaybackPrevFrame}
                  disabled={!playbackFrames.length}
                  className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-60"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={handlePlaybackPlayPause}
                  disabled={!playbackFrames.length}
                  className="rounded-md border border-emerald-300/40 bg-emerald-400/10 px-2 py-1 text-xs hover:bg-emerald-400/20 disabled:opacity-60"
                >
                  {playbackPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={handlePlaybackNextFrame}
                  disabled={!playbackFrames.length}
                  className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-60"
                >
                  Next
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, playbackFrames.length - 1)}
                value={Math.min(playbackFrameIndex, Math.max(0, playbackFrames.length - 1))}
                onChange={handlePlaybackSliderChange}
                className="playback-timeline-slider mt-2 w-full"
                disabled={!playbackFrames.length}
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-300">
                <span>Frame {playbackFrameNumber}/{playbackFrameCount}</span>
                <span>Time: {formatTimestamp(activePlaybackFrame?.timestamp)}</span>
              </div>
              {playbackError ? (
                <div className="mt-1 text-amber-200">{playbackError}</div>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-2 text-slate-200">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-cyan-100">Live Timeline</span>
                <span className="rounded-full border border-cyan-300/35 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-100">
                  Polling {Math.round(POLLING_INTERVAL_MS / 1000)}s
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-300">
                Last refresh: {formatTimestamp(lastRefreshAt)}
              </div>
              <div className="mt-1 text-[11px] text-slate-300">
                Switch to Playback to replay recent historical frames.
                {playbackError ? ` ${playbackError}` : ''}
              </div>
            </div>
          )}
        </CollapsibleSection>
        <CollapsibleSection
          title="Topology Node Command"
          isOpen={!!controlPanelSections.python}
          onToggle={() => handleToggleControlSection('python')}
          className="mt-3"
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-300/25 bg-emerald-400/[0.06] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold tracking-[0.08em] text-emerald-100">Add Node</div>
                <div className="text-[10px] text-emerald-200/80">Manual topology node creation</div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Node ID*</label>
                  <input
                    type="text"
                    value={addNodeForm.nodeId}
                    onChange={handleAddNodeIdChange}
                    className={`mt-1 w-full rounded-md border bg-white/10 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none ${
                      isAddNodeIdDuplicate ? 'border-rose-300/65' : 'border-white/20'
                    }`}
                    placeholder="e.g. XDU-CAM-201"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Node Name*</label>
                  <input
                    type="text"
                    value={addNodeForm.nodeName}
                    onChange={handleAddNodeNameChange}
                    className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none"
                    placeholder="Display name"
                  />
                </div>
              </div>

              {isAddNodeIdDuplicate ? (
                <div className="mt-1 text-[10px] text-rose-200">Node ID already exists in current topology.</div>
              ) : null}

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Type*</label>
                  <select
                    value={addNodeForm.type}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      const nextProfile = getAddNodeTypeProfile(nextValue);
                      const nextZone = nextProfile?.defaultZone || addNodeForm.zone || DEFAULT_ADD_NODE_ZONE;
                      const seed = addNodeForm.nodeId.trim() || `${nextZone}-${nextValue}-new`;
                      const nextPoint = getCampusPointByZone(nextZone, seed, 0);
                      setAddNodeForm((prev) => ({
                        ...prev,
                        type: nextValue,
                        layer: nextProfile?.defaultLayer || prev.layer,
                        zone: nextZone,
                        lat: Number(nextPoint.lat).toFixed(6),
                        lng: Number(nextPoint.lng).toFixed(6),
                        coordSystem: 'wgs84',
                      }));
                    }}
                    className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    {addNodeTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {getNodeTypeLabel(option)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Layer*</label>
                  <select
                    value={addNodeForm.layer}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setAddNodeForm((prev) => ({
                        ...prev,
                        layer: nextValue,
                      }));
                    }}
                    className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    {addNodeLayerOptions.map((option) => (
                      <option key={option} value={option}>
                        {getLayerLabel(option)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Status*</label>
                  <select
                    value={addNodeForm.status}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setAddNodeForm((prev) => ({
                        ...prev,
                        status: nextValue,
                      }));
                    }}
                    className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    {addNodeStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        {formatOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Online*</label>
                  <select
                    value={addNodeForm.online ? 'true' : 'false'}
                    onChange={(event) => {
                      const nextValue = event.target.value === 'true';
                      setAddNodeForm((prev) => ({
                        ...prev,
                        online: nextValue,
                      }));
                    }}
                    className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Site Zone*</label>
                  <select
                    value={addNodeForm.zone}
                    onChange={(event) => {
                      const nextZone = event.target.value;
                      const seed = addNodeForm.nodeId.trim() || `${nextZone}-${addNodeForm.type || 'campus-node'}`;
                      const point = getCampusPointByZone(nextZone, seed, 0);
                      setAddNodeForm((prev) => ({
                        ...prev,
                        zone: nextZone,
                        lat: Number(point.lat).toFixed(6),
                        lng: Number(point.lng).toFixed(6),
                        coordSystem: 'wgs84',
                      }));
                    }}
                    className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    {XDU_CAMPUS_ZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleUseZoneLocation}
                    className="w-full rounded border border-cyan-300/35 bg-cyan-400/10 px-2 py-1.5 text-[10px] text-cyan-100 hover:bg-cyan-400/20"
                  >
                    Use Zone Position
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Latitude*</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={addNodeForm.lat}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setAddNodeForm((prev) => ({
                        ...prev,
                        lat: nextValue,
                      }));
                    }}
                    className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none"
                    placeholder="34.250000"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Longitude*</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={addNodeForm.lng}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setAddNodeForm((prev) => ({
                        ...prev,
                        lng: nextValue,
                      }));
                    }}
                    className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none"
                    placeholder="108.950000"
                  />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Coordinate System*</label>
                  <select
                    value={addNodeForm.coordSystem || 'wgs84'}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setAddNodeForm((prev) => ({
                        ...prev,
                        coordSystem: nextValue,
                      }));
                    }}
                    className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value="wgs84">WGS84 (Leaflet/OSM)</option>
                    <option value="gcj02">GCJ-02 (Gaode)</option>
                  </select>
                </div>
                <div className="flex items-end rounded-md border border-cyan-300/20 bg-cyan-400/5 px-2 py-1 text-[10px] text-cyan-100/90">
                  Manual GCJ-02 input is converted to WGS84 before submitting.
                </div>
              </div>

              <div className="mt-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Attach To*</label>
                  <input
                    type="text"
                    value={addAttachSearch}
                    onChange={(event) => setAddAttachSearch(event.target.value)}
                    className="w-[140px] rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[10px] text-slate-100 placeholder:text-slate-400 focus:outline-none"
                    placeholder="Search node"
                  />
                </div>
                <select
                  value={addNodeForm.attachTo}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setAddNodeForm((prev) => ({
                      ...prev,
                      attachTo: nextValue,
                    }));
                  }}
                  className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                >
                  {filteredAttachOptions.length ? (
                    filteredAttachOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))
                  ) : (
                    <option value="">No attach target available</option>
                  )}
                </select>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                  <span>`attachTo` only records association in payload; no auto link is created yet.</span>
                  <button
                    type="button"
                    onClick={handleUseAttachNodeLocation}
                    className="rounded border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-white/20"
                  >
                    Use Attach Position
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddNodeCommand}
                disabled={commandBusy || isAddNodeIdDuplicate}
                className="mt-2 w-full rounded-md border border-emerald-300/45 bg-emerald-400/15 px-2 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/25 disabled:opacity-60"
              >
                {commandBusy && commandBusyAction === 'add' ? 'Submitting Add Node...' : 'Create Topology Node'}
              </button>
            </div>

            <div className="rounded-lg border border-rose-300/25 bg-rose-400/[0.06] p-2.5">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-rose-100">Remove Node</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={removeNodeSearch}
                  onChange={(event) => setRemoveNodeSearch(event.target.value)}
                  className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none"
                  placeholder="Search node by name / ID"
                />
              </div>
              <select
                value={removeNodeId}
                onChange={(event) => setRemoveNodeId(event.target.value)}
                className="python-command-select mt-2 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
              >
                <option value="">Select a node to remove</option>
                {filteredRemoveOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[10px] text-slate-400">
                Removing a node triggers `node:remove`; topology and panel data refresh automatically.
              </div>
              <button
                type="button"
                onClick={handleRemoveNodeCommand}
                disabled={commandBusy || !removeNodeId}
                className="mt-2 w-full rounded-md border border-rose-300/45 bg-rose-400/15 px-2 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-400/25 disabled:opacity-60"
              >
                {commandBusy && commandBusyAction === 'remove' ? 'Submitting Remove Node...' : 'Remove Selected Node'}
              </button>
            </div>

            {commandResult ? (
              <div
                className={`rounded-md border px-2 py-1.5 text-[11px] ${
                  commandResultKind === 'error'
                    ? 'border-rose-300/45 bg-rose-500/10 text-rose-100'
                    : commandResultKind === 'success'
                      ? 'border-emerald-300/45 bg-emerald-500/10 text-emerald-100'
                      : 'border-cyan-300/35 bg-cyan-500/10 text-cyan-100'
                }`}
              >
                {commandResult}
              </div>
            ) : null}
          </div>
        </CollapsibleSection>
        <div className="mt-3 flex flex-wrap gap-2">
          {LAYER_OPTIONS.map((layer) => {
            const enabled = enabledLayerSet.has(layer.key);
            return (
              <button
                key={layer.key}
                type="button"
                onClick={() => handleLayerToggle(layer.key)}
                className={`rounded-full border px-2 py-1 ${enabled ? 'border-emerald-300/70 bg-emerald-400/20 text-emerald-100' : 'border-white/20 bg-white/10 text-slate-200'}`}
              >
                {layer.label}
              </button>
            );
          })}
        </div>
        <CollapsibleSection
          title="KPI"
          isOpen={!!controlPanelSections.kpi}
          onToggle={() => handleToggleControlSection('kpi')}
          className="mt-3"
        >
          <div className={`grid grid-cols-2 gap-2 text-[11px] ${isPlaybackVisualFlash ? 'playback-data-flash' : ''}`}>
            <div className="rounded-lg border border-white/15 bg-white/5 p-2">
              <div className="flex items-center justify-between text-slate-300">
                <span>Online Nodes</span>
                <span className="text-[10px] text-emerald-200">{kpiTrend.onlineNodes}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-emerald-200">
                {kpiData.onlineNodes}/{kpiData.totalNodes}
              </div>
              <KpiSparkline points={kpiHistory.onlineNodes} color="#35f29a" />
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-2">
              <div className="flex items-center justify-between text-slate-300">
                <span>Active Alerts</span>
                <span className="text-[10px] text-rose-200">{kpiTrend.activeAlerts}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-rose-200">{kpiData.activeAlerts}</div>
              <KpiSparkline points={kpiHistory.activeAlerts} color="#f95d5d" />
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-2">
              <div className="flex items-center justify-between text-slate-300">
                <span>Avg Delay</span>
                <span className="text-[10px] text-amber-200">{kpiTrend.avgDelay}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-cyan-100">
                {formatMetricNumber(kpiData.avgDelay, 1)} ms
              </div>
              <KpiSparkline points={kpiHistory.avgDelay} color="#f4c84a" />
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-2">
              <div className="flex items-center justify-between text-slate-300">
                <span>Avg Loss</span>
                <span className="text-[10px] text-amber-200">{kpiTrend.avgLoss}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-cyan-100">
                {formatMetricPercent(kpiData.avgLoss, 2)}
              </div>
              <KpiSparkline points={kpiHistory.avgLoss} color="#f4c84a" />
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-2 col-span-2">
              <div className="flex items-center justify-between text-slate-300">
                <span>Avg Utilization</span>
                <span className="text-[10px] text-cyan-200">{kpiTrend.avgUtilization}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-cyan-100">
                {formatMetricPercent(kpiData.avgUtilization, 1)}
              </div>
              <KpiSparkline points={kpiHistory.avgUtilization} color="#67e8f9" />
            </div>
          </div>
        </CollapsibleSection>
        <CollapsibleSection
          title="Network Analysis"
          isOpen={!!controlPanelSections.analysis}
          onToggle={() => handleToggleControlSection('analysis')}
          className="mt-3"
        >
          <div className={`space-y-2 text-[11px] ${isPlaybackVisualFlash ? 'playback-data-flash' : ''}`}>
            <div className="rounded-lg border border-cyan-300/25 bg-cyan-400/[0.06] p-2">
              <div className="flex items-center justify-between text-cyan-100">
                <span className="font-semibold tracking-[0.08em]">Overall Health</span>
                <span className="rounded border border-cyan-300/40 bg-cyan-400/15 px-1.5 py-0.5 text-[10px]">
                  {networkHealthPercent !== null ? `${networkHealthPercent}/100` : '-'}
                </span>
              </div>
              <div className="mt-1 text-slate-300">
                Python Health: {typeof effectiveSituationCurrent?.pythonMetrics?.networkHealth === 'number'
                  ? `${(effectiveSituationCurrent.pythonMetrics.networkHealth * 100).toFixed(1)}%`
                  : '-'}
                {' | '}
                Online Rate: {typeof effectiveSituationCurrent?.pythonMetrics?.onlineRate === 'number'
                  ? `${(effectiveSituationCurrent.pythonMetrics.onlineRate * 100).toFixed(1)}%`
                  : '-'}
              </div>
              <div className="mt-1 text-slate-400">
                Avg Delay {formatMetricNumber(toFiniteNumberOrNull(effectiveSituationCurrent?.pythonMetrics?.avgDelay), 1)} ms
                {' | '}
                Avg Loss {formatMetricPercent(toFiniteNumberOrNull(effectiveSituationCurrent?.pythonMetrics?.avgLoss), 2)}
              </div>
            </div>

            <div className="rounded-lg border border-emerald-300/25 bg-emerald-400/[0.06] p-2">
              <div className="flex items-center justify-between text-emerald-100">
                <span className="font-semibold tracking-[0.08em]">Connectivity</span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
                  backendConnectivityState ? 'border-emerald-300/40 bg-emerald-400/15' : 'border-rose-300/45 bg-rose-400/15'
                }`}>
                  {backendConnectivityState === null ? '-' : (backendConnectivityState ? 'Connected' : 'Partitioned')}
                </span>
              </div>
              <div className="mt-1 text-slate-300">
                Components: {connectivityAnalysis?.componentCount ?? '-'}
                {' | '}
                Largest Component: {typeof connectivityAnalysis?.largestComponentRatio === 'number'
                  ? `${(connectivityAnalysis.largestComponentRatio * 100).toFixed(1)}%`
                  : '-'}
              </div>
              <div className="mt-1 text-slate-300">
                Isolated Nodes: {Array.isArray(connectivityAnalysis?.isolatedNodeIds)
                  ? connectivityAnalysis.isolatedNodeIds.length
                  : '-'}
                {' | '}
                Cross-layer Relations: {crossLayerRelations.length}
              </div>
              {Array.isArray(connectivityAnalysis?.isolatedNodeIds) && connectivityAnalysis.isolatedNodeIds.length ? (
                <div className="mt-1 text-slate-400">
                  Isolated: {connectivityAnalysis.isolatedNodeIds.slice(0, 6).join(', ')}
                </div>
              ) : null}
              {connectivityError ? (
                <div className="mt-1 text-amber-200">{connectivityError}</div>
              ) : null}
            </div>

            <div className="rounded-lg border border-amber-300/25 bg-amber-400/[0.06] p-2">
              <div className="flex items-center justify-between text-amber-100">
                <span className="font-semibold tracking-[0.08em]">Path Analysis (Delay-Weighted)</span>
                <span className="text-[10px] text-amber-200/85">Backend shortest path</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Source Node</label>
                  <select
                    value={pathAnalysisForm.fromNodeId}
                    onChange={(event) => {
                      const nextFromNodeId = event.target.value;
                      setPathAnalysisForm((prev) => ({
                        ...prev,
                        fromNodeId: nextFromNodeId,
                        toNodeId: prev.toNodeId === nextFromNodeId ? '' : prev.toNodeId,
                      }));
                    }}
                    className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value="">Select source</option>
                    {pathEndpointOptions.map((item) => (
                      <option key={`path-from-${item.id}`} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Destination Node</label>
                  <select
                    value={pathAnalysisForm.toNodeId}
                    onChange={(event) => {
                      const nextToNodeId = event.target.value;
                      setPathAnalysisForm((prev) => ({
                        ...prev,
                        toNodeId: nextToNodeId,
                      }));
                    }}
                    className="python-command-select mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
                  >
                    <option value="">Select destination</option>
                    {pathEndpointOptions
                      .filter((item) => item.id !== pathAnalysisForm.fromNodeId)
                      .map((item) => (
                        <option key={`path-to-${item.id}`} value={item.id}>{item.label}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleRunPathAnalysis}
                  disabled={pathAnalysisLoading || !pathAnalysisForm.fromNodeId || !pathAnalysisForm.toNodeId}
                  className="rounded-md border border-amber-300/45 bg-amber-400/15 px-2 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-400/25 disabled:opacity-60"
                >
                  {pathAnalysisLoading ? 'Analyzing...' : 'Run Path'}
                </button>
                <button
                  type="button"
                  onClick={handleClearPathAnalysis}
                  disabled={!pathAnalysisResult && !pathAnalysisError}
                  className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-200 hover:bg-white/20 disabled:opacity-60"
                >
                  Clear
                </button>
              </div>

              {pathAnalysisResult?.reachable ? (
                <div className="mt-2 rounded border border-cyan-300/25 bg-cyan-400/10 px-2 py-1.5 text-slate-100">
                  <div>Hops: {pathAnalysisResult.hopCount} | Delay: {formatMetricNumber(pathAnalysisResult.totalDelayMs, 2)} ms</div>
                  <div className="mt-1 text-slate-200 break-all">
                    Path: {(pathAnalysisResult.pathNodeIds || []).join(' -> ')}
                  </div>
                </div>
              ) : null}
              {!pathAnalysisResult?.reachable && pathAnalysisResult ? (
                <div className="mt-2 rounded border border-rose-300/30 bg-rose-400/10 px-2 py-1 text-rose-100">
                  No reachable path in current live topology.
                </div>
              ) : null}
              {pathAnalysisError ? (
                <div className="mt-2 text-rose-100">{pathAnalysisError}</div>
              ) : null}
            </div>
          </div>
        </CollapsibleSection>
        <div className="mt-3 text-[11px] text-slate-300">
          Visible: {visibleNodes.length} nodes / {visibleLinks.length} links / {crossLayerRelations.length} relations
        </div>
        <div className="mt-1 text-[11px] text-slate-300">
          Data Source: {dataSource === 'api' ? 'REST API' : 'Local Mock'}
          {playbackMode === 'playback' ? ' | Mode: Playback' : ' | Mode: Live'}
          {effectiveSituationCurrent ? ` | Health: ${effectiveSituationCurrent.healthScore}` : ''}
          {effectiveEvents.length ? ` | Events: ${effectiveEvents.length}` : ''}
          {effectiveAlerts.length ? ` | Alerts: ${effectiveAlerts.length}` : ''}
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          {playbackMode === 'playback'
            ? `Playback Frame Time: ${formatTimestamp(activePlaybackFrame?.timestamp)}`
            : `Polling: ${Math.round(POLLING_INTERVAL_MS / 1000)}s${lastRefreshAt ? ` | Last refresh: ${formatTimestamp(lastRefreshAt)}` : ''}`}
        </div>
        {effectiveSituationCurrent?.pythonMetrics ? (
          <div className="mt-1 text-[11px] text-slate-300">
            Delay: {effectiveSituationCurrent.pythonMetrics.avgDelay} ms
            {' | '}
            Loss: {typeof effectiveSituationCurrent.pythonMetrics.avgLoss === 'number'
              ? `${(effectiveSituationCurrent.pythonMetrics.avgLoss * 100).toFixed(2)}%`
              : '-'}
          </div>
        ) : null}
        {apiError ? (
          <div className="mt-1 text-[11px] text-amber-200">
            API fallback: {apiError}
          </div>
        ) : null}
        {selectedLink ? (
          <div className="mt-2 rounded-lg border border-white/15 bg-white/5 p-2 text-[11px]">
            <div className="font-semibold text-slate-100">Selected Link: {selectedLink.id}</div>
            <div className="text-slate-300">{selectedLink.from} -&gt; {selectedLink.to}</div>
            <div className="text-slate-400">
              State {String(selectedLink.state || 'up')} | Health {String(selectedLink.health || '-')}
              {' | '}
              Delay {Number.isFinite(selectedLink.delayMs) ? `${selectedLink.delayMs} ms` : '-'}
            </div>
          </div>
        ) : null}
        <CollapsibleSection
          title="Recent Alerts"
          isOpen={!!controlPanelSections.alerts}
          onToggle={() => handleToggleControlSection('alerts')}
          className="mt-2"
        >
          {effectiveAlerts.length ? (
            <ul className={`space-y-1 text-slate-300 ${isPlaybackVisualFlash ? 'playback-data-flash rounded-md' : ''}`}>
              {effectiveAlerts.slice(0, 5).map((alertItem) => (
                <li key={alertItem.id}>
                  <button
                    type="button"
                    onClick={() => handleAlertFocus(alertItem)}
                    className="w-full rounded border border-white/10 bg-white/5 p-1 text-left hover:bg-white/10"
                  >
                    <div style={{ color: getAlertSeverityColor(alertItem.severity) }}>
                      [{normalizeAlertSeverity(alertItem.severity)}] {alertItem.title || alertItem.type}
                    </div>
                    <div className="text-slate-300">{alertItem.message}</div>
                    <div className="text-[10px] text-slate-400">{formatTimestamp(alertItem.timestamp)}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={`text-slate-400 ${isPlaybackVisualFlash ? 'playback-data-flash rounded-md px-1 py-0.5' : ''}`}>No active alerts</div>
          )}
        </CollapsibleSection>
        <div className={`mt-2 rounded-lg border border-white/15 bg-white/5 p-2 text-[11px] ${isPlaybackVisualFlash ? 'playback-data-flash' : ''}`}>
          <div className="font-semibold text-slate-100">Recent Events</div>
          {effectiveEvents.length ? (
            <ul className="mt-1 space-y-1 text-slate-300">
              {effectiveEvents.slice(0, 4).map((eventItem) => (
                <li key={eventItem.id}>
                  [{eventItem.severity || 'info'}] {eventItem.message || eventItem.type} ({formatTimestamp(eventItem.occurredAt)})
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-slate-400">No events</div>
          )}
        </div>
          </div>
        )}
      </div>

      <div
        className={`playback-mode-bar absolute left-1/2 top-5 z-[1000] -translate-x-1/2 rounded-2xl border px-3 py-2 text-xs backdrop-blur-xl shadow-2xl ${
          playbackMode === 'playback'
            ? 'playback-mode-bar--playback border-amber-300/45 bg-[#2b1b0bcc] text-amber-50'
            : 'playback-mode-bar--live border-cyan-300/35 bg-[#07182fcc] text-cyan-50'
        }`}
      >
        <div className="flex items-center justify-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] ${
              playbackMode === 'playback'
                ? 'border-amber-200/45 bg-amber-300/15 text-amber-100'
                : 'border-cyan-200/45 bg-cyan-300/10 text-cyan-100'
            }`}
          >
            {playbackMode === 'playback' ? 'PLAYBACK MODE' : 'LIVE MODE'}
          </span>
          {playbackMode === 'playback' ? (
            <span className={`playback-state-pill ${playbackPlaying ? 'playback-state-pill--playing' : 'playback-state-pill--paused'}`}>
              <span className={`playback-state-dot ${playbackPlaying ? 'playback-state-dot--playing' : ''}`} />
              {playbackPlaying ? 'Playing' : 'Paused'}
            </span>
          ) : (
            <span className="text-[10px] text-cyan-100/90">Polling {Math.round(POLLING_INTERVAL_MS / 1000)}s</span>
          )}
        </div>
        <div className="mt-1 text-center text-[11px]">
          {playbackMode === 'playback'
            ? `Frame ${playbackFrameNumber}/${playbackFrameCount} | ${formatTimestampWithDate(activePlaybackFrame?.timestamp)}`
            : `Last refresh | ${formatTimestamp(lastRefreshAt)}`}
        </div>
      </div>

      <div className="map-mode-panel absolute right-5 top-5 z-[1000] rounded-2xl border border-white/20 bg-[#07182fcc] p-3 text-xs text-slate-100 backdrop-blur-xl shadow-2xl">
        <p className="tracking-[0.2em] uppercase text-[10px] text-cyan-200/90">Map View</p>
        <button
          type="button"
          onClick={handleToggleMapViewMode}
          className="map-mode-toggle mt-2"
          aria-label="Toggle 2D / 3D map mode"
        >
          <span className={mapViewMode === '2d' ? 'is-active' : ''}>2D</span>
          <span className={mapViewMode === '3d' ? 'is-active' : ''}>3D</span>
        </button>
        <p className="mt-2 text-[11px] text-slate-300/90">
          {mapViewMode === '3d' ? '3D mode for multi-site node altitude and density.' : '2D mode for regional topology map.'}
        </p>
      </div>

      <div
        className={`absolute right-5 bottom-5 z-[1000] rounded-2xl border border-white/20 bg-[#07182fcc] text-xs text-slate-100 backdrop-blur-xl shadow-2xl transition-all duration-300 ease-out ${
          mapLegendCollapsed ? 'w-[92px] p-2' : 'w-[290px] p-3'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="tracking-[0.14em] uppercase text-[10px] text-cyan-200/90">Legend</p>
          <button
            type="button"
            onClick={handleToggleLegend}
            className="h-6 w-6 rounded-md border border-white/20 bg-white/10 text-[11px] text-slate-100 transition-colors hover:bg-white/20"
            aria-label={mapLegendCollapsed ? 'Expand legend' : 'Collapse legend'}
            title={mapLegendCollapsed ? 'Expand legend' : 'Collapse legend'}
          >
            {mapLegendCollapsed ? '+' : '-'}
          </button>
        </div>
        {mapLegendCollapsed ? (
          <div className="mt-2 text-[10px] text-slate-300">Network guide</div>
        ) : (
          <div className="mt-2 space-y-2 text-[11px]">
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Node Type</div>
              <div className="mt-1 space-y-1">
                {legendNodeTypeItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-slate-950"
                      style={{ backgroundColor: item.color }}
                    >
                      {String(item.badge || 'Io').slice(0, 2).toUpperCase()}
                    </span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Node Status</div>
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#35f29a' }} />Normal / Online</div>
                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#f4c84a' }} />Warning</div>
                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#f95d5d' }} />Critical / Offline</div>
              </div>
            </div>

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Link State</div>
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2"><span className="w-8 border-t-2 border-[#35f29a]" />Healthy trunk/access link</div>
                <div className="flex items-center gap-2"><span className="w-8 border-t-2 border-[#f4c84a]" />Congested / warning link</div>
                <div className="flex items-center gap-2"><span className="w-8 border-t-2 border-[#f95d5d]" />Critical link</div>
                <div className="flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-[#f95d5d]" />Down / unavailable (dashed)</div>
              </div>
            </div>

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-slate-300">KPI Trend</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <span className="rounded border border-emerald-300/40 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-100">up</span>
                <span className="rounded border border-rose-300/40 bg-rose-400/10 px-1.5 py-0.5 text-[10px] text-rose-100">down</span>
                <span className="rounded border border-slate-300/30 bg-slate-400/10 px-1.5 py-0.5 text-[10px] text-slate-200">flat</span>
              </div>
            </div>

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-[0.08em] text-slate-300">Mode</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <span className="rounded border border-cyan-300/40 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-100">Live Mode</span>
                <span className="rounded border border-amber-300/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-100">Playback Mode</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {mapViewMode === '2d' ? (
        <MapContainer
          center={[XDU_CAMPUS_DEFAULT_CENTER.lat, XDU_CAMPUS_DEFAULT_CENTER.lng]}
          zoom={13}
          preferCanvas
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
            attribution="&copy; OpenStreetMap contributors"
          />
          {nodeHaloElements}
          {markerElements}
          {linkElements}
        </MapContainer>
      ) : (
        <Suspense fallback={
          <div className="absolute inset-0 z-0 flex items-center justify-center bg-[#020815] text-sm text-slate-300">
            Loading 3D regional view...
          </div>
        }
        >
          <Map3DView
            nodes={visibleNodes}
            links={visibleLinks}
            nodeStateRef={nodeStateRef}
            nodeMapRef={nodeMapRef}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;


