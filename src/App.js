import './App.css';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import NodeList from './NodeList';
import Map3DView from './Map3DView';

import { mockTopology } from './services/mockTopologyData';
import { buildInitialNodeState } from './services/mockNodeStream';
import {
  getAlerts,
  getEvents,
  getLinkById,
  getNodeById,
  getPlaybackFrames,
  sendPythonCommand,
  getSituationCurrent,
  getTopology,
} from './services/networkApi';

import groundStationIconUrl from './assets/icons/ground-station.svg';
import uavIconUrl from './assets/icons/uav.svg';
import groundUserIconUrl from './assets/icons/ground-user.svg';
import satelliteIconUrl from './assets/icons/satellite.svg';

const NODE_TYPE_META = {
  router: { label: 'Router', color: '#1f78b4', icon: groundStationIconUrl },
  'base-station': { label: 'Base Station', color: '#f28e2b', icon: groundStationIconUrl },
  'mesh-node': { label: 'Mesh Node', color: '#59a14f', icon: uavIconUrl },
  terminal: { label: 'Terminal', color: '#9467bd', icon: groundUserIconUrl },
  satellite: { label: 'Satellite', color: '#7f7f7f', icon: satelliteIconUrl },
};

const LAYER_OPTIONS = [
  { key: 'backbone', label: 'Backbone' },
  { key: 'access', label: 'Access' },
  { key: 'mesh', label: 'Mesh' },
  { key: 'edge', label: 'Edge' },
];
const POLLING_INTERVAL_MS = Math.max(
  2000,
  Number.parseInt(process.env.REACT_APP_TOPOLOGY_POLLING_MS || '5000', 10) || 5000
);
const PLAYBACK_FRAME_FETCH_LIMIT = 50;
const PLAYBACK_STEP_INTERVAL_MS = 1000;
const CONTROL_PANEL_COLLAPSED_STORAGE_KEY = 'netviz:control-panel-collapsed';
const CONTROL_PANEL_SECTIONS_STORAGE_KEY = 'netviz:control-panel-sections';
const CONTROL_PANEL_SECTION_DEFAULTS = {
  search: true,
  playback: true,
  python: false,
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
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="#7f7f7f" stroke="#ffffff" stroke-width="2"/><text x="18" y="22" text-anchor="middle" font-size="14" font-family="Arial, sans-serif" fill="#ffffff">N</text></svg>';
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

function buildFrontendDemoNode(nodeId) {
  const lat = 34.2 + Math.random() * 0.1;
  const lng = 108.9 + Math.random() * 0.16;
  return {
    id: nodeId,
    name: `FE-${nodeId}`,
    type: 'terminal',
    layer: 'access',
    location: {
      geo: {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        altitude: 0,
      },
    },
    state: {
      online: true,
      status: 'online',
    },
    energy: 80,
    capacity: 50,
    cpu: 0.2,
    load: 0.25,
    role: 'user',
  };
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

  return (
    <div className="text-sm text-slate-900">
      <div className="text-base font-semibold text-slate-900">{node.name}</div>
      <div className="mt-2 space-y-1 text-slate-800">
        <div>Node ID: {node.id}</div>
        <div>Type: {typeMeta.label}</div>
        <div>Layer: {node.layer || '-'}</div>
        <div>
          Status:{' '}
          {(() => {
            const dynState = getDynState();
            const online = dynState?.state?.online ?? node.state?.online;
            const status = dynState?.state?.status ?? node.state?.status ?? '-';
            return `${online ? 'online' : 'offline'} (${status})`;
          })()}
        </div>
        <div>
          Position:{' '}
          {(() => {
            const dynState = getDynState();
            const geo = dynState?.location?.geo || node.location?.geo;
            if (!geo) return '-';
            return `${geo.lat?.toFixed(5) ?? '-'}, ${geo.lng?.toFixed(5) ?? '-'}`;
          })()}
        </div>
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
          ▾
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

function App() {
  const [topologyData, setTopologyData] = useState(() => ({
    nodes: mockTopology.nodes,
    links: mockTopology.links,
    crossLayerRelations: mockTopology.crossLayerRelations,
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
  const [commandNodeId, setCommandNodeId] = useState('');
  const [commandNodeStatus, setCommandNodeStatus] = useState('busy');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandResult, setCommandResult] = useState('');
  const [playbackMode, setPlaybackMode] = useState('live');
  const [playbackFrames, setPlaybackFrames] = useState([]);
  const [playbackFrameIndex, setPlaybackFrameIndex] = useState(0);
  const [playbackPlaying, setPlaybackPlaying] = useState(false);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [controlPanelCollapsed, setControlPanelCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(CONTROL_PANEL_COLLAPSED_STORAGE_KEY) === '1';
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

  const effectiveTopologyData = useMemo(() => {
    if (playbackMode === 'playback') {
      const frameTopology = activePlaybackFrame?.topology || {};
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
  const [selectedLinkId, setSelectedLinkId] = useState(null);
  const [hoveredLinkId, setHoveredLinkId] = useState(null);
  const [focusRequestId, setFocusRequestId] = useState(null);
  const [mapViewMode, setMapViewMode] = useState('2d');
  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [enabledLayers, setEnabledLayers] = useState(() => LAYER_OPTIONS.map((item) => item.key));

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
    const hoverBoost = hoveredNodeId === nodeId ? 120 : 0;
    marker.setZIndexOffset(liftPx + selectedBoost + hoverBoost);
  }, [getDynamicNodeAltitude, hoveredNodeId, mapViewMode, selectedNodeId]);

  const applyMarkerInteractiveVisual = useCallback((marker, nodeId) => {
    if (!marker) {
      return;
    }
    const markerElement = marker.getElement?.();
    if (!markerElement) {
      return;
    }
    const isSelected = selectedNodeId === nodeId;
    const isHovered = hoveredNodeId === nodeId && !isSelected;
    markerElement.classList.toggle('node-marker--hover', isHovered);
    markerElement.classList.toggle('node-marker--selected', isSelected);
    markerElement.style.cursor = 'pointer';
  }, [hoveredNodeId, selectedNodeId]);

  useEffect(() => {
    nodeMapRef.current = buildNodeMap(baseNodes);
    nodeStateRef.current = buildInitialNodeState(baseNodes);
  }, [baseNodes]);

  const loadTopologyFromApi = useCallback(async () => {
    const topology = await getTopology();
    setTopologyData({
      nodes: Array.isArray(topology?.nodes) ? topology.nodes : [],
      links: Array.isArray(topology?.links) ? topology.links : [],
      crossLayerRelations: Array.isArray(topology?.crossLayerRelations) ? topology.crossLayerRelations : [],
    });
  }, []);

  const loadSituationAndEventsFromApi = useCallback(async () => {
    const [situation, eventItems, alertItems] = await Promise.all([
      getSituationCurrent(),
      getEvents(20),
      getAlerts(50, true).catch(() => []),
    ]);
    setSituationCurrent(situation || null);
    setEvents(Array.isArray(eventItems) ? eventItems : []);
    setAlerts(Array.isArray(alertItems) ? alertItems : []);
  }, []);

  const loadPlaybackFramesFromApi = useCallback(async (limit = PLAYBACK_FRAME_FETCH_LIMIT) => {
    const playbackPayload = await getPlaybackFrames(limit);
    const frames = Array.isArray(playbackPayload?.frames) ? playbackPayload.frames : [];
    return frames;
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
    const timer = setInterval(() => {
      refreshAllData({ silent: true });
    }, POLLING_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [refreshAllData]);

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
    if (playbackMode === 'playback') {
      return undefined;
    }
    if (!selectedNodeId) {
      return undefined;
    }

    let cancelled = false;

    getNodeById(selectedNodeId)
      .then((nodeDetail) => {
        if (!cancelled && nodeDetail) {
          setNodeDetailsById((prev) => ({ ...prev, [selectedNodeId]: nodeDetail }));
        }
      })
      .catch(() => {
        // Keep popup usable with base topology fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [playbackMode, selectedNodeId]);

  useEffect(() => {
    if (playbackMode === 'playback') {
      return undefined;
    }
    if (!selectedLinkId) {
      return undefined;
    }

    let cancelled = false;

    getLinkById(selectedLinkId)
      .then((linkDetail) => {
        if (!cancelled && linkDetail) {
          setLinkDetailsById((prev) => ({ ...prev, [selectedLinkId]: linkDetail }));
        }
      })
      .catch(() => {
        // Keep popup usable with base topology fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [playbackMode, selectedLinkId]);

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
    if (selectedLinkId && !visibleLinks.some((item) => item.id === selectedLinkId)) {
      setSelectedLinkId(null);
    }
  }, [selectedLinkId, visibleLinks]);

  useEffect(() => {
    if (hoveredLinkId && !visibleLinks.some((item) => item.id === hoveredLinkId)) {
      setHoveredLinkId(null);
    }
  }, [hoveredLinkId, visibleLinks]);

  const handleToggleSidebar = useCallback((value) => {
    const nextCollapsed = !!value;
    setSidebarCollapsed(nextCollapsed);
    if (nextCollapsed) {
      setSelectedNodeId(null);
      setFocusRequestId(null);
    }
  }, []);

  const handleSelectNode = useCallback((nodeId) => {
    setSelectedNodeId(nodeId);
    setFocusRequestId(nodeId);
  }, []);

  const handleAlertFocus = useCallback((alertItem) => {
    if (!alertItem || typeof alertItem !== 'object') {
      return;
    }
    if (alertItem.entityType === 'node' && alertItem.entityId) {
      setSelectedLinkId(null);
      setSelectedNodeId(alertItem.entityId);
      setFocusRequestId(alertItem.entityId);
      return;
    }
    if (alertItem.entityType === 'link' && alertItem.entityId) {
      setSelectedNodeId(null);
      setFocusRequestId(null);
      setSelectedLinkId(alertItem.entityId);
    }
  }, []);

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
      return;
    }

    setSelectedNodeId(matchedNodes[0].id);
    setFocusRequestId(matchedNodes[0].id);
  }, [baseNodes, enabledLayerSet, searchInput]);

  const handleFocusConsumed = useCallback(() => {
    setFocusRequestId(null);
  }, []);

  const handleToggleMapViewMode = useCallback(() => {
    setMapViewMode((prev) => (prev === '2d' ? '3d' : '2d'));
  }, []);

  const handleToggleControlPanel = useCallback(() => {
    setControlPanelCollapsed((prev) => !prev);
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

      setPlaybackFrames(frames);
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

  const submitPythonCommand = useCallback(async (command) => {
    if (commandBusy) {
      return;
    }
    setCommandBusy(true);
    setCommandResult('');
    try {
      const created = await sendPythonCommand(command);
      setCommandResult(`Queued ${created.type} (${created.id})`);
      await refreshAllData();
    } catch (error) {
      setCommandResult(error?.message || 'Failed to queue command');
    } finally {
      setCommandBusy(false);
    }
  }, [commandBusy, refreshAllData]);

  const handleAddNodeCommand = useCallback(() => {
    const inputId = commandNodeId.trim();
    const nodeId = inputId || `U-FE-${String(Date.now()).slice(-6)}`;
    setCommandNodeId(nodeId);
    submitPythonCommand({
      type: 'node:add',
      payload: {
        node: buildFrontendDemoNode(nodeId),
      },
    });
  }, [commandNodeId, submitPythonCommand]);

  const handleRemoveNodeCommand = useCallback(() => {
    const nodeId = commandNodeId.trim();
    if (!nodeId) {
      setCommandResult('Please input node id first');
      return;
    }
    submitPythonCommand({
      type: 'node:remove',
      payload: {
        nodeId,
      },
    });
  }, [commandNodeId, submitPythonCommand]);

  const handleUpdateNodeStatusCommand = useCallback(() => {
    const nodeId = commandNodeId.trim();
    if (!nodeId) {
      setCommandResult('Please input node id first');
      return;
    }
    submitPythonCommand({
      type: 'node:update',
      payload: {
        nodeId,
        status: commandNodeStatus,
        online: commandNodeStatus !== 'offline',
      },
    });
  }, [commandNodeId, commandNodeStatus, submitPythonCommand]);

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

    const isSelected = selectedNodeId === node.id;
    const isHovered = hoveredNodeId === node.id && !isSelected;
    const dynamicNode = nodeStateRef.current[node.id];
    const statusSource = dynamicNode && dynamicNode.state
      ? { ...node, state: dynamicNode.state }
      : node;
    const nodeStatusColor = getNodeSeverityColor(statusSource);

    return (
      <CircleMarker
        key={`halo-${node.id}`}
        center={position}
        radius={isSelected ? 21 : (isHovered ? 17 : 12)}
        pathOptions={{
          color: nodeStatusColor,
          weight: isSelected ? 2.8 : (isHovered ? 2.2 : 1.2),
          opacity: isSelected ? 0.95 : (isHovered ? 0.76 : 0.45),
          fillColor: nodeStatusColor,
          fillOpacity: isSelected ? 0.22 : (isHovered ? 0.12 : 0.08),
          className: `node-halo${isHovered ? ' node-halo--hover' : ''}${isSelected ? ' node-halo--selected' : ''}`,
          interactive: false,
        }}
      />
    );
  }), [hoveredNodeId, selectedNodeId, visibleNodes]);

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

  const linkElements = visibleLinks.map((link) => {
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
    const flowClass = `link-line link-line--flow ${getLinkFlowSpeedClass(link)}`;
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
    const isSelectedLink = selectedLinkId === link.id;
    const isHoveredLink = hoveredLinkId === link.id && !isSelectedLink;
    const highlightWeight = isSelectedLink ? 5.2 : (isHoveredLink ? 4.1 : 3);
    const linkStateClass = `${isHoveredLink ? ' link-line--hover' : ''}${isSelectedLink ? ' link-line--selected' : ''}`;

    const linkPopupContent = (
      <Popup>
        <div className="text-sm text-slate-900">
          <div className="text-base font-semibold">Link {linkDetail.id}</div>
          <div className="mt-1">From: {linkDetail.from}</div>
          <div>To: {linkDetail.to}</div>
          <div>Type: {linkDetail.type}</div>
          <div>State: {linkState}</div>
          <div>Bandwidth: {linkDetail.bandwidthMbps ?? '-'} Mbps</div>
          <div>Delay: {linkDetail.delayMs ?? '-'} ms</div>
          <div>Loss: {typeof linkDetail.lossRate === 'number' ? `${(linkDetail.lossRate * 100).toFixed(2)}%` : '-'}</div>
          <div>Utilization: {typeof linkDetail.utilization === 'number' ? `${(linkDetail.utilization * 100).toFixed(1)}%` : '-'}</div>
          <div>SNR: {typeof linkDetail.snrDb === 'number' ? `${linkDetail.snrDb} dB` : '-'}</div>
        </div>
      </Popup>
    );

    return (
      <React.Fragment key={link.id}>
        {isHoveredLink ? (
          <Polyline
            positions={linkPositions}
            pathOptions={{
              color: '#c7ced8',
              weight: 7.6,
              opacity: 0.6,
              className: 'link-line link-line--hover-outline',
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
            opacity: healthOpacity,
            dashArray: linkDashArray || baseLinkStyle.dashArray,
            className: `link-line link-line--health${linkStateClass}`,
            weight: isSelectedLink ? 4.4 : (isHoveredLink ? 3.4 : baseLinkStyle.weight),
            interactive: false,
          }}
        />
        <Polyline
          ref={flowLineRefCallback}
          eventHandlers={{
            click: (event) => {
              setSelectedLinkId(link.id);
              event.target?.openPopup?.();
            },
          }}
          positions={linkPositions}
          pathOptions={{
            color: healthColor,
            weight: highlightWeight,
            opacity: isSelectedLink ? 1 : (isHoveredLink ? 0.95 : (flowOpacity ?? 0.88)),
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
              setFocusRequestId(null);
              setSelectedLinkId(link.id);
              event.target?.openPopup?.();
            },
          }}
          pathOptions={{
            color: '#ffffff',
            weight: isSelectedLink ? 18 : (isHoveredLink ? 16 : 14),
            opacity: 0,
            className: `link-hit-area${isHoveredLink ? ' link-hit-area--hover' : ''}${isSelectedLink ? ' link-hit-area--selected' : ''}`,
            interactive: true,
          }}
        >
          {linkPopupContent}
        </Polyline>
      </React.Fragment>
    );
  });

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
            <p className="tracking-[0.2em] uppercase text-[10px] text-cyan-200/90">Phase 1 Controls</p>
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
          title="History Playback"
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
            <div className="text-[10px] text-slate-300">
              {playbackMode === 'playback' ? 'Playback Mode' : 'Live Mode'}
            </div>
          </div>
          {playbackMode === 'playback' ? (
            <div className="mt-2">
              <div className="flex gap-2">
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
                className="mt-2 w-full"
                disabled={!playbackFrames.length}
              />
              <div className="mt-1 text-slate-300">
                Frame {playbackFrames.length ? (playbackFrameIndex + 1) : 0}/{playbackFrames.length}
                {' | '}
                Time: {formatTimestamp(activePlaybackFrame?.timestamp)}
              </div>
              {playbackError ? (
                <div className="mt-1 text-amber-200">{playbackError}</div>
              ) : null}
            </div>
          ) : (
            <div className="mt-1 text-slate-300">
              Live mode (polling enabled). Switch to Playback for history replay.
              {playbackError ? ` ${playbackError}` : ''}
            </div>
          )}
        </CollapsibleSection>
        <CollapsibleSection
          title="Python Command"
          isOpen={!!controlPanelSections.python}
          onToggle={() => handleToggleControlSection('python')}
          className="mt-3"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={commandNodeId}
              onChange={(event) => setCommandNodeId(event.target.value)}
              className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none"
              placeholder="Node ID (e.g. U-FE-001)"
            />
            <select
              value={commandNodeStatus}
              onChange={(event) => setCommandNodeStatus(event.target.value)}
              className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 focus:outline-none"
            >
              <option value="normal">normal</option>
              <option value="busy">busy</option>
              <option value="offline">offline</option>
              <option value="error">error</option>
            </select>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleAddNodeCommand}
              disabled={commandBusy}
              className="rounded-md border border-emerald-300/40 bg-emerald-400/10 px-2 py-1 text-xs hover:bg-emerald-400/20 disabled:opacity-60"
            >
              Add Node
            </button>
            <button
              type="button"
              onClick={handleRemoveNodeCommand}
              disabled={commandBusy}
              className="rounded-md border border-rose-300/40 bg-rose-400/10 px-2 py-1 text-xs hover:bg-rose-400/20 disabled:opacity-60"
            >
              Remove Node
            </button>
            <button
              type="button"
              onClick={handleUpdateNodeStatusCommand}
              disabled={commandBusy}
              className="rounded-md border border-amber-300/40 bg-amber-400/10 px-2 py-1 text-xs hover:bg-amber-400/20 disabled:opacity-60"
            >
              Update Status
            </button>
          </div>
          {commandResult ? (
            <div className="mt-2 text-[11px] text-cyan-200">{commandResult}</div>
          ) : null}
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
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-white/15 bg-white/5 p-2">
              <div className="text-slate-300">Online Nodes</div>
              <div className="mt-1 text-sm font-semibold text-emerald-200">
                {kpiData.onlineNodes}/{kpiData.totalNodes}
              </div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-2">
              <div className="text-slate-300">Active Alerts</div>
              <div className="mt-1 text-sm font-semibold text-rose-200">{kpiData.activeAlerts}</div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-2">
              <div className="text-slate-300">Avg Delay</div>
              <div className="mt-1 text-sm font-semibold text-cyan-100">
                {formatMetricNumber(kpiData.avgDelay, 1)} ms
              </div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/5 p-2">
              <div className="text-slate-300">Avg Loss / Util</div>
              <div className="mt-1 text-sm font-semibold text-cyan-100">
                {formatMetricPercent(kpiData.avgLoss, 2)} / {formatMetricPercent(kpiData.avgUtilization, 1)}
              </div>
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
          </div>
        ) : null}
        <CollapsibleSection
          title="Recent Alerts"
          isOpen={!!controlPanelSections.alerts}
          onToggle={() => handleToggleControlSection('alerts')}
          className="mt-2"
        >
          {effectiveAlerts.length ? (
            <ul className="space-y-1 text-slate-300">
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
            <div className="text-slate-400">No active alerts</div>
          )}
        </CollapsibleSection>
        <div className="mt-2 rounded-lg border border-white/15 bg-white/5 p-2 text-[11px]">
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
          {mapViewMode === '3d' ? '3D mode for altitude-aware display.' : '2D mode for static topology display.'}
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
            attribution="&copy; OpenStreetMap contributors"
          />
          {nodeHaloElements}
          {markerElements}
          {linkElements}
        </MapContainer>
      ) : (
        <Map3DView
          nodes={visibleNodes}
          links={visibleLinks}
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
