import http from 'http';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { InMemoryNetworkRepository } from './repositories/inMemoryNetworkRepository.js';
import { PythonFileNetworkRepository } from './repositories/pythonFileNetworkRepository.js';

const PORT = Number(process.env.PORT || 8080);
const EVENTS_FILE_PATH = process.env.EVENTS_FILE_PATH;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_DATA_DIR =
  process.env.PYTHON_DATA_DIR || path.resolve(__dirname, '../../Project-001');
const USE_PYTHON_EXPORTS = process.env.USE_PYTHON_EXPORTS !== 'false';
const PYTHON_COMMANDS_FILE_PATH =
  process.env.PYTHON_COMMANDS_FILE_PATH || path.resolve(PYTHON_DATA_DIR, 'command_queue.jsonl');
const PYTHON_COMMAND_TYPES = new Set(['node:add', 'node:remove', 'node:update']);
const ALERT_LIMIT_DEFAULT = 50;
const ALERT_LIMIT_MAX = 200;
const LINK_ALERT_THRESHOLDS = {
  delayWarningMs: 25,
  delayCriticalMs: 60,
  lossWarningRate: 0.03,
  lossCriticalRate: 0.08,
  utilizationWarningRate: 0.85,
  snrWarningDb: 18,
  snrCriticalDb: 10,
};
const PLAYBACK_FRAME_DEFAULT_LIMIT = 30;
const PLAYBACK_FRAME_MAX = Math.max(
  30,
  Math.min(100, Number.parseInt(process.env.PLAYBACK_FRAME_MAX || '50', 10) || 50)
);
const PLAYBACK_CAPTURE_MIN_INTERVAL_MS = Math.max(
  500,
  Number.parseInt(process.env.PLAYBACK_CAPTURE_MIN_INTERVAL_MS || '1000', 10) || 1000
);
const PLAYBACK_FRAME_EVENT_LIMIT = 50;
const playbackFrameStore = {
  frames: [],
  lastCapturedAt: 0,
  lastSignature: '',
};

const fallbackRepository = new InMemoryNetworkRepository(undefined, {
  eventsFilePath: EVENTS_FILE_PATH,
});
const repository = USE_PYTHON_EXPORTS
  ? new PythonFileNetworkRepository({
      dataDir: PYTHON_DATA_DIR,
      runtimeEventsFilePath:
        EVENTS_FILE_PATH || path.resolve(__dirname, '../data/runtime/events.json'),
      fallbackRepository,
    })
  : fallbackRepository;

function sendJson(res, statusCode, traceId, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Trace-Id',
    'Cache-Control': 'no-store',
  });

  res.end(
    JSON.stringify({
      type: 'rest:response',
      version: '1.0',
      timestamp: new Date().toISOString(),
      trace_id: traceId,
      ...payload,
    })
  );
}

function sendError(res, statusCode, traceId, code, message) {
  sendJson(res, statusCode, traceId, {
    success: false,
    error: { code, message },
  });
}

function parseEntityId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const rawId = pathname.slice(prefix.length);
  if (!rawId || rawId.includes('/')) {
    return null;
  }
  return decodeURIComponent(rawId);
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let body = '';

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject({
          status: 413,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large',
        });
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_error) {
        reject({
          status: 400,
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        });
      }
    });

    req.on('error', () => {
      reject({
        status: 400,
        code: 'READ_BODY_FAILED',
        message: 'Failed to read request body',
      });
    });
  });
}

function validateCreateEventPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Body must be a JSON object';
  }
  if (typeof payload.type !== 'string' || !payload.type.trim()) {
    return 'Field "type" is required';
  }
  if (typeof payload.message !== 'string' || !payload.message.trim()) {
    return 'Field "message" is required';
  }
  return null;
}

function parseTimestampToIso(value, fallbackIso) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return fallbackIso;
}

function toFiniteNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function deriveAlertsFromTopology(topology) {
  const nowIso = new Date().toISOString();
  const nodes = Array.isArray(topology?.nodes) ? topology.nodes : [];
  const links = Array.isArray(topology?.links) ? topology.links : [];
  const alerts = [];

  nodes.forEach((node) => {
    const nodeId = String(node?.id || '').trim();
    if (!nodeId) {
      return;
    }

    const online = node?.state?.online;
    const status = String(node?.state?.status || '').toLowerCase();
    const alarmLevel = String(node?.alarmLevel || '').toLowerCase();

    let severity = null;
    let title = '';
    let message = '';

    if (online === false || status === 'offline' || status === 'error' || alarmLevel === 'danger') {
      severity = 'critical';
      title = 'Node Offline';
      message = `Node ${nodeId} is offline or unreachable`;
    } else if (['warning', 'busy', 'degraded'].includes(status) || alarmLevel === 'warning') {
      severity = 'warning';
      title = 'Node Degraded';
      message = `Node ${nodeId} status is ${status || 'warning'}`;
    }

    if (!severity) {
      return;
    }

    const timestamp = parseTimestampToIso(node?.state?.lastSeen, nowIso);
    alerts.push({
      id: `AL-NODE-${nodeId}-${Date.parse(timestamp) || Date.now()}`,
      type: 'node',
      severity,
      title,
      message,
      timestamp,
      entityType: 'node',
      entityId: nodeId,
      active: true,
    });
  });

  links.forEach((link) => {
    const linkId = String(link?.id || '').trim();
    if (!linkId) {
      return;
    }

    const state = String(link?.state || 'up').toLowerCase();
    const delayMs = toFiniteNumberOrNull(link?.delayMs);
    const lossRate = toFiniteNumberOrNull(link?.lossRate);
    const utilization = toFiniteNumberOrNull(link?.utilization);
    const snrDb = toFiniteNumberOrNull(link?.snrDb);

    let severity = null;
    let title = '';
    let message = '';

    if (state !== 'up') {
      severity = 'critical';
      title = 'Link Down';
      message = `Link ${linkId} state is ${state}`;
    } else {
      const critical =
        (delayMs !== null && delayMs >= LINK_ALERT_THRESHOLDS.delayCriticalMs) ||
        (lossRate !== null && lossRate >= LINK_ALERT_THRESHOLDS.lossCriticalRate) ||
        (snrDb !== null && snrDb < LINK_ALERT_THRESHOLDS.snrCriticalDb);
      const warning =
        (delayMs !== null && delayMs >= LINK_ALERT_THRESHOLDS.delayWarningMs) ||
        (lossRate !== null && lossRate >= LINK_ALERT_THRESHOLDS.lossWarningRate) ||
        (utilization !== null && utilization >= LINK_ALERT_THRESHOLDS.utilizationWarningRate) ||
        (snrDb !== null && snrDb < LINK_ALERT_THRESHOLDS.snrWarningDb);

      if (critical) {
        severity = 'critical';
        title = 'Link Critical';
      } else if (warning) {
        severity = 'warning';
        title = 'Link Warning';
      }

      if (severity) {
        const segments = [];
        if (delayMs !== null) {
          segments.push(`delay ${delayMs.toFixed(1)}ms`);
        }
        if (lossRate !== null) {
          segments.push(`loss ${(lossRate * 100).toFixed(2)}%`);
        }
        if (utilization !== null) {
          segments.push(`util ${(utilization * 100).toFixed(1)}%`);
        }
        if (snrDb !== null) {
          segments.push(`snr ${snrDb.toFixed(1)}dB`);
        }
        message = `Link ${linkId} degraded (${segments.join(', ') || 'quality threshold exceeded'})`;
      }
    }

    if (!severity) {
      return;
    }

    const timestamp = parseTimestampToIso(link?.lastUpdate, nowIso);
    alerts.push({
      id: `AL-LINK-${linkId}-${Date.parse(timestamp) || Date.now()}`,
      type: 'link',
      severity,
      title,
      message,
      timestamp,
      entityType: 'link',
      entityId: linkId,
      active: true,
    });
  });

  return alerts.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function buildPlaybackFrameSignature(frame) {
  const topologyUpdatedAt = String(frame?.topology?.meta?.updatedAt || '');
  const snapshotAt = String(frame?.situation?.snapshotAt || '');
  const nodeCount = Array.isArray(frame?.topology?.nodes) ? frame.topology.nodes.length : 0;
  const linkCount = Array.isArray(frame?.topology?.links) ? frame.topology.links.length : 0;
  const eventHead =
    Array.isArray(frame?.events) && frame.events.length
      ? `${frame.events[0]?.id || ''}:${frame.events[0]?.occurredAt || ''}`
      : 'none';
  const alertHead =
    Array.isArray(frame?.alerts) && frame.alerts.length
      ? `${frame.alerts[0]?.id || ''}:${frame.alerts[0]?.timestamp || ''}`
      : 'none';

  return [topologyUpdatedAt, snapshotAt, nodeCount, linkCount, eventHead, alertHead].join('|');
}

function buildPlaybackFrame() {
  const topology = repository.getTopology();
  const situation = repository.getCurrentSituation();
  const events = repository.getEvents(PLAYBACK_FRAME_EVENT_LIMIT);
  const alerts = deriveAlertsFromTopology(topology);

  return {
    id: `PF-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    topology: deepClone(topology),
    situation: deepClone(situation),
    events: deepClone(Array.isArray(events) ? events : []),
    alerts: deepClone(Array.isArray(alerts) ? alerts : []),
  };
}

function rememberPlaybackFrame(frame, options = {}) {
  const { force = false } = options;
  const now = Date.now();
  const signature = buildPlaybackFrameSignature(frame);

  if (!force) {
    const sameSignature = signature && signature === playbackFrameStore.lastSignature;
    const tooSoon = now - playbackFrameStore.lastCapturedAt < PLAYBACK_CAPTURE_MIN_INTERVAL_MS;
    if (sameSignature && tooSoon) {
      return false;
    }
  }

  playbackFrameStore.frames.push(frame);
  if (playbackFrameStore.frames.length > PLAYBACK_FRAME_MAX) {
    playbackFrameStore.frames.splice(0, playbackFrameStore.frames.length - PLAYBACK_FRAME_MAX);
  }
  playbackFrameStore.lastCapturedAt = now;
  playbackFrameStore.lastSignature = signature;
  return true;
}

function capturePlaybackFrame(options = {}) {
  try {
    const frame = buildPlaybackFrame();
    rememberPlaybackFrame(frame, options);
    return frame;
  } catch (_error) {
    return null;
  }
}

function createPythonCommandId() {
  return `CMD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function validatePythonCommandPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Body must be a JSON object';
  }

  const type = typeof payload.type === 'string' ? payload.type.trim() : '';
  if (!type) {
    return 'Field "type" is required';
  }
  if (!PYTHON_COMMAND_TYPES.has(type)) {
    return `Unsupported command type: ${type}`;
  }

  if (!payload.payload || typeof payload.payload !== 'object' || Array.isArray(payload.payload)) {
    return 'Field "payload" must be a JSON object';
  }

  if (type === 'node:add') {
    const rawNode = payload.payload.node && typeof payload.payload.node === 'object'
      ? payload.payload.node
      : payload.payload;
    const nodeId = typeof rawNode?.id === 'string' ? rawNode.id.trim() : '';
    if (!nodeId) {
      return 'node:add requires payload.node.id';
    }
  }

  if (type === 'node:remove') {
    const nodeIdRaw = payload.payload.nodeId ?? payload.payload.id;
    const nodeId = typeof nodeIdRaw === 'string' ? nodeIdRaw.trim() : '';
    if (!nodeId) {
      return 'node:remove requires payload.nodeId';
    }
  }

  if (type === 'node:update') {
    const nodeIdRaw = payload.payload.nodeId ?? payload.payload.id;
    const nodeId = typeof nodeIdRaw === 'string' ? nodeIdRaw.trim() : '';
    if (!nodeId) {
      return 'node:update requires payload.nodeId';
    }
  }

  return null;
}

function enqueuePythonCommand(commandInput, traceId) {
  const command = {
    id: typeof commandInput.id === 'string' && commandInput.id.trim() ? commandInput.id.trim() : createPythonCommandId(),
    type: commandInput.type,
    payload: commandInput.payload,
    createdAt: new Date().toISOString(),
    source: 'frontend',
    traceId,
  };

  fs.mkdirSync(path.dirname(PYTHON_COMMANDS_FILE_PATH), { recursive: true });
  fs.appendFileSync(PYTHON_COMMANDS_FILE_PATH, `${JSON.stringify(command)}\n`, 'utf8');
  return command;
}

async function handleRequest(req, res) {
  const traceId = req.headers['x-trace-id'] || randomUUID();
  const host = req.headers.host || 'localhost';
  const requestUrl = new URL(req.url || '/', `http://${host}`);
  const { pathname, searchParams } = requestUrl;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Trace-Id',
    });
    res.end();
    return;
  }

  if (pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, traceId, {
      success: true,
      data: { status: 'ok' },
    });
    return;
  }

  if (pathname === '/api/topology/events' && req.method === 'POST') {
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendError(res, error.status || 400, traceId, error.code || 'BAD_REQUEST', error.message || 'Bad request');
      return;
    }

    const validationError = validateCreateEventPayload(payload);
    if (validationError) {
      sendError(res, 400, traceId, 'INVALID_EVENT_PAYLOAD', validationError);
      return;
    }

    const createdEvent = repository.addEvent(payload);
    capturePlaybackFrame({ force: true });
    sendJson(res, 201, traceId, {
      success: true,
      data: createdEvent,
    });
    return;
  }

  if ((pathname === '/api/python/commands' || pathname === '/api/api/python/commands') && req.method === 'POST') {
    if (!USE_PYTHON_EXPORTS) {
      sendError(res, 409, traceId, 'PYTHON_DISABLED', 'Python command channel is disabled');
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendError(res, error.status || 400, traceId, error.code || 'BAD_REQUEST', error.message || 'Bad request');
      return;
    }

    const validationError = validatePythonCommandPayload(payload);
    if (validationError) {
      sendError(res, 400, traceId, 'INVALID_PYTHON_COMMAND', validationError);
      return;
    }

    const createdCommand = enqueuePythonCommand(payload, traceId);
    sendJson(res, 201, traceId, {
      success: true,
      data: createdCommand,
    });
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, traceId, 'METHOD_NOT_ALLOWED', `Method ${req.method} is not allowed`);
    return;
  }

  if (pathname === '/api/topology') {
    capturePlaybackFrame();
    sendJson(res, 200, traceId, {
      success: true,
      data: repository.getTopology(),
    });
    return;
  }

  if (pathname === '/api/situation/current') {
    capturePlaybackFrame();
    sendJson(res, 200, traceId, {
      success: true,
      data: repository.getCurrentSituation(),
    });
    return;
  }

  if (pathname === '/api/events') {
    capturePlaybackFrame();
    const limit = Number(searchParams.get('limit') || 50);
    sendJson(res, 200, traceId, {
      success: true,
      data: repository.getEvents(limit),
    });
    return;
  }

  if (pathname === '/api/alerts') {
    capturePlaybackFrame();
    const topology = repository.getTopology();
    const alerts = deriveAlertsFromTopology(topology);

    const activeParam = searchParams.get('active');
    const activeOnly = activeParam === 'true';
    const filteredAlerts = activeOnly ? alerts.filter((alert) => alert.active !== false) : alerts;

    const limit = Number(searchParams.get('limit') || ALERT_LIMIT_DEFAULT);
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(ALERT_LIMIT_MAX, Math.floor(limit)))
      : ALERT_LIMIT_DEFAULT;

    sendJson(res, 200, traceId, {
      success: true,
      data: filteredAlerts.slice(0, safeLimit),
    });
    return;
  }

  if (pathname === '/api/playback/frames') {
    if (!playbackFrameStore.frames.length) {
      capturePlaybackFrame({ force: true });
    }

    const limit = Number(searchParams.get('limit') || PLAYBACK_FRAME_DEFAULT_LIMIT);
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(PLAYBACK_FRAME_MAX, Math.floor(limit)))
      : PLAYBACK_FRAME_DEFAULT_LIMIT;

    const frames = playbackFrameStore.frames
      .slice(-safeLimit)
      .map((frame) => deepClone(frame));

    sendJson(res, 200, traceId, {
      success: true,
      data: {
        frames,
        total: playbackFrameStore.frames.length,
        limit: safeLimit,
        mode: 'memory-ring',
      },
    });
    return;
  }

  const nodeId = parseEntityId(pathname, '/api/nodes/');
  if (nodeId) {
    const node = repository.getNodeById(nodeId);
    if (!node) {
      sendError(res, 404, traceId, 'NOT_FOUND', `Node ${nodeId} not found`);
      return;
    }
    sendJson(res, 200, traceId, {
      success: true,
      data: node,
    });
    return;
  }

  const linkId = parseEntityId(pathname, '/api/links/');
  if (linkId) {
    const link = repository.getLinkById(linkId);
    if (!link) {
      sendError(res, 404, traceId, 'NOT_FOUND', `Link ${linkId} not found`);
      return;
    }
    sendJson(res, 200, traceId, {
      success: true,
      data: link,
    });
    return;
  }

  sendError(res, 404, traceId, 'NOT_FOUND', 'Resource not found');
}

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    const traceId = req.headers['x-trace-id'] || randomUUID();
    sendError(
      res,
      500,
      traceId,
      'INTERNAL_SERVER_ERROR',
      error?.message || 'Unexpected error'
    );
  }
});

