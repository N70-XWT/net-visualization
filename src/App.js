import './App.css';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
<<<<<<< HEAD
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
=======
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
>>>>>>> codex-save-1
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import NodeList from './NodeList';
import Map3DView from './Map3DView';

import { mockTopology } from './services/mockTopologyData';
import { buildInitialNodeState } from './services/mockNodeStream';
<<<<<<< HEAD
=======
import {
  getEvents,
  getLinkById,
  getNodeById,
  getSituationCurrent,
  getTopology,
} from './services/networkApi';
>>>>>>> codex-save-1

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

function App() {
<<<<<<< HEAD
  const baseNodes = useMemo(() => mockTopology.nodes, []);
  const links = useMemo(() => mockTopology.links, []);
  const crossLayerRelations = useMemo(() => mockTopology.crossLayerRelations, []);
=======
  const [topologyData, setTopologyData] = useState(() => ({
    nodes: mockTopology.nodes,
    links: mockTopology.links,
    crossLayerRelations: mockTopology.crossLayerRelations,
  }));
  const [dataSource, setDataSource] = useState('mock');
  const [apiError, setApiError] = useState('');
  const [situationCurrent, setSituationCurrent] = useState(null);
  const [events, setEvents] = useState([]);
  const [nodeDetailsById, setNodeDetailsById] = useState({});
  const [linkDetailsById, setLinkDetailsById] = useState({});

  const baseNodes = useMemo(
    () => (Array.isArray(topologyData.nodes) ? topologyData.nodes : []),
    [topologyData.nodes]
  );
  const links = useMemo(
    () => (Array.isArray(topologyData.links) ? topologyData.links : []),
    [topologyData.links]
  );
  const crossLayerRelations = useMemo(
    () => (Array.isArray(topologyData.crossLayerRelations) ? topologyData.crossLayerRelations : []),
    [topologyData.crossLayerRelations]
  );
>>>>>>> codex-save-1

  const markerRefsById = useRef({});
  const linkPolylineRefsById = useRef({});
  const nodeStateRef = useRef(buildInitialNodeState(baseNodes));

  const mapRef = useRef(null);
  const nodeMapRef = useRef(buildNodeMap(baseNodes));

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
<<<<<<< HEAD
  const [selectedLinkId, setSelectedLinkId] = useState(null);
=======
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedLinkId, setSelectedLinkId] = useState(null);
  const [hoveredLinkId, setHoveredLinkId] = useState(null);
>>>>>>> codex-save-1
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

<<<<<<< HEAD
  const selectedLink = useMemo(
    () => visibleLinks.find((item) => item.id === selectedLinkId) || null,
    [selectedLinkId, visibleLinks]
  );
=======
  const selectedLink = useMemo(() => {
    const matched = visibleLinks.find((item) => item.id === selectedLinkId);
    if (!matched) {
      return null;
    }
    return linkDetailsById[selectedLinkId] || matched;
  }, [linkDetailsById, selectedLinkId, visibleLinks]);
>>>>>>> codex-save-1

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

  useEffect(() => {
<<<<<<< HEAD
    if (selectedNodeId && !visibleNodeSet.has(selectedNodeId)) {
      setSelectedNodeId(null);
      setFocusRequestId(null);
=======
    let cancelled = false;

    const loadTopology = async () => {
      try {
        const topology = await getTopology();
        if (cancelled) {
          return;
        }

        setTopologyData({
          nodes: Array.isArray(topology?.nodes) ? topology.nodes : [],
          links: Array.isArray(topology?.links) ? topology.links : [],
          crossLayerRelations: Array.isArray(topology?.crossLayerRelations) ? topology.crossLayerRelations : [],
        });
        setDataSource('api');
        setApiError('');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setDataSource('mock');
        setApiError(error?.message || 'Failed to load topology from REST API');
      }
    };

    loadTopology();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSituationAndEvents = async () => {
      try {
        const [situation, eventItems] = await Promise.all([
          getSituationCurrent(),
          getEvents(20),
        ]);
        if (cancelled) {
          return;
        }

        setSituationCurrent(situation || null);
        setEvents(Array.isArray(eventItems) ? eventItems : []);
      } catch (error) {
        if (cancelled) {
          return;
        }
        // Keep this non-blocking for topology rendering.
      }
    };

    loadSituationAndEvents();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedNodeId) {
      return undefined;
>>>>>>> codex-save-1
    }
  }, [selectedNodeId, visibleNodeSet]);

