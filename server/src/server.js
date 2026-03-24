import http from 'http';
import { randomUUID } from 'crypto';

import { InMemoryNetworkRepository } from './repositories/inMemoryNetworkRepository.js';

const PORT = Number(process.env.PORT || 8080);
const EVENTS_FILE_PATH = process.env.EVENTS_FILE_PATH;
const repository = new InMemoryNetworkRepository(undefined, {
  eventsFilePath: EVENTS_FILE_PATH,
});

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
    sendJson(res, 201, traceId, {
      success: true,
      data: createdEvent,
    });
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, traceId, 'METHOD_NOT_ALLOWED', `Method ${req.method} is not allowed`);
    return;
  }

  if (pathname === '/api/topology') {
    sendJson(res, 200, traceId, {
      success: true,
      data: repository.getTopology(),
    });
    return;
  }

  if (pathname === '/api/situation/current') {
    sendJson(res, 200, traceId, {
      success: true,
      data: repository.getCurrentSituation(),
    });
    return;
  }

  if (pathname === '/api/events') {
    const limit = Number(searchParams.get('limit') || 50);
    sendJson(res, 200, traceId, {
      success: true,
      data: repository.getEvents(limit),
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

server.listen(PORT, () => {
  console.log('========================================');
  console.log('Network Visualization REST Mock Server');
  console.log('========================================');
  console.log(`Listening: http://localhost:${PORT}`);
  console.log(`Health:    http://localhost:${PORT}/health`);
  console.log(`Events DB: ${EVENTS_FILE_PATH || 'server/data/runtime/events.json'}`);
  console.log('REST APIs: /api/topology, /api/nodes/:id, /api/links/:id, /api/situation/current, /api/events, POST /api/topology/events');
  console.log('========================================');
});

process.on('SIGINT', () => {
  console.log('\nShutting down REST mock server...');
  server.close(() => process.exit(0));
});