capturePlaybackFrame({ force: true });

server.listen(PORT, () => {
  const usingPythonExports =
    typeof repository.isPythonDataAvailable === 'function' &&
    repository.isPythonDataAvailable();

  console.log('========================================');
  console.log('Network Visualization REST Mock Server');
  console.log('========================================');
  console.log(`Listening: http://localhost:${PORT}`);
  console.log(`Health:    http://localhost:${PORT}/health`);
  console.log(`Events DB: ${EVENTS_FILE_PATH || 'server/data/runtime/events.json'}`);
  console.log(`Cmd Queue: ${PYTHON_COMMANDS_FILE_PATH}`);
  if (USE_PYTHON_EXPORTS) {
    console.log(
      `Python data: ${usingPythonExports ? 'enabled' : 'missing, fallback to seed'} (${PYTHON_DATA_DIR})`
    );
  } else {
    console.log('Python data: disabled by USE_PYTHON_EXPORTS=false');
  }
  console.log('REST APIs: /api/topology, /api/nodes/:id, /api/links/:id, /api/situation/current, /api/events, /api/alerts, /api/playback/frames, POST /api/topology/events, POST /api/python/commands');
  console.log('========================================');
});

process.on('SIGINT', () => {
  console.log('\nShutting down REST mock server...');
  server.close(() => process.exit(0));
});
