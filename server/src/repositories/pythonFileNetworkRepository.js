import fs from 'fs';
import path from 'path';

import { NetworkRepository } from './networkRepository.js';

const DEFAULT_EVENT_STORE_VERSION = '1.0.0';
const VALID_NODE_TYPES = new Set([
  'router',
  'base-station',
  'mesh-node',
  'terminal',
  'satellite',
]);
const VALID_LAYERS = new Set(['backbone', 'access', 'mesh', 'edge']);
const LAYER_RANK = {
  edge: 0,
  mesh: 1,
  access: 2,
  backbone: 3,
};
const DYNAMIC_LINK_ID_PREFIX = 'DYN-LNK-';
const DYNAMIC_RELATION_ID_PREFIX = 'CLR-DYN-';
const DYNAMIC_NODE_DEFS = [
  {
    id: 'MGU-001',
    name: 'Mobile User 01',
    type: 'terminal',
    layer: 'access',
    role: 'dorm-device',
    preferredAnchorId: 'U3',
    zone: 'dorm-area',
    motion: {
      radiusLatM: 36,
      radiusLngM: 24,
      periodSec: 180,
      phaseDeg: 24,
    },
    altitudeBase: 1.8,
    altitudeWaveM: 0.6,
  },
  {
    id: 'MGU-002',
    name: 'Mobile User 02',
    type: 'terminal',
    layer: 'access',
    role: 'classroom-terminal',
    preferredAnchorId: 'U8',
    zone: 'teaching-area',
    motion: {
      radiusLatM: 32,
      radiusLngM: 18,
      periodSec: 210,
      phaseDeg: 166,
    },
    altitudeBase: 1.6,
    altitudeWaveM: 0.5,
  },
  {
    id: 'MUAV-001',
    name: 'UAV Relay 01',
    type: 'mesh-node',
    layer: 'mesh',
    role: 'edge-server',
    preferredAnchorId: 'A2',
    zone: 'lab-area',
    motion: {
      radiusLatM: 130,
      radiusLngM: 96,
      periodSec: 240,
      phaseDeg: 52,
    },
    altitudeBase: 30,
    altitudeWaveM: 6,
  },
  {
    id: 'MUAV-002',
    name: 'UAV Relay 02',
    type: 'mesh-node',
    layer: 'mesh',
    role: 'edge-server',
    preferredAnchorId: 'A4',
    zone: 'stadium-area',
    motion: {
      radiusLatM: 110,
      radiusLngM: 84,
      periodSec: 255,
      phaseDeg: 218,
    },
    altitudeBase: 27,
    altitudeWaveM: 5.5,
  },
];
const DYNAMIC_NODE_ID_SET = new Set(DYNAMIC_NODE_DEFS.map((item) => item.id));
const DEFAULT_MOTION_CENTER = { lat: 34.1246, lng: 108.8339 };
const LAYER_CENTER_BY_KEY = {
  access: { lat: 34.1262, lng: 108.8328 },
  mesh: { lat: 34.1244, lng: 108.8345 },
  backbone: { lat: 34.1239, lng: 108.8362 },
  edge: { lat: 34.1265, lng: 108.8332 },
};
const DYNAMIC_DEFAULT_CANDIDATE_IDS = {
  access: ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8', 'U9', 'U10'],
  mesh: ['A1', 'A2', 'A3', 'A4', 'A5'],
  backbone: ['B1', 'B2', 'B3'],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundNumber(value, digits = 6) {
  return Number(toFiniteNumber(value, 0).toFixed(digits));
}

function hashString(input) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toSafeString(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function toIsoTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function metersToLatDelta(meters) {
  return toFiniteNumber(meters, 0) / 111000;
}

function metersToLngDelta(meters, lat) {
  const safeLat = toFiniteNumber(lat, DEFAULT_MOTION_CENTER.lat);
  const metersPerDeg = 111000 * Math.cos(toRadians(safeLat));
  if (!metersPerDeg) {
    return 0;
  }
  return toFiniteNumber(meters, 0) / metersPerDeg;
}

function parseTimestamp(value) {
  const parsed = Date.parse(value || 0);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function distanceMeters(fromGeo, toGeo) {
  if (!fromGeo || !toGeo) {
    return Number.POSITIVE_INFINITY;
  }

  const fromLat = toFiniteNumber(fromGeo.lat, NaN);
  const fromLng = toFiniteNumber(fromGeo.lng, NaN);
  const toLat = toFiniteNumber(toGeo.lat, NaN);
  const toLng = toFiniteNumber(toGeo.lng, NaN);
  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLng) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLng)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const avgLatRad = toRadians((fromLat + toLat) / 2);
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);
  const x = deltaLng * Math.cos(avgLatRad);
  const y = deltaLat;
  return Math.sqrt((x * x) + (y * y)) * 6371000;
}

