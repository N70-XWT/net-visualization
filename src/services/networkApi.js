const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8080';

function buildUrl(path) {
  return `${API_BASE_URL}${path}`;
}

async function requestJson(path) {
  const response = await fetch(buildUrl(path), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return body?.data ?? body;
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
