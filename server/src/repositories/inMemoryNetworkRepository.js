import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { mockTopologySeed } from '../data/mockTopologySeed.js';
import { NetworkRepository } from './networkRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_EVENTS_FILE_PATH = path.resolve(__dirname, '../../data/runtime/events.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toSafeString(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function toIsoOrNow(value) {
  if (typeof value !== 'string') {
    return new Date().toISOString();
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return new Date().toISOString();
  }
  return new Date(time).toISOString();
}

function buildSeedEvents(topology) {
  const now = Date.now();
  const events = [];

  topology.nodes.forEach((node, index) => {
    const isOffline = node.state?.online === false || node.state?.status === 'offline';
    const isWarning = node.state?.status && node.state.status !== 'normal' && !isOffline;
    if (!isOffline && !isWarning) {
      return;
    }

    events.push({
      id: `EV-NODE-${String(index + 1).padStart(3, '0')}`,
      type: 'node:status',
      severity: isOffline ? 'critical' : 'warning',
      entityType: 'node',
      entityId: node.id,
      message: isOffline
        ? `Node ${node.id} is offline`
        : `Node ${node.id} status changed to ${node.state?.status}`,
      status: 'open',
      occurredAt: new Date(now - (index + 1) * 60 * 1000).toISOString(),
    });
  });

  topology.links.forEach((link, index) => {
    const hasLossRisk = typeof link.lossRate === 'number' && link.lossRate >= 0.03;
    const hasSnrRisk = typeof link.snrDb === 'number' && link.snrDb < 10;
    if (!hasLossRisk && !hasSnrRisk) {
      return;
    }

    events.push({
      id: `EV-LINK-${String(index + 1).padStart(3, '0')}`,
      type: 'link:quality',
      severity: hasSnrRisk ? 'critical' : 'major',
      entityType: 'link',
      entityId: link.id,
      message: hasSnrRisk
        ? `Link ${link.id} SNR degraded (${link.snrDb} dB)`
        : `Link ${link.id} packet loss elevated (${(link.lossRate * 100).toFixed(2)}%)`,
      status: 'open',
      occurredAt: new Date(now - (index + 1) * 90 * 1000).toISOString(),
    });
  });

  if (!events.length) {
    events.push({
      id: 'EV-SYS-001',
      type: 'system:info',
      severity: 'info',
      entityType: 'system',
      entityId: 'topology',
      message: 'No active alarms in mock dataset',
      status: 'open',
      occurredAt: new Date(now).toISOString(),
    });
  }

  return events.sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : 1));
}

function computeSituation(topology, events) {
  const nodes = topology.nodes || [];
  const links = topology.links || [];

  const offlineNodes = nodes.filter((node) => node.state?.online === false || node.state?.status === 'offline').length;
  const warningNodes = nodes.filter((node) => {
    const status = node.state?.status;
    return status && status !== 'normal' && status !== 'offline';
  }).length;
  const onlineNodes = Math.max(0, nodes.length - offlineNodes);

  const degradedLinks = links.filter((link) => {
    const lossRisk = typeof link.lossRate === 'number' && link.lossRate >= 0.03;
    const snrRisk = typeof link.snrDb === 'number' && link.snrDb < 10;
    const availabilityRisk = typeof link.availability === 'number' && link.availability < 0.95;
    return lossRisk || snrRisk || availabilityRisk;
  }).length;

  const criticalAlarms = events.filter((event) => event.severity === 'critical' && event.status === 'open').length;
  const majorAlarms = events.filter((event) => event.severity === 'major' && event.status === 'open').length;
  const warningAlarms = events.filter((event) => event.severity === 'warning' && event.status === 'open').length;

  const healthScore = Math.max(
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
  };
}

function createEventId() {
  return `EV-USER-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
  return [...events].sort((a, b) => {
    const aTime = Date.parse(a?.occurredAt || 0);
    const bTime = Date.parse(b?.occurredAt || 0);
    return bTime - aTime;
  });
}

export class InMemoryNetworkRepository extends NetworkRepository {
  constructor(seedTopology = mockTopologySeed, options = {}) {
    super();
    this.topology = clone(seedTopology);
    this.eventsFilePath = options.eventsFilePath || DEFAULT_EVENTS_FILE_PATH;
    this.events = this.#loadEvents();
  }

  #ensureStorageDir() {
    const dir = path.dirname(this.eventsFilePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  #readEventsFromDisk() {
    if (!fs.existsSync(this.eventsFilePath)) {
      return null;
    }
    const fileContent = fs.readFileSync(this.eventsFilePath, 'utf8');
    if (!fileContent.trim()) {
      return [];
    }
    const parsed = JSON.parse(fileContent);
    return normalizeStoredEvents(parsed);
  }

  #persistEvents(events) {
    this.#ensureStorageDir();
    const sortedEvents = sortEventsByTimeDesc(events);
    const payload = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      events: sortedEvents,
    };
    fs.writeFileSync(this.eventsFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.events = sortedEvents;
  }

  #loadEvents() {
    try {
      const stored = this.#readEventsFromDisk();
      if (stored && stored.length > 0) {
        return sortEventsByTimeDesc(stored);
      }
    } catch (error) {
      // Fallback to seed events when local storage is invalid.
    }

    const seedEvents = buildSeedEvents(this.topology);
    this.#persistEvents(seedEvents);
    return seedEvents;
  }

  getTopology() {
    return clone(this.topology);
  }

  getNodeById(nodeId) {
    const found = this.topology.nodes.find((node) => node.id === nodeId);
    return found ? clone(found) : null;
  }

  getLinkById(linkId) {
    const found = this.topology.links.find((link) => link.id === linkId);
    return found ? clone(found) : null;
  }

  getCurrentSituation() {
    return computeSituation(this.topology, this.events);
  }

  getEvents(limit = 50) {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
    return clone(this.events.slice(0, safeLimit));
  }

  addEvent(eventInput) {
    const nextEvent = {
      id: toSafeString(eventInput?.id, createEventId()),
      type: toSafeString(eventInput?.type, 'manual:event'),
      severity: toSafeString(eventInput?.severity, 'info'),
      entityType: toSafeString(eventInput?.entityType, 'system'),
      entityId: toSafeString(eventInput?.entityId, 'topology'),
      message: toSafeString(eventInput?.message, 'manual event'),
      status: toSafeString(eventInput?.status, 'open'),
      occurredAt: toIsoOrNow(eventInput?.occurredAt),
    };

    if (eventInput?.payload && typeof eventInput.payload === 'object' && !Array.isArray(eventInput.payload)) {
      nextEvent.payload = clone(eventInput.payload);
    }

    this.#persistEvents([nextEvent, ...this.events]);
    return clone(nextEvent);
  }

  // Storage extension point for future iteration (DB adapter)
  replaceData(nextTopology, nextEvents = this.events) {
    this.topology = clone(nextTopology);
    this.#persistEvents(clone(nextEvents));
  }
}