function isInsideCampusMotionWindow(geo) {
  if (!geo) {
    return false;
  }
  const lat = toFiniteNumber(geo.lat, NaN);
  const lng = toFiniteNumber(geo.lng, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  return lat >= 34.118 && lat <= 34.132 && lng >= 108.826 && lng <= 108.842;
}

function getLayerMotionCenter(layer) {
  return LAYER_CENTER_BY_KEY[layer] || DEFAULT_MOTION_CENTER;
}

function buildVirtualAnchorGeo(nodeId, layer) {
  const center = getLayerMotionCenter(layer);
  const hash = Math.abs(hashString(nodeId));
  const angle = ((hash % 360) * Math.PI) / 180;
  const latRadiusM = layer === 'backbone' ? 90 : (layer === 'mesh' ? 120 : 135);
  const lngRadiusM = layer === 'backbone' ? 120 : (layer === 'mesh' ? 95 : 80);
  const lat = center.lat + metersToLatDelta(Math.sin(angle) * latRadiusM);
  const lng = center.lng + metersToLngDelta(Math.cos(angle) * lngRadiusM, center.lat);
  return {
    lat: roundNumber(lat, 6),
    lng: roundNumber(lng, 6),
    altitude: layer === 'backbone' ? 44 : (layer === 'mesh' ? 22 : 6),
  };
}

function buildOrbitGeo(anchorGeo, nodeDef, elapsedSec) {
  const motion = nodeDef.motion || {};
  const baseLat = toFiniteNumber(anchorGeo?.lat, DEFAULT_MOTION_CENTER.lat);
  const baseLng = toFiniteNumber(anchorGeo?.lng, DEFAULT_MOTION_CENTER.lng);
  const periodSec = Math.max(60, toFiniteNumber(motion.periodSec, 180));
  const phaseRad = toRadians(toFiniteNumber(motion.phaseDeg, 0));
  const angle = ((elapsedSec / periodSec) * Math.PI * 2) + phaseRad;
  const latRadius = toFiniteNumber(motion.radiusLatM, 25);
  const lngRadius = toFiniteNumber(motion.radiusLngM, 25);
  const altitudeBase = toFiniteNumber(nodeDef.altitudeBase, 0);
  const altitudeWave = toFiniteNumber(nodeDef.altitudeWaveM, 0);

  return {
    lat: roundNumber(baseLat + metersToLatDelta(Math.sin(angle) * latRadius), 6),
    lng: roundNumber(baseLng + metersToLngDelta(Math.cos(angle) * lngRadius, baseLat), 6),
    altitude: roundNumber(Math.max(0, altitudeBase + altitudeWave * Math.sin(angle * 0.75)), 2),
  };
}

function normalizeNodeGeoForMotion(node) {
  const geo = node?.location?.geo;
  if (isInsideCampusMotionWindow(geo)) {
    return {
      lat: roundNumber(geo.lat, 6),
      lng: roundNumber(geo.lng, 6),
      altitude: roundNumber(geo.altitude, 2),
    };
  }
  return buildVirtualAnchorGeo(node?.id || '', node?.layer || 'access');
}

function buildDynamicRelationFromLink(link, nodeById, index) {
  const fromNode = nodeById.get(link.from);
  const toNode = nodeById.get(link.to);
  if (!fromNode || !toNode) {
    return null;
  }

  const fromLayer = String(fromNode.layer || '').toLowerCase();
  const toLayer = String(toNode.layer || '').toLowerCase();
  let relationType = 'relay';
  if (fromLayer !== toLayer) {
    relationType =
      fromLayer === 'access' || toLayer === 'access'
        ? 'access'
        : 'backhaul';
  }

  return {
    id: `${DYNAMIC_RELATION_ID_PREFIX}${String(index).padStart(3, '0')}`,
    fromNodeId: link.from,
    toNodeId: link.to,
    relationType,
    notes: `Derived from ${link.id}`,
  };
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) {
      return null;
    }
    return JSON.parse(content);
  } catch (_error) {
    return null;
  }
}