<<<<<<< HEAD
=======
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
  }, [selectedNodeId]);

  useEffect(() => {
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
  }, [selectedLinkId]);

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

>>>>>>> codex-save-1
  useEffect(() => {
    if (selectedLinkId && !visibleLinks.some((item) => item.id === selectedLinkId)) {
      setSelectedLinkId(null);
    }
  }, [selectedLinkId, visibleLinks]);
<<<<<<< HEAD
=======

  useEffect(() => {
    if (hoveredLinkId && !visibleLinks.some((item) => item.id === hoveredLinkId)) {
      setHoveredLinkId(null);
    }
  }, [hoveredLinkId, visibleLinks]);
>>>>>>> codex-save-1

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

<<<<<<< HEAD
  const markerElements = useMemo(() => visibleNodes.map((node) => {
    const typeMeta = NODE_TYPE_META[node.type] || { label: node.type || 'Unknown', color: '#7f7f7f' };
=======
  const nodeHaloElements = useMemo(() => visibleNodes.map((node) => {
    const position = getNodePosition(node);
    if (!position) {
      return null;
    }

    const isSelected = selectedNodeId === node.id;
    const isHovered = hoveredNodeId === node.id && !isSelected;

    return (
      <CircleMarker
        key={`halo-${node.id}`}
        center={position}
        radius={isSelected ? 21 : (isHovered ? 17 : 12)}
        pathOptions={{
          color: '#9de7ff',
          weight: isSelected ? 2.8 : (isHovered ? 2.2 : 1.2),
          opacity: isSelected ? 0.95 : (isHovered ? 0.72 : 0),
          fillColor: '#5ef7c1',
          fillOpacity: isSelected ? 0.22 : (isHovered ? 0.1 : 0),
          className: `node-halo${isHovered ? ' node-halo--hover' : ''}${isSelected ? ' node-halo--selected' : ''}`,
          interactive: false,
        }}
      />
    );
  }), [hoveredNodeId, selectedNodeId, visibleNodes]);

  const markerElements = useMemo(() => visibleNodes.map((node) => {
    const popupNode = nodeDetailsById[node.id] || node;
    const typeMeta = NODE_TYPE_META[popupNode.type] || { label: popupNode.type || 'Unknown', color: '#7f7f7f' };
>>>>>>> codex-save-1
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
<<<<<<< HEAD
=======
          popupclose: () => {
            setSelectedNodeId((prev) => (prev === node.id ? null : prev));
            setFocusRequestId((prev) => (prev === node.id ? null : prev));
          },
          mouseover: () => setHoveredNodeId(node.id),
          mouseout: () => {
            setHoveredNodeId((prev) => (prev === node.id ? null : prev));
          },
>>>>>>> codex-save-1
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
<<<<<<< HEAD
  }), [applyMarkerAltitudeVisual, handleSelectNode, visibleNodes]);

  const linkElements = visibleLinks.map((link) => {
=======
  }), [applyMarkerAltitudeVisual, applyMarkerInteractiveVisual, handleSelectNode, nodeDetailsById, visibleNodes]);

  const linkElements = visibleLinks.map((link) => {
    const linkDetail = linkDetailsById[link.id] || link;
>>>>>>> codex-save-1
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

<<<<<<< HEAD
    const isSelectedLink = selectedLinkId === link.id;
    const highlightWeight = isSelectedLink ? 4.4 : 3;
=======
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
          <div>Bandwidth: {linkDetail.bandwidthMbps ?? '-'} Mbps</div>
          <div>Delay: {linkDetail.delayMs ?? '-'} ms</div>
          <div>Loss: {typeof linkDetail.lossRate === 'number' ? `${(linkDetail.lossRate * 100).toFixed(2)}%` : '-'}</div>
          <div>SNR: {typeof linkDetail.snrDb === 'number' ? `${linkDetail.snrDb} dB` : '-'}</div>
        </div>
      </Popup>
    );
>>>>>>> codex-save-1

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
            opacity: baseOpacity,
<<<<<<< HEAD
            className: 'link-line link-line--health',
            weight: isSelectedLink ? 3.4 : getLinkStyle(link).weight,
=======
            className: `link-line link-line--health${linkStateClass}`,
            weight: isSelectedLink ? 4.4 : (isHoveredLink ? 3.4 : baseLinkStyle.weight),
>>>>>>> codex-save-1
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
<<<<<<< HEAD
            opacity: 0.9,
            className: flowClass,
          }}
        >
          <Popup>
            <div className="text-sm text-slate-900">
              <div className="text-base font-semibold">Link {link.id}</div>
              <div className="mt-1">From: {link.from}</div>
              <div>To: {link.to}</div>
              <div>Type: {link.type}</div>
              <div>Bandwidth: {link.bandwidthMbps ?? '-'} Mbps</div>
              <div>Delay: {link.delayMs ?? '-'} ms</div>
              <div>Loss: {typeof link.lossRate === 'number' ? `${(link.lossRate * 100).toFixed(2)}%` : '-'}</div>
              <div>SNR: {typeof link.snrDb === 'number' ? `${link.snrDb} dB` : '-'}</div>
            </div>
          </Popup>
=======
            opacity: isSelectedLink ? 1 : (isHoveredLink ? 0.95 : 0.88),
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
>>>>>>> codex-save-1
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

<<<<<<< HEAD
      <div className="absolute left-[104px] top-5 z-[1000] w-[320px] rounded-2xl border border-white/20 bg-[#07182fcc] p-3 text-xs text-slate-100 backdrop-blur-xl shadow-2xl">
=======
      <div
        className="absolute top-5 z-[1000] w-[320px] rounded-2xl border border-white/20 bg-[#07182fcc] p-3 text-xs text-slate-100 backdrop-blur-xl shadow-2xl"
        style={{ left: sidebarCollapsed ? 96 : 336 }}
      >
>>>>>>> codex-save-1
        <p className="tracking-[0.2em] uppercase text-[10px] text-cyan-200/90">Phase 1 Controls</p>
        <div className="mt-2 flex gap-2">
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
        </div>
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
        <div className="mt-3 text-[11px] text-slate-300">
          Visible: {visibleNodes.length} nodes / {visibleLinks.length} links / {crossLayerRelations.length} relations
        </div>
<<<<<<< HEAD
=======
        <div className="mt-1 text-[11px] text-slate-300">
          Data Source: {dataSource === 'api' ? 'REST API' : 'Local Mock'}
          {situationCurrent ? ` | Health: ${situationCurrent.healthScore}` : ''}
          {events.length ? ` | Events: ${events.length}` : ''}
        </div>
        {apiError ? (
          <div className="mt-1 text-[11px] text-amber-200">
            API fallback: {apiError}
          </div>
        ) : null}
>>>>>>> codex-save-1
        {selectedLink ? (
          <div className="mt-2 rounded-lg border border-white/15 bg-white/5 p-2 text-[11px]">
            <div className="font-semibold text-slate-100">Selected Link: {selectedLink.id}</div>
            <div className="text-slate-300">{selectedLink.from} -&gt; {selectedLink.to}</div>
          </div>
        ) : null}
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
