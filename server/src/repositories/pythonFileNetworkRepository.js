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

function parseTimestamp(value) {
  const parsed = Date.parse(value || 0);
  return Number.isNaN(parsed) ? 0 : parsed;
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

  getTopology() {
    const pythonTopology = this.#loadTopologyFromPython();
    if (pythonTopology) {
      return clone(pythonTopology);
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