function normalizeNodeType(rawType) {
  const type = String(rawType || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');

  if (type === 'adhoc-node') {
    return 'mesh-node';
  }
  if (type === 'base-station') {
    return 'base-station';
  }
  if (VALID_NODE_TYPES.has(type)) {
    return type;
  }
  return 'terminal';
}

function normalizeLayer(rawLayer, normalizedType) {
  const layer = String(rawLayer || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');

  if (layer === 'adhoc') {
    return 'mesh';
  }
  if (layer === 'terminal') {
    return 'edge';
  }
  if (VALID_LAYERS.has(layer)) {
    return layer;
  }

  if (normalizedType === 'mesh-node') {
    return 'mesh';
  }
  if (normalizedType === 'terminal') {
    return 'edge';
  }
  if (normalizedType === 'router' || normalizedType === 'satellite') {
    return 'backbone';
  }
  return 'access';
}

function normalizeStatus(rawStatus, online) {
  const status = String(rawStatus || '')
    .trim()
    .toLowerCase();

  if (online === false) {
    return 'offline';
  }
  if (status === 'offline' || status === 'error' || status === 'down') {
    return 'offline';
  }
  if (status === 'warning' || status === 'degraded' || status === 'danger') {
    return 'warning';
  }
  if (status === 'busy') {
    return 'busy';
  }
  return 'normal';
}

function normalizeLinkType(rawType) {
  const type = String(rawType || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (type === 'wired' || type === 'wireless') {
    return type;
  }
  return 'wireless';
}

function normalizeStoredEvents(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((item) => item && typeof item === 'object');
  }
  if (rawValue && typeof rawValue === 'object' && Array.isArray(rawValue.events)) {
    return rawValue.events.filter((item) => item && typeof item === 'object');
  }
  return [];
}

function sortEventsByTimeDesc(events) {
  return [...events].sort((a, b) => parseTimestamp(b?.occurredAt) - parseTimestamp(a?.occurredAt));
}

function buildCrossLayerRelations(nodes, links) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const relations = [];
  let counter = 1;

  links.forEach((link) => {
    const fromNode = nodeMap.get(link.from);
    const toNode = nodeMap.get(link.to);
    if (!fromNode || !toNode) {
      return;
    }
    if (fromNode.layer === toNode.layer) {
      return;
    }

    let leftNode = fromNode;
    let rightNode = toNode;
    if ((LAYER_RANK[leftNode.layer] ?? 0) > (LAYER_RANK[rightNode.layer] ?? 0)) {
      leftNode = toNode;
      rightNode = fromNode;
    }

    const relationType =
      leftNode.layer === 'edge' || rightNode.layer === 'edge' ? 'access' : 'backhaul';
    const dedupeKey = `${leftNode.id}|${rightNode.id}|${relationType}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);

    relations.push({
      id: `CLR-PY-${String(counter).padStart(3, '0')}`,
      fromNodeId: leftNode.id,
      toNodeId: rightNode.id,
      relationType,
      notes: `Derived from link ${link.id}`,
    });
    counter += 1;
  });

  return relations;
}

function computeDefaultAvailability(linkHealth, linkLossRate) {
  if (typeof linkLossRate === 'number') {
    return clamp(1 - linkLossRate, 0.8, 0.999);
  }
  const health = String(linkHealth || '').toLowerCase();
  if (health === 'danger') {
    return 0.88;
  }
  if (health === 'warning') {
    return 0.94;
  }
  return 0.99;
}

function mapNodeFromPython(rawNode) {
  const nodeId = toSafeString(rawNode?.id || rawNode?.node_id, '');
  if (!nodeId) {
    return null;
  }

  const normalizedType = normalizeNodeType(rawNode?.type || rawNode?.node_type);
  const normalizedLayer = normalizeLayer(rawNode?.layer, normalizedType);

  const explicitOnline =
    typeof rawNode?.state?.online === 'boolean'
      ? rawNode.state.online
      : typeof rawNode?.online === 'boolean'
        ? rawNode.online
        : true;

  const rawStatus =
    rawNode?.state?.status ||
    rawNode?.state ||
    rawNode?.alarmLevel ||
    (explicitOnline ? 'online' : 'offline');
  const normalizedStatus = normalizeStatus(rawStatus, explicitOnline);

  const geo = rawNode?.location?.geo || {};
  const lat = toFiniteNumber(geo.lat, 0);
  const lng = toFiniteNumber(geo.lng, 0);
  const altitude = toFiniteNumber(geo.altitude, 0);

  const lastSeenRaw =
    rawNode?.state?.lastSeen ??
    rawNode?.lastSeen ??
    rawNode?.last_update ??
    rawNode?.lastUpdate ??
    Date.now();

  return {
    id: nodeId,
    name: toSafeString(rawNode?.name, nodeId),
    type: normalizedType,
    layer: normalizedLayer,
    location: {
      geo: {
        lat,
        lng,
        altitude,
      },
    },
    state: {
      online: explicitOnline && normalizedStatus !== 'offline',
      status: normalizedStatus,
      lastSeen: toIsoTimestamp(lastSeenRaw),
    },
    metrics:
      rawNode?.metrics && typeof rawNode.metrics === 'object' && !Array.isArray(rawNode.metrics)
        ? clone(rawNode.metrics)
        : undefined,
    role: toSafeString(rawNode?.role, undefined),
    alarmLevel: toSafeString(rawNode?.alarmLevel, undefined),
  };
}

function mapLinkFromPython(rawLink) {
  const linkId = toSafeString(rawLink?.id, '');
  const from = toSafeString(rawLink?.from || rawLink?.src, '');
  const to = toSafeString(rawLink?.to || rawLink?.dst, '');
  if (!linkId || !from || !to) {
    return null;
  }

  const lossRate =
    rawLink?.lossRate !== undefined
      ? toFiniteNumber(rawLink.lossRate, 0)
      : toFiniteNumber(rawLink?.loss, 0);

  const health = toSafeString(rawLink?.health, 'good');

  return {
    id: linkId,
    from,
    to,
    type: normalizeLinkType(rawLink?.type || rawLink?.link_type),
    bandwidthMbps: toFiniteNumber(rawLink?.bandwidthMbps ?? rawLink?.bandwidth, 0),
    delayMs: toFiniteNumber(rawLink?.delayMs ?? rawLink?.delay, 0),
    lossRate,
    snrDb:
      rawLink?.snrDb !== undefined || rawLink?.snr !== undefined
        ? toFiniteNumber(rawLink?.snrDb ?? rawLink?.snr, 0)
        : undefined,
    utilization:
      rawLink?.utilization !== undefined ? clamp(toFiniteNumber(rawLink.utilization, 0), 0, 1) : undefined,
    availability:
      rawLink?.availability !== undefined
        ? clamp(toFiniteNumber(rawLink.availability, 0.99), 0, 1)
        : computeDefaultAvailability(health, lossRate),
    health,
    state: toSafeString(rawLink?.state, 'up'),
    lastUpdate: toIsoTimestamp(rawLink?.lastUpdate ?? rawLink?.last_update ?? Date.now()),
  };
}

function mapNodeEventFromPython(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }
  const payload = rawEvent.payload && typeof rawEvent.payload === 'object' ? rawEvent.payload : {};
  const nodeId = toSafeString(payload.nodeId, '');
  if (!nodeId) {
    return null;
  }

  const status = normalizeStatus(payload?.changes?.state?.status, payload?.changes?.state?.online);
  let severity = 'info';
  if (status === 'offline') {
    severity = 'critical';
  } else if (status === 'warning' || status === 'busy') {
    severity = 'warning';
  }

  return {
    id: `EV-PY-NODE-${nodeId}-${toFiniteNumber(rawEvent.timestamp, Date.now())}`,
    type: 'node:update',
    severity,
    entityType: 'node',
    entityId: nodeId,
    message: `Node ${nodeId} updated (status: ${status})`,
    status: 'open',
    occurredAt: toIsoTimestamp(rawEvent.timestamp),
    source: 'python-export',
    payload: clone(payload),
  };
}

function mapNodeAddEventFromPython(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }
  const payload = rawEvent.payload && typeof rawEvent.payload === 'object' ? rawEvent.payload : {};
  const rawNode = payload.node && typeof payload.node === 'object' ? payload.node : null;
  const mappedNode = rawNode ? mapNodeFromPython(rawNode) : null;
  const nodeId = mappedNode?.id || toSafeString(rawNode?.id || rawNode?.node_id, '');
  if (!nodeId) {
    return null;
  }

  return {
    id: `EV-PY-NODE-ADD-${nodeId}-${toFiniteNumber(rawEvent.timestamp, Date.now())}`,
    type: 'node:add',
    severity: 'info',
    entityType: 'node',
    entityId: nodeId,
    message: `Node ${nodeId} added`,
    status: 'open',
    occurredAt: toIsoTimestamp(rawEvent.timestamp),
    source: 'python-export',
    payload: clone(payload),
  };
}

function mapNodeRemoveEventFromPython(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }
  const payload = rawEvent.payload && typeof rawEvent.payload === 'object' ? rawEvent.payload : {};
  const nodeId = toSafeString(payload.nodeId, '');
  if (!nodeId) {
    return null;
  }

  return {
    id: `EV-PY-NODE-REMOVE-${nodeId}-${toFiniteNumber(rawEvent.timestamp, Date.now())}`,
    type: 'node:remove',
    severity: 'major',
    entityType: 'node',
    entityId: nodeId,
    message: `Node ${nodeId} removed`,
    status: 'open',
    occurredAt: toIsoTimestamp(rawEvent.timestamp),
    source: 'python-export',
    payload: clone(payload),
  };
}

function mapLinkEventFromPython(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }
  const payload = rawEvent.payload && typeof rawEvent.payload === 'object' ? rawEvent.payload : {};
  const linkId = toSafeString(payload.linkId, '');
  if (!linkId) {
    return null;
  }

  const changes = payload?.changes && typeof payload.changes === 'object' ? payload.changes : {};
  const lossRate = toFiniteNumber(changes.lossRate, 0);
  const snrDb = toFiniteNumber(changes.snrDb, 100);
  const health = toSafeString(changes.health, '').toLowerCase();

  let severity = 'info';
  if (health === 'danger' || lossRate >= 0.08 || snrDb < 10) {
    severity = 'critical';
  } else if (health === 'warning' || lossRate >= 0.03 || snrDb < 18) {
    severity = 'major';
  }

  return {
    id: `EV-PY-LINK-${linkId}-${toFiniteNumber(rawEvent.timestamp, Date.now())}`,
    type: 'link:update',
    severity,
    entityType: 'link',
    entityId: linkId,
    message: `Link ${linkId} updated`,
    status: 'open',
    occurredAt: toIsoTimestamp(rawEvent.timestamp),
    source: 'python-export',
    payload: clone(payload),
  };
}

function mapLinkAddEventFromPython(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }
  const payload = rawEvent.payload && typeof rawEvent.payload === 'object' ? rawEvent.payload : {};
  const rawLink = payload.link && typeof payload.link === 'object' ? payload.link : null;
  const mappedLink = rawLink ? mapLinkFromPython(rawLink) : null;
  const linkId = mappedLink?.id || toSafeString(rawLink?.id, '');
  if (!linkId) {
    return null;
  }

  return {
    id: `EV-PY-LINK-ADD-${linkId}-${toFiniteNumber(rawEvent.timestamp, Date.now())}`,
    type: 'link:add',
    severity: 'info',
    entityType: 'link',
    entityId: linkId,
    message: `Link ${linkId} added`,
    status: 'open',
    occurredAt: toIsoTimestamp(rawEvent.timestamp),
    source: 'python-export',
    payload: clone(payload),
  };
}

function mapLinkRemoveEventFromPython(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }
  const payload = rawEvent.payload && typeof rawEvent.payload === 'object' ? rawEvent.payload : {};
  const linkId = toSafeString(payload.linkId, '');
  if (!linkId) {
    return null;
  }

  return {
    id: `EV-PY-LINK-REMOVE-${linkId}-${toFiniteNumber(rawEvent.timestamp, Date.now())}`,
    type: 'link:remove',
    severity: 'major',
    entityType: 'link',
    entityId: linkId,
    message: `Link ${linkId} removed`,
    status: 'open',
    occurredAt: toIsoTimestamp(rawEvent.timestamp),
    source: 'python-export',
    payload: clone(payload),
  };
}

export class PythonFileNetworkRepository extends NetworkRepository {
  constructor(options = {}) {
    super();
    this.dataDir = options.dataDir;
    this.runtimeEventsFilePath = options.runtimeEventsFilePath;
    this.fallbackRepository = options.fallbackRepository || null;
    this.dynamicMotionStartMs = Date.now();
    this.dynamicMotionStepMs = Math.max(
      1000,
      Number.parseInt(process.env.DYNAMIC_NODE_STEP_MS || '1000', 10) || 1000
    );
    this.dynamicLinkTargetByKey = new Map();

    this.snapshotFilePath = path.join(this.dataDir, 'snapshot.json');
    this.metricsFilePath = path.join(this.dataDir, 'metrics.json');
    this.nodeEventFilePath = path.join(this.dataDir, 'event_node_update.json');
    this.linkEventFilePath = path.join(this.dataDir, 'event_link_update.json');
  }

  isPythonDataAvailable() {
    const snapshot = readJsonFileSafe(this.snapshotFilePath);
    return !!(snapshot && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.links));
  }

  #loadTopologyFromPython() {
    const snapshot = readJsonFileSafe(this.snapshotFilePath);
    if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.links)) {
      return null;
    }

    const nodes = snapshot.nodes.map(mapNodeFromPython).filter(Boolean);
    const links = snapshot.links.map(mapLinkFromPython).filter(Boolean);
    const crossLayerRelations = buildCrossLayerRelations(nodes, links);

    return {
      meta: {
        name: 'python-export-topology',
        version: '1.0.0',
        updatedAt: toIsoTimestamp(snapshot.timestamp),
        source: 'Project-001/snapshot.json',
      },
      nodes,
      links,
      crossLayerRelations,
    };
  }

  #loadMetricsFromPython() {
    const metrics = readJsonFileSafe(this.metricsFilePath);
    if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
      return null;
    }
    return metrics;
  }

  #loadPythonEvents() {
    const nodeEvent = mapNodeEventFromPython(readJsonFileSafe(this.nodeEventFilePath));
    const linkEvent = mapLinkEventFromPython(readJsonFileSafe(this.linkEventFilePath));
    const nodeAddEvent = mapNodeAddEventFromPython(
      readJsonFileSafe(path.join(this.dataDir, 'event_node_add.json'))
    );
    const nodeRemoveEvent = mapNodeRemoveEventFromPython(
      readJsonFileSafe(path.join(this.dataDir, 'event_node_remove.json'))
    );
    const linkAddEvent = mapLinkAddEventFromPython(
      readJsonFileSafe(path.join(this.dataDir, 'event_link_add.json'))
    );
    const linkRemoveEvent = mapLinkRemoveEventFromPython(
      readJsonFileSafe(path.join(this.dataDir, 'event_link_remove.json'))
    );

    return sortEventsByTimeDesc(
      [
        nodeEvent,
        linkEvent,
        nodeAddEvent,
        nodeRemoveEvent,
        linkAddEvent,
        linkRemoveEvent,
      ].filter(Boolean)
    );
  }

  #loadRuntimeEvents() {
    const data = readJsonFileSafe(this.runtimeEventsFilePath);
    return sortEventsByTimeDesc(normalizeStoredEvents(data));
  }

  #persistRuntimeEvents(events) {
    const dir = path.dirname(this.runtimeEventsFilePath);
    fs.mkdirSync(dir, { recursive: true });

    const payload = {
      version: DEFAULT_EVENT_STORE_VERSION,
      updatedAt: new Date().toISOString(),
      events: sortEventsByTimeDesc(events),
    };
    fs.writeFileSync(this.runtimeEventsFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  #resolveCandidateIds(baseNodes, layerKey) {
    const filtered = baseNodes
      .filter((node) => node && !DYNAMIC_NODE_ID_SET.has(node.id) && String(node.layer || '') === layerKey)
      .map((node) => node.id);
    if (filtered.length) {
      return filtered;
    }

    const nodeIdSet = new Set(
      baseNodes
        .filter((node) => node && !DYNAMIC_NODE_ID_SET.has(node.id))
        .map((node) => node.id)
    );
    const fallbackIds = DYNAMIC_DEFAULT_CANDIDATE_IDS[layerKey] || [];
    const fallback = fallbackIds.filter((nodeId) => nodeIdSet.has(nodeId));
    if (fallback.length) {
      return fallback;
    }

    return baseNodes
      .filter((node) => node && !DYNAMIC_NODE_ID_SET.has(node.id))
      .map((node) => node.id)
      .slice(0, 6);
  }

  #pickAnchorWithHysteresis(key, movingGeo, candidateIds, geoByNodeId, hysteresisMeters = 30) {
    if (!movingGeo || !Array.isArray(candidateIds) || !candidateIds.length) {
      this.dynamicLinkTargetByKey.delete(key);
      return null;
    }

    const candidates = candidateIds
      .map((candidateId) => {
        const targetGeo = geoByNodeId.get(candidateId);
        if (!targetGeo) {
          return null;
        }
        return {
          id: candidateId,
          distance: distanceMeters(movingGeo, targetGeo),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.distance - right.distance);

    if (!candidates.length) {
      this.dynamicLinkTargetByKey.delete(key);
      return null;
    }

    const best = candidates[0];
    const previousId = this.dynamicLinkTargetByKey.get(key);
    const previousCandidate = previousId
      ? candidates.find((item) => item.id === previousId)
      : null;
    const selected =
      previousCandidate &&
      previousCandidate.id !== best.id &&
      best.distance + Math.max(5, toFiniteNumber(hysteresisMeters, 30)) >= previousCandidate.distance
        ? previousCandidate
        : best;

    this.dynamicLinkTargetByKey.set(key, selected.id);
    return selected;
  }

  #buildDynamicLink(definition, geoByNodeId, elapsedSec, timestampIso) {
    const from = String(definition?.from || '').trim();
    const to = String(definition?.to || '').trim();
    const id = String(definition?.id || '').trim();
    if (!from || !to || !id || from === to) {
      return null;
    }

    const fromGeo = geoByNodeId.get(from);
    const toGeo = geoByNodeId.get(to);
    if (!fromGeo || !toGeo) {
      return null;
    }

    const profile = definition?.profile && typeof definition.profile === 'object'
      ? definition.profile
      : {};
    const distance = distanceMeters(fromGeo, toGeo);
    const phaseRad = toRadians(hashString(id) % 360);
    const periodSec = Math.max(90, toFiniteNumber(profile.periodSec, 180));
    const wave = 0.5 + (0.5 * Math.sin(((elapsedSec / periodSec) * Math.PI * 2) + phaseRad));

    const bandwidthBase = Math.max(20, toFiniteNumber(profile.bandwidthMbps, 120));
    const delayBase = Math.max(1, toFiniteNumber(profile.delayMs, 10));
    const lossBase = clamp(toFiniteNumber(profile.lossRate, 0.01), 0.001, 0.09);
    const utilBase = clamp(toFiniteNumber(profile.utilization, 0.42), 0.15, 0.92);
    const snrBase = Math.max(10, toFiniteNumber(profile.snrDb, 24));

    const bandwidthMbps = roundNumber(bandwidthBase * (0.9 + (0.2 * wave)), 2);
    const delayMs = roundNumber(delayBase + (distance / 240) + (wave * 2.4), 2);
    const lossRate = clamp(lossBase + (distance / 190000) + (wave * 0.004), 0.001, 0.12);
    const utilization = clamp(utilBase + ((wave - 0.5) * 0.22), 0.12, 0.98);
    const snrDb = roundNumber(Math.max(8, snrBase - (distance / 150) + (Math.cos(phaseRad + (elapsedSec / 27)) * 2)), 2);
    const availability = clamp(1 - (lossRate * 1.15), 0.88, 0.999);

    let health = 'good';
    if (lossRate >= 0.05 || snrDb < 13) {
      health = 'danger';
    } else if (lossRate >= 0.02 || snrDb < 18 || utilization >= 0.82) {
      health = 'warning';
    }

    return {
      id,
      from,
      to,
      type: String(definition?.type || 'wireless'),
      bandwidthMbps,
      delayMs,
      lossRate,
      utilization,
      snrDb,
      availability,
      health,
      state: snrDb < 8.5 ? 'down' : 'up',
      lastUpdate: timestampIso,
    };
  }

  #augmentTopologyWithDynamicNodes(topology) {
    const sourceNodes = Array.isArray(topology?.nodes) ? topology.nodes : [];
    const sourceLinks = Array.isArray(topology?.links) ? topology.links : [];
    const sourceRelations = Array.isArray(topology?.crossLayerRelations) ? topology.crossLayerRelations : [];

    const baseNodes = sourceNodes.filter((node) => !DYNAMIC_NODE_ID_SET.has(node?.id));
    const baseLinks = sourceLinks.filter(
      (link) => !String(link?.id || '').startsWith(DYNAMIC_LINK_ID_PREFIX)
    );
    const baseRelations = sourceRelations.filter(
      (relation) => !String(relation?.id || '').startsWith(DYNAMIC_RELATION_ID_PREFIX)
    );

    const baseNodeById = new Map(baseNodes.map((node) => [node.id, node]));
    const geoByNodeId = new Map(
      baseNodes.map((node) => [node.id, normalizeNodeGeoForMotion(node)])
    );

    const elapsedMs = Math.max(0, Date.now() - this.dynamicMotionStartMs);
    const steppedElapsedMs =
      Math.floor(elapsedMs / this.dynamicMotionStepMs) * this.dynamicMotionStepMs;
    const elapsedSec = steppedElapsedMs / 1000;
    const timestampIso = new Date().toISOString();

    const dynamicNodes = DYNAMIC_NODE_DEFS.map((nodeDef) => {
      const preferredAnchor = baseNodeById.get(nodeDef.preferredAnchorId);
      const anchorGeo = preferredAnchor
        ? normalizeNodeGeoForMotion(preferredAnchor)
        : buildVirtualAnchorGeo(nodeDef.preferredAnchorId || nodeDef.id, nodeDef.layer);
      const orbitGeo = buildOrbitGeo(anchorGeo, nodeDef, elapsedSec);
      geoByNodeId.set(nodeDef.id, orbitGeo);

      const phaseRad = toRadians(toFiniteNumber(nodeDef.motion?.phaseDeg, 0));
      const statusWave = Math.sin(((elapsedSec / Math.max(60, toFiniteNumber(nodeDef.motion?.periodSec, 180))) * Math.PI * 2) + phaseRad);
      const status = statusWave > 0.78 ? 'busy' : 'normal';

      return {
        id: nodeDef.id,
        name: nodeDef.name,
        type: nodeDef.type,
        layer: nodeDef.layer,
        role: nodeDef.role,
        campusZone: nodeDef.zone,
        dynamic: true,
        location: {
          geo: orbitGeo,
        },
        state: {
          online: true,
          status,
          lastSeen: timestampIso,
        },
      };
    });

    const meshCandidateIds = this.#resolveCandidateIds(baseNodes, 'mesh');
    const accessCandidateIds = this.#resolveCandidateIds(baseNodes, 'access');
    const backboneCandidateIds = this.#resolveCandidateIds(baseNodes, 'backbone');
    const dynamicUavIds = dynamicNodes
      .filter((node) => node.layer === 'mesh')
      .map((node) => node.id);

    const dynamicLinks = [];
    const addDynamicLink = (definition) => {
      const nextLink = this.#buildDynamicLink(definition, geoByNodeId, elapsedSec, timestampIso);
      if (nextLink) {
        dynamicLinks.push(nextLink);
      }
    };

    ['MGU-001', 'MGU-002'].forEach((nodeId) => {
      const movingGeo = geoByNodeId.get(nodeId);
      if (!movingGeo) {
        return;
      }

      const accessAnchor = this.#pickAnchorWithHysteresis(
        `${nodeId}:mesh`,
        movingGeo,
        meshCandidateIds,
        geoByNodeId,
        28
      );
      if (accessAnchor) {
        addDynamicLink({
          id: `${DYNAMIC_LINK_ID_PREFIX}${nodeId}-ACCESS`,
          from: nodeId,
          to: accessAnchor.id,
          type: 'wireless',
          profile: {
            periodSec: 160,
            bandwidthMbps: 78,
            delayMs: 9,
            lossRate: 0.009,
            utilization: 0.41,
            snrDb: 27,
          },
        });
      }

      const backupUav = this.#pickAnchorWithHysteresis(
        `${nodeId}:uav`,
        movingGeo,
        dynamicUavIds,
        geoByNodeId,
        24
      );
      if (backupUav) {
        addDynamicLink({
          id: `${DYNAMIC_LINK_ID_PREFIX}${nodeId}-BACKUP`,
          from: nodeId,
          to: backupUav.id,
          type: 'wireless',
          profile: {
            periodSec: 190,
            bandwidthMbps: 52,
            delayMs: 12,
            lossRate: 0.014,
            utilization: 0.38,
            snrDb: 24,
          },
        });
      }
    });

    ['MUAV-001', 'MUAV-002'].forEach((nodeId) => {
      const movingGeo = geoByNodeId.get(nodeId);
      if (!movingGeo) {
        return;
      }

      const groundAnchor = this.#pickAnchorWithHysteresis(
        `${nodeId}:ground`,
        movingGeo,
        accessCandidateIds,
        geoByNodeId,
        46
      );
      if (groundAnchor) {
        addDynamicLink({
          id: `${DYNAMIC_LINK_ID_PREFIX}${nodeId}-GROUND`,
          from: nodeId,
          to: groundAnchor.id,
          type: 'wireless',
          profile: {
            periodSec: 210,
            bandwidthMbps: 180,
            delayMs: 13,
            lossRate: 0.012,
            utilization: 0.47,
            snrDb: 23,
          },
        });
      }

      const backboneAnchor = this.#pickAnchorWithHysteresis(
        `${nodeId}:backbone`,
        movingGeo,
        backboneCandidateIds,
        geoByNodeId,
        70
      );
      if (backboneAnchor) {
        addDynamicLink({
          id: `${DYNAMIC_LINK_ID_PREFIX}${nodeId}-BACKBONE`,
          from: nodeId,
          to: backboneAnchor.id,
          type: 'wireless',
          profile: {
            periodSec: 240,
            bandwidthMbps: 290,
            delayMs: 11,
            lossRate: 0.008,
            utilization: 0.44,
            snrDb: 26,
          },
        });
      }
    });

    if (dynamicUavIds.length >= 2) {
      addDynamicLink({
        id: `${DYNAMIC_LINK_ID_PREFIX}MUAV-MESH`,
        from: dynamicUavIds[0],
        to: dynamicUavIds[1],
        type: 'wireless',
        profile: {
          periodSec: 180,
          bandwidthMbps: 240,
          delayMs: 10,
          lossRate: 0.01,
          utilization: 0.49,
          snrDb: 25,
        },
      });
    }

    const mergedNodes = [...baseNodes, ...dynamicNodes];
    const mergedNodeById = new Map(mergedNodes.map((node) => [node.id, node]));
    const dynamicRelations = dynamicLinks
      .map((link, index) => buildDynamicRelationFromLink(link, mergedNodeById, index + 1))
      .filter(Boolean);

    return {
      ...topology,
      meta: {
        ...(topology?.meta || {}),
        dynamicNodeCount: dynamicNodes.length,
        dynamicLinkCount: dynamicLinks.length,
        dynamicStepMs: this.dynamicMotionStepMs,
      },
      nodes: mergedNodes,
      links: [...baseLinks, ...dynamicLinks],
      crossLayerRelations: [...baseRelations, ...dynamicRelations],
    };
  }

  getTopology() {
    const pythonTopology = this.#loadTopologyFromPython();
    if (pythonTopology) {
      const withDynamicOverlay = this.#augmentTopologyWithDynamicNodes(pythonTopology);
      return clone(withDynamicOverlay);
    }
    if (this.fallbackRepository) {
      return this.fallbackRepository.getTopology();
    }
    return {
      meta: {
        name: 'empty-topology',
        version: '1.0.0',
        updatedAt: new Date().toISOString(),
      },
      nodes: [],
      links: [],
      crossLayerRelations: [],
    };
  }

  getNodeById(nodeId) {
    const topology = this.getTopology();
    const found = topology.nodes.find((node) => node.id === nodeId);
    return found ? clone(found) : null;
  }

  getLinkById(linkId) {
    const topology = this.getTopology();
    const found = topology.links.find((link) => link.id === linkId);
    return found ? clone(found) : null;
  }

  getCurrentSituation() {
    if (!this.isPythonDataAvailable() && this.fallbackRepository) {
      return this.fallbackRepository.getCurrentSituation();
    }

    const topology = this.getTopology();
    const metrics = this.#loadMetricsFromPython();
    const events = this.getEvents(200);

    const nodes = topology.nodes || [];
    const links = topology.links || [];

    const offlineNodes = nodes.filter((node) => node.state?.online === false || node.state?.status === 'offline').length;
    const warningNodes = nodes.filter((node) => {
      const status = String(node.state?.status || '').toLowerCase();
      return status && status !== 'normal' && status !== 'offline';
    }).length;
    const onlineNodes = Math.max(0, nodes.length - offlineNodes);

    const degradedLinks = links.filter((link) => {
      const dangerByLoss = typeof link.lossRate === 'number' && link.lossRate >= 0.03;
      const dangerBySnr = typeof link.snrDb === 'number' && link.snrDb < 18;
      const warningByHealth = ['warning', 'danger'].includes(String(link.health || '').toLowerCase());
      return dangerByLoss || dangerBySnr || warningByHealth;
    }).length;

    const criticalAlarms = events.filter((event) => event.severity === 'critical' && event.status === 'open').length;
    const majorAlarms = events.filter((event) => event.severity === 'major' && event.status === 'open').length;
    const warningAlarms = events.filter((event) => event.severity === 'warning' && event.status === 'open').length;

    const healthScore =
      metrics && Number.isFinite(Number(metrics.networkHealth))
        ? Math.round(clamp(Number(metrics.networkHealth), 0, 1) * 100)
        : Math.max(
            0,
            Math.round(100 - offlineNodes * 18 - warningNodes * 8 - degradedLinks * 5 - criticalAlarms * 10)
          );

    return {
      snapshotAt: new Date().toISOString(),
      nodeSummary: {
        total: nodes.length,
        online: onlineNodes,
        offline: offlineNodes,
        warning: warningNodes,
      },
      linkSummary: {
        total: links.length,
        degraded: degradedLinks,
      },
      alarmSummary: {
        critical: criticalAlarms,
        major: majorAlarms,
        warning: warningAlarms,
        total: criticalAlarms + majorAlarms + warningAlarms,
      },
      healthScore,
      pythonMetrics: metrics ? clone(metrics) : null,
    };
  }

  getEvents(limit = 50) {
    if (!this.isPythonDataAvailable() && this.fallbackRepository) {
      return this.fallbackRepository.getEvents(limit);
    }

    const pythonEvents = this.#loadPythonEvents();
    const runtimeEvents = this.#loadRuntimeEvents();
    const merged = sortEventsByTimeDesc([...runtimeEvents, ...pythonEvents]);

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
    return clone(merged.slice(0, safeLimit));
  }

  addEvent(eventInput) {
    if (!this.isPythonDataAvailable() && this.fallbackRepository) {
      return this.fallbackRepository.addEvent(eventInput);
    }

    const nextEvent = {
      id: toSafeString(
        eventInput?.id,
        `EV-USER-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
      ),
      type: toSafeString(eventInput?.type, 'manual:event'),
      severity: toSafeString(eventInput?.severity, 'info'),
      entityType: toSafeString(eventInput?.entityType, 'system'),
      entityId: toSafeString(eventInput?.entityId, 'topology'),
      message: toSafeString(eventInput?.message, 'manual event'),
      status: toSafeString(eventInput?.status, 'open'),
      occurredAt: toIsoTimestamp(eventInput?.occurredAt),
      source: 'manual',
    };

    if (eventInput?.payload && typeof eventInput.payload === 'object' && !Array.isArray(eventInput.payload)) {
      nextEvent.payload = clone(eventInput.payload);
    }

    const runtimeEvents = this.#loadRuntimeEvents();
    this.#persistRuntimeEvents([nextEvent, ...runtimeEvents]);
    return clone(nextEvent);
  }
}
