const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..', '..');
const buildDir = path.join(root, 'build');
const outputPath = path.join(root, 'artifacts', 'spark-cup-deck', 'assets', 'product-screenshot.png');
const port = 3105;

const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'Project-001', 'snapshot.json'), 'utf8'));
const metrics = JSON.parse(fs.readFileSync(path.join(root, 'Project-001', 'metrics.json'), 'utf8'));

const demoEvents = [
  {
    id: 'EV-SCREEN-001',
    type: 'link:update',
    severity: 'warning',
    entityType: 'link',
    entityId: 'L-screen-1',
    message: 'Wireless link quality degraded; cross-layer trace started',
    occurredAt: new Date().toISOString(),
    status: 'open',
  },
  {
    id: 'EV-SCREEN-002',
    type: 'node:update',
    severity: 'critical',
    entityType: 'node',
    entityId: 'B2',
    message: 'Backbone node B2 offline; replay frame captured',
    occurredAt: new Date(Date.now() - 60000).toISOString(),
    status: 'open',
  },
];

const topology = {
  meta: {
    name: 'spark-cup-screenshot-topology',
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    dynamicNodeCount: 4,
    dynamicLinkCount: 6,
  },
  nodes: snapshot.nodes,
  links: snapshot.links,
  crossLayerRelations: (snapshot.links || []).slice(0, 10).map((link, index) => ({
    id: `CLR-SCREEN-${String(index + 1).padStart(3, '0')}`,
    fromNodeId: link.from || link.src,
    toNodeId: link.to || link.dst,
    relationType: index % 2 ? 'backhaul' : 'access',
    notes: `Derived from ${link.id}`,
  })),
};

const situation = {
  snapshotAt: new Date().toISOString(),
  nodeSummary: {
    total: metrics.nodeCount || topology.nodes.length,
    online: Math.round((metrics.onlineRate || 0.7368) * (metrics.nodeCount || topology.nodes.length)),
    offline: 5,
    warning: 3,
  },
  linkSummary: {
    total: metrics.linkCount || topology.links.length,
    degraded: 6,
  },
  alarmSummary: {
    critical: 2,
    major: 3,
    warning: 5,
    total: 10,
  },
  healthScore: Math.round((metrics.networkHealth || 0.6943) * 100),
  pythonMetrics: metrics,
};

function envelope(data) {
  return JSON.stringify({
    type: 'rest:response',
    version: '1.0',
    timestamp: new Date().toISOString(),
    trace_id: 'screenshot',
    success: true,
    data,
  });
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function sendJson(res, data) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(envelope(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Trace-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/api/topology') return sendJson(res, topology);
  if (url.pathname === '/api/situation/current') return sendJson(res, situation);
  if (url.pathname === '/api/events') return sendJson(res, demoEvents);
  if (url.pathname === '/api/alerts') {
    return sendJson(
      res,
      demoEvents.map((eventItem, index) => ({
        ...eventItem,
        title: index ? 'Node offline' : 'Link degraded',
        active: true,
        timestamp: eventItem.occurredAt,
      }))
    );
  }
  if (url.pathname === '/api/playback/frames') {
    return sendJson(res, {
      frames: [0, 1, 2, 3].map((_, index) => ({
        id: `PF-SCREEN-${index + 1}`,
        timestamp: new Date(Date.now() - index * 45000).toISOString(),
        topology,
        situation,
        events: demoEvents,
      })),
      total: 4,
      limit: 30,
      mode: 'memory-ring',
    });
  }
  if (url.pathname === '/api/analysis/connectivity') {
    return sendJson(res, {
      connected: true,
      componentCount: 1,
      largestComponentSize: topology.nodes.length,
      largestComponentRatio: 1,
      isolatedNodeIds: [],
      components: [{ id: 'PART-001', size: topology.nodes.length, nodeIds: topology.nodes.map((node) => node.id) }],
      evaluatedAt: new Date().toISOString(),
    });
  }
  if (url.pathname === '/api/analysis/path') {
    return sendJson(res, {
      startNodeId: 'B1',
      endNodeId: 'U1',
      reachable: true,
      hopCount: 4,
      totalDelayMs: 41.3,
      pathNodeIds: ['B1', 'A2', 'MUAV-001', 'U1'],
      pathLinkIds: ['L1', 'DYN-LNK-MUAV-001-GROUND'],
      evaluatedAt: new Date().toISOString(),
    });
  }

  let filePath = path.join(buildDir, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
  if (!filePath.startsWith(buildDir)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(buildDir, 'index.html');
  }
  res.writeHead(200, { 'content-type': contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
});

(async () => {
  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve).on('error', reject);
  });

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const requestUrl = typeof input === 'string' ? input : input && input.url;
      if (requestUrl && requestUrl.startsWith('http://localhost:8080/api/')) {
        return originalFetch(requestUrl.replace('http://localhost:8080', 'http://127.0.0.1:3105'), init);
      }
      return originalFetch(input, init);
    };
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2800);
  await page.screenshot({ path: outputPath, fullPage: true });
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(outputPath);
})().catch(async (error) => {
  await new Promise((resolve) => server.close(resolve));
  console.error(error);
  process.exit(1);
});
