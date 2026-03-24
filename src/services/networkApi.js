const API_BASE_URL_RAW = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8080';
const API_BASE_URL = API_BASE_URL_RAW.replace(/\/+$/, '');

function buildUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // If frontend env is configured as http://host:port/api, avoid generating /api/api/*
  if (API_BASE_URL.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${API_BASE_URL.slice(0, -4)}${normalizedPath}`;
  }

  return `${API_BASE_URL}${normalizedPath}`;
}

async function requestJson(path) {
  return requestJsonWithOptions(path, {});
}

async function requestJsonWithOptions(path, options = {}) {
  const { method = 'GET', body: requestBody } = options;
  const headers = {
    Accept: 'application/json',
  };
  if (requestBody !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(buildUrl(path), {
    method,
    headers,
    body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = responseBody?.error?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return responseBody?.data ?? responseBody;
}

export async function getTopology() {
  return requestJson('/api/topology');
}

export async function getNodeById(nodeId) {
  return requestJson(`/api/nodes/${encodeURIComponent(nodeId)}`);
}

export async function getLinkById(linkId) {
  return requestJson(`/api/links/${encodeURIComponent(linkId)}`);
}

export async function getSituationCurrent() {
  return requestJson('/api/situation/current');
}

export async function getEvents(limit = 20) {
  return requestJson(`/api/events?limit=${encodeURIComponent(String(limit))}`);
}

export async function getAlerts(limit = 50, activeOnly = true) {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (activeOnly) {
    params.set('active', 'true');
  }
  return requestJson(`/api/alerts?${params.toString()}`);
}

export async function getPlaybackFrames(limit = 50) {
  return requestJson(`/api/playback/frames?limit=${encodeURIComponent(String(limit))}`);
}

export async function sendPythonCommand(command) {
  return requestJsonWithOptions('/api/python/commands', {
    method: 'POST',
    body: command,
  });
}
