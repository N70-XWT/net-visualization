import {
  XDU_SOUTH_CAMPUS_BUILDINGS,
} from './xduCampusBuildings';
import { normalizeToWgs84 } from './coordinateUtils';

const CAMPUS_CORE_NODE_ID = 'XDU-SC-NOC-001';
const CAMPUS_TOPOLOGY_VERSION = 'xdu-south-campus-building-v1';

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCoord(value, digits = 6) {
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distanceSquared(from, to) {
  if (!from || !to) {
    return Number.POSITIVE_INFINITY;
  }
  const latDelta = toFiniteNumber(from.lat, 0) - toFiniteNumber(to.lat, 0);
  const lngDelta = toFiniteNumber(from.lng, 0) - toFiniteNumber(to.lng, 0);
  return (latDelta * latDelta) + (lngDelta * lngDelta);
}

function normalizeLayer(layer, fallbackLayer = 'edge') {
  const safeLayer = String(layer || '').trim().toLowerCase();
  if (safeLayer === 'adhoc') {
    return 'mesh';
  }
  if (safeLayer === 'terminal') {
    return 'edge';
  }
  if (safeLayer === 'backbone' || safeLayer === 'access' || safeLayer === 'mesh' || safeLayer === 'edge') {
    return safeLayer;
  }
  return fallbackLayer;
}

function pickByHash(items, seed) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  const hash = hashString(seed);
  return items[hash % items.length];
}

function buildDeterministicOffset(seed, latRange = 0.00022, lngRange = 0.00024) {
  const hash = hashString(seed);
  const latRaw = ((hash & 0xffff) / 0xffff) - 0.5;
  const lngRaw = (((hash >>> 16) & 0xffff) / 0xffff) - 0.5;
  return {
    latOffset: latRaw * latRange,
    lngOffset: lngRaw * lngRange,
  };
}

function normalizeBuildingPoint(item) {
  const rawLngCandidate = item?.gcjLng ?? item?.lng;
  const rawLatCandidate = item?.gcjLat ?? item?.lat;
  const coordSystem = String(item?.coordSystem || (item?.gcjLng !== undefined ? 'gcj02' : 'wgs84')).trim().toLowerCase();

  const rawLng = toFiniteNumber(rawLngCandidate, NaN);
  const rawLat = toFiniteNumber(rawLatCandidate, NaN);
  if (!Number.isFinite(rawLng) || !Number.isFinite(rawLat)) {
    return null;
  }

  const converted = normalizeToWgs84({
    lng: rawLng,
    lat: rawLat,
    coordSystem,
  });

  return {
    ...item,
    coordSystem,
    rawLng: rawLngCandidate,
    rawLat: rawLatCandidate,
    lng: roundCoord(converted.lng),
    lat: roundCoord(converted.lat),
  };
}

// WGS84 building coordinates used by Leaflet/OSM map rendering.
// Raw input can stay as Gaode GCJ-02 in `xduCampusBuildings.js`.
const XDU_SOUTH_CAMPUS_BUILDINGS_WGS84 = XDU_SOUTH_CAMPUS_BUILDINGS
  .map((item) => normalizeBuildingPoint(item))
  .filter(Boolean);

const XDU_SOUTH_CAMPUS_BUILDING_WGS84_BY_NAME = XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.reduce((acc, item) => {
  const key = String(item?.name || '').trim().toLowerCase();
  if (key) {
    acc[key] = item;
  }
  return acc;
}, {});

function getBuildingByName(name) {
  const key = String(name || '').trim().toLowerCase();
  return XDU_SOUTH_CAMPUS_BUILDING_WGS84_BY_NAME[key] || null;
}

function computeBuildingCentroid() {
  if (!XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.length) {
    return { lat: 34.1263, lng: 108.8340 };
  }
  const aggregate = XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.reduce((acc, item) => {
    acc.lat += toFiniteNumber(item.lat, 0);
    acc.lng += toFiniteNumber(item.lng, 0);
    return acc;
  }, { lat: 0, lng: 0 });
  return {
    lat: aggregate.lat / XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.length,
    lng: aggregate.lng / XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.length,
  };
}

const NETWORK_CENTER_BUILDING = getBuildingByName('XDU-Network-Center');
const SOUTH_CAMPUS_CENTROID = computeBuildingCentroid();

// South campus default center.
export const XDU_CAMPUS_DEFAULT_CENTER = {
  lat: roundCoord(NETWORK_CENTER_BUILDING?.lat ?? SOUTH_CAMPUS_CENTROID.lat),
  lng: roundCoord(NETWORK_CENTER_BUILDING?.lng ?? SOUTH_CAMPUS_CENTROID.lng),
};

const latValues = XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.map((item) => toFiniteNumber(item.lat, XDU_CAMPUS_DEFAULT_CENTER.lat));
const lngValues = XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.map((item) => toFiniteNumber(item.lng, XDU_CAMPUS_DEFAULT_CENTER.lng));
const latMin = latValues.length ? Math.min(...latValues) : XDU_CAMPUS_DEFAULT_CENTER.lat;
const latMax = latValues.length ? Math.max(...latValues) : XDU_CAMPUS_DEFAULT_CENTER.lat;
const lngMin = lngValues.length ? Math.min(...lngValues) : XDU_CAMPUS_DEFAULT_CENTER.lng;
const lngMax = lngValues.length ? Math.max(...lngValues) : XDU_CAMPUS_DEFAULT_CENTER.lng;

// South campus bounds for clamping and in-campus checks.
const CAMPUS_LAT_RANGE = {
  min: roundCoord(latMin - 0.0022),
  max: roundCoord(latMax + 0.0022),
};
const CAMPUS_LNG_RANGE = {
  min: roundCoord(lngMin - 0.0022),
  max: roundCoord(lngMax + 0.0022),
};

const ZONE_ANCHOR_BUILDING_NAME = {
  'network-center': 'XDU-Network-Center',
  library: 'Activity center',
  'teaching-area': 'C building',
  'lab-area': 'Network-security building',
  'dorm-area': 'Haitang-Dorm',
  'canteen-area': 'Zhuyuan-Canteen',
  'stadium-area': 'Stadium',
  'gate-area': 'Activity center',
  'parking-area': 'Hospital',
  'admin-area': 'Office1',
};

function resolveZoneCenter(zoneKey, fallbackCenter) {
  const buildingName = ZONE_ANCHOR_BUILDING_NAME[zoneKey];
  const building = buildingName ? getBuildingByName(buildingName) : null;
  if (building) {
    return {
      lat: roundCoord(building.lat),
      lng: roundCoord(building.lng),
    };
  }
  return fallbackCenter;
}

// South campus zone anchors (editable).
// These anchors are derived from real building coordinates from Excel.
export const XDU_CAMPUS_ZONE_MAP = {
  'network-center': {
    label: 'Regional Control Hub',
    center: resolveZoneCenter('network-center', XDU_CAMPUS_DEFAULT_CENTER),
  },
  library: {
    label: 'Site Cluster A',
    center: resolveZoneCenter('library', XDU_CAMPUS_DEFAULT_CENTER),
  },
  'teaching-area': {
    label: 'Site Cluster B',
    center: resolveZoneCenter('teaching-area', XDU_CAMPUS_DEFAULT_CENTER),
  },
  'lab-area': {
    label: 'Site Cluster C',
    center: resolveZoneCenter('lab-area', XDU_CAMPUS_DEFAULT_CENTER),
  },
  'dorm-area': {
    label: 'Site Cluster D',
    center: resolveZoneCenter('dorm-area', XDU_CAMPUS_DEFAULT_CENTER),
  },
  'canteen-area': {
    label: 'Service Cluster',
    center: resolveZoneCenter('canteen-area', XDU_CAMPUS_DEFAULT_CENTER),
  },
  'stadium-area': {
    label: 'Public Cluster',
    center: resolveZoneCenter('stadium-area', XDU_CAMPUS_DEFAULT_CENTER),
  },
  'gate-area': {
    label: 'Perimeter Gateway Zone',
    center: resolveZoneCenter('gate-area', XDU_CAMPUS_DEFAULT_CENTER),
  },
  'parking-area': {
    label: 'Logistics Cluster',
    center: resolveZoneCenter('parking-area', XDU_CAMPUS_DEFAULT_CENTER),
  },
  'admin-area': {
    label: 'Operations Cluster',
    center: resolveZoneCenter('admin-area', XDU_CAMPUS_DEFAULT_CENTER),
  },
};

export const XDU_CAMPUS_ZONE_OPTIONS = Object.entries(XDU_CAMPUS_ZONE_MAP).map(([value, item]) => ({
  value,
  label: item.label,
}));

export const XDU_CAMPUS_LAYER_OPTIONS = [
  { key: 'backbone', label: 'Core Network' },
  { key: 'access', label: 'Aggregation Layer' },
  { key: 'mesh', label: 'Edge Transport' },
  { key: 'edge', label: 'Access Sensing' },
];

export const XDU_CAMPUS_NODE_TYPE_META = {
  'network-center': { label: 'Core Control Node', color: '#60a5fa', badge: 'CC' },
  'campus-gateway': { label: 'Regional Gateway', color: '#38bdf8', badge: 'RG' },
  'building-gateway': { label: 'Site Gateway', color: '#22d3ee', badge: 'SG' },
  'edge-server': { label: 'Edge Aggregation Server', color: '#34d399', badge: 'ES' },
  camera: { label: 'Video Sensor Node', color: '#f97316', badge: 'VS' },
  'env-sensor': { label: 'Environment Sensor Node', color: '#84cc16', badge: 'EN' },
  'access-control': { label: 'Access Control Device', color: '#f59e0b', badge: 'AC' },
  'smart-meter': { label: 'Metering Device', color: '#eab308', badge: 'MT' },
  'streetlight-controller': { label: 'Lighting Controller', color: '#a78bfa', badge: 'LC' },
  'parking-sensor': { label: 'Parking Detection Sensor', color: '#f472b6', badge: 'PK' },
  'lab-terminal': { label: 'Operational Terminal', color: '#4ade80', badge: 'OT' },
  'classroom-terminal': { label: 'Service Terminal', color: '#93c5fd', badge: 'ST' },
  'dorm-device': { label: 'Client IoT Device', color: '#c084fc', badge: 'CD' },
  'library-terminal': { label: 'Information Terminal', color: '#67e8f9', badge: 'IT' },
  'security-platform': { label: 'Security Analysis Platform', color: '#fb7185', badge: 'SA' },
  'iot-device': { label: 'IoT Device', color: '#94a3b8', badge: 'Io' },
};

export const XDU_CAMPUS_DEVICE_TYPE_OPTIONS = [
  { value: 'camera', label: 'Video Sensor Node', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'teaching-area', role: 'camera' },
  { value: 'env-sensor', label: 'Environment Sensor Node', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'teaching-area', role: 'env-sensor' },
  { value: 'access-control', label: 'Access Control Device', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'gate-area', role: 'access-control' },
  { value: 'smart-meter', label: 'Metering Device', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'dorm-area', role: 'smart-meter' },
  { value: 'streetlight-controller', label: 'Lighting Controller', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'stadium-area', role: 'streetlight-controller' },
  { value: 'parking-sensor', label: 'Parking Detection Sensor', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'parking-area', role: 'parking-sensor' },
  { value: 'lab-terminal', label: 'Operational Terminal', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'lab-area', role: 'lab-terminal' },
  { value: 'classroom-terminal', label: 'Service Terminal', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'teaching-area', role: 'classroom-terminal' },
  { value: 'dorm-device', label: 'Client IoT Device', baseType: 'terminal', defaultLayer: 'edge', defaultZone: 'dorm-area', role: 'dorm-device' },
  { value: 'building-gateway', label: 'Site Gateway', baseType: 'base-station', defaultLayer: 'access', defaultZone: 'teaching-area', role: 'building-gateway' },
  { value: 'edge-server', label: 'Edge Aggregation Server', baseType: 'mesh-node', defaultLayer: 'mesh', defaultZone: 'lab-area', role: 'edge-server' },
  { value: 'campus-gateway', label: 'Regional Gateway', baseType: 'router', defaultLayer: 'backbone', defaultZone: 'network-center', role: 'campus-gateway' },
  { value: 'network-center', label: 'Core Control Node', baseType: 'satellite', defaultLayer: 'backbone', defaultZone: 'network-center', role: 'network-center' },
  { value: 'security-platform', label: 'Security Analysis Platform', baseType: 'router', defaultLayer: 'backbone', defaultZone: 'admin-area', role: 'security-platform' },
];

export const XDU_CAMPUS_DEVICE_TYPE_BY_KEY = XDU_CAMPUS_DEVICE_TYPE_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item;
  return acc;
}, {});

const TERMINAL_TYPE_CYCLE = [
  'camera',
  'env-sensor',
  'access-control',
  'smart-meter',
  'parking-sensor',
  'lab-terminal',
  'classroom-terminal',
  'dorm-device',
];

const ROLE_TO_CAMPUS_TYPE = {
  core: 'campus-gateway',
  relay: 'building-gateway',
  user: 'iot-device',
  'network-center': 'network-center',
  'campus-gateway': 'campus-gateway',
  'building-gateway': 'building-gateway',
  'edge-server': 'edge-server',
  camera: 'camera',
  'env-sensor': 'env-sensor',
  'access-control': 'access-control',
  'smart-meter': 'smart-meter',
  'streetlight-controller': 'streetlight-controller',
  'parking-sensor': 'parking-sensor',
  'lab-terminal': 'lab-terminal',
  'classroom-terminal': 'classroom-terminal',
  'dorm-device': 'dorm-device',
  'library-terminal': 'library-terminal',
  'security-platform': 'security-platform',
};

const GENERIC_NAME_PATTERN = /^(backbone|adhoc|terminal|core router|aggregation router|mesh node|base station|leo satellite|live-terminal|fe-|router|node)/i;

// Backward-compatible alias map for legacy simulated IDs.
const XDU_NODE_OVERRIDE_BY_ID = {
  B1: { name: 'Legacy Backbone Node B1', campusType: 'campus-gateway', zone: 'network-center', layer: 'backbone' },
  B2: { name: 'Legacy Backbone Node B2', campusType: 'campus-gateway', zone: 'admin-area', layer: 'backbone' },
  B3: { name: 'Legacy Backbone Node B3', campusType: 'security-platform', zone: 'gate-area', layer: 'backbone' },
  A1: { name: 'Legacy Access Node A1', campusType: 'building-gateway', zone: 'teaching-area', layer: 'access' },
  A2: { name: 'Legacy Access Node A2', campusType: 'edge-server', zone: 'lab-area', layer: 'mesh' },
  A3: { name: 'Legacy Access Node A3', campusType: 'building-gateway', zone: 'library', layer: 'access' },
  A4: { name: 'Legacy Access Node A4', campusType: 'edge-server', zone: 'dorm-area', layer: 'mesh' },
  A5: { name: 'Legacy Access Node A5', campusType: 'building-gateway', zone: 'stadium-area', layer: 'access' },
  'SAT-901': { name: 'Legacy Security Platform', campusType: 'security-platform', zone: 'network-center', layer: 'backbone' },
};

// Special fixed nodes for the building-level demo.
const XDU_SOUTH_CAMPUS_SPECIAL_NODE_GEO = {
  [CAMPUS_CORE_NODE_ID]: {
    lat: roundCoord(NETWORK_CENTER_BUILDING?.lat ?? XDU_CAMPUS_DEFAULT_CENTER.lat),
    lng: roundCoord(NETWORK_CENTER_BUILDING?.lng ?? XDU_CAMPUS_DEFAULT_CENTER.lng),
    altitude: 30,
  },
};

function isInsideCampusBounds(geo) {
  if (!geo) {
    return false;
  }
  const lat = toFiniteNumber(geo.lat, NaN);
  const lng = toFiniteNumber(geo.lng, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  return lat >= CAMPUS_LAT_RANGE.min && lat <= CAMPUS_LAT_RANGE.max
    && lng >= CAMPUS_LNG_RANGE.min && lng <= CAMPUS_LNG_RANGE.max;
}

function findNearestZoneByGeo(geo) {
  if (!geo) {
    return 'teaching-area';
  }
  const current = {
    lat: toFiniteNumber(geo.lat, XDU_CAMPUS_DEFAULT_CENTER.lat),
    lng: toFiniteNumber(geo.lng, XDU_CAMPUS_DEFAULT_CENTER.lng),
  };
  let targetZone = 'teaching-area';
  let bestDistance = Number.POSITIVE_INFINITY;
  Object.entries(XDU_CAMPUS_ZONE_MAP).forEach(([zone, item]) => {
    const distance = distanceSquared(current, item.center);
    if (distance < bestDistance) {
      bestDistance = distance;
      targetZone = zone;
    }
  });
  return targetZone;
}

export function getCampusPointByZone(zone, seed = 'xdu-campus', altitude = 0) {
  const zoneKey = XDU_CAMPUS_ZONE_MAP[zone] ? zone : 'teaching-area';
  const zoneCenter = XDU_CAMPUS_ZONE_MAP[zoneKey].center;
  const { latOffset, lngOffset } = buildDeterministicOffset(seed);
  return {
    lat: roundCoord(clamp(zoneCenter.lat + latOffset, CAMPUS_LAT_RANGE.min, CAMPUS_LAT_RANGE.max)),
    lng: roundCoord(clamp(zoneCenter.lng + lngOffset, CAMPUS_LNG_RANGE.min, CAMPUS_LNG_RANGE.max)),
    altitude: toFiniteNumber(altitude, 0),
  };
}

function inferCampusType(rawNode, nodeId, index = 0) {
  const role = String(rawNode?.role || '').trim().toLowerCase();
  if (ROLE_TO_CAMPUS_TYPE[role]) {
    return ROLE_TO_CAMPUS_TYPE[role];
  }

  const rawType = String(rawNode?.type || rawNode?.node_type || '').trim().toLowerCase();
  if (rawType === 'router') {
    return 'campus-gateway';
  }
  if (rawType === 'base-station') {
    return 'building-gateway';
  }
  if (rawType === 'mesh-node' || rawType === 'adhoc-node') {
    return 'edge-server';
  }
  if (rawType === 'satellite') {
    return 'network-center';
  }
  if (rawType === 'terminal') {
    return pickByHash(TERMINAL_TYPE_CYCLE, `${nodeId}-${index}`) || 'iot-device';
  }
  if (String(nodeId || '').toUpperCase().startsWith('U-LIVE')) {
    return pickByHash(TERMINAL_TYPE_CYCLE, nodeId) || 'iot-device';
  }
  return 'iot-device';
}

function inferZone(rawNode, layer, campusType, nodeId, preferredGeo = null) {
  const explicitZone = String(rawNode?.campusZone || rawNode?.zone || '').trim();
  if (explicitZone && XDU_CAMPUS_ZONE_MAP[explicitZone]) {
    return explicitZone;
  }

  const profile = XDU_CAMPUS_DEVICE_TYPE_BY_KEY[campusType];
  if (preferredGeo && Number.isFinite(preferredGeo.lat) && Number.isFinite(preferredGeo.lng)) {
    return findNearestZoneByGeo(preferredGeo);
  }
  if (profile?.defaultZone) {
    return profile.defaultZone;
  }
  if (layer === 'backbone') {
    return 'network-center';
  }
  if (layer === 'access') {
    return pickByHash(['teaching-area', 'library', 'admin-area', 'stadium-area'], nodeId) || 'teaching-area';
  }
  if (layer === 'mesh') {
    return pickByHash(['lab-area', 'dorm-area', 'canteen-area'], nodeId) || 'lab-area';
  }
  return pickByHash(['teaching-area', 'dorm-area', 'library', 'gate-area', 'parking-area'], nodeId) || 'teaching-area';
}

function buildCampusName(rawNode, nodeId, campusType) {
  const rawName = String(rawNode?.name || '').trim();
  if (rawName && !GENERIC_NAME_PATTERN.test(rawName)) {
    return rawName;
  }
  const typeMeta = XDU_CAMPUS_NODE_TYPE_META[campusType];
  const typeLabel = typeMeta?.label || 'Campus Node';
  return `${typeLabel} ${nodeId}`;
}

export function mapNodeToXduCampus(rawNode, index = 0) {
  if (!rawNode || typeof rawNode !== 'object') {
    return rawNode;
  }

  const nodeId = String(rawNode.id || rawNode.node_id || `NODE-${index + 1}`).trim();
  if (!nodeId) {
    return rawNode;
  }

  const override = XDU_NODE_OVERRIDE_BY_ID[nodeId];
  const campusType = override?.campusType || inferCampusType(rawNode, nodeId, index);
  const profile = XDU_CAMPUS_DEVICE_TYPE_BY_KEY[campusType] || XDU_CAMPUS_DEVICE_TYPE_BY_KEY.camera;
  const layer = normalizeLayer(override?.layer || rawNode.layer, profile?.defaultLayer || 'edge');

  const currentGeo = rawNode?.location?.geo;
  const rawAltitude = toFiniteNumber(currentGeo?.altitude, 0);
  const preferredGeo = currentGeo
    ? { lat: toFiniteNumber(currentGeo.lat, NaN), lng: toFiniteNumber(currentGeo.lng, NaN) }
    : null;
  const zone = override?.zone || inferZone(rawNode, layer, campusType, nodeId, preferredGeo);

  // Priority:
  // 1) explicit legacy override geo
  // 2) existing in-campus geo
  // 3) zone-anchor deterministic fallback
  let geo;
  if (override?.geo) {
    geo = {
      lat: toFiniteNumber(override.geo.lat, XDU_CAMPUS_DEFAULT_CENTER.lat),
      lng: toFiniteNumber(override.geo.lng, XDU_CAMPUS_DEFAULT_CENTER.lng),
      altitude: toFiniteNumber(override.geo.altitude, rawAltitude),
    };
  } else if (isInsideCampusBounds(currentGeo)) {
    geo = {
      lat: toFiniteNumber(currentGeo.lat, XDU_CAMPUS_DEFAULT_CENTER.lat),
      lng: toFiniteNumber(currentGeo.lng, XDU_CAMPUS_DEFAULT_CENTER.lng),
      altitude: rawAltitude,
    };
  } else {
    geo = getCampusPointByZone(zone, nodeId, rawAltitude);
  }

  geo.lat = roundCoord(clamp(geo.lat, CAMPUS_LAT_RANGE.min, CAMPUS_LAT_RANGE.max));
  geo.lng = roundCoord(clamp(geo.lng, CAMPUS_LNG_RANGE.min, CAMPUS_LNG_RANGE.max));

  return {
    ...rawNode,
    id: nodeId,
    name: override?.name || buildCampusName(rawNode, nodeId, campusType),
    type: campusType,
    layer,
    role: String(rawNode.role || profile?.role || campusType),
    campusZone: zone,
    location: {
      ...rawNode.location,
      geo,
    },
  };
}

function inferBuildingZone(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('network-center')) {
    return 'network-center';
  }
  if (text.includes('dorm')) {
    return 'dorm-area';
  }
  if (text.includes('canteen')) {
    return 'canteen-area';
  }
  if (text.includes('stadium')) {
    return 'stadium-area';
  }
  if (text.includes('hospital')) {
    return 'admin-area';
  }
  if (text.includes('office')) {
    return 'admin-area';
  }
  if (text.includes('network-security')) {
    return 'lab-area';
  }
  if (/^[a-z]\s*building$/i.test(text)) {
    return 'teaching-area';
  }
  if (text.includes('activity')) {
    return 'gate-area';
  }
  return 'teaching-area';
}

function inferBuildingGatewayType(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('network-center')) {
    return 'campus-gateway';
  }
  if (text.includes('network-security')) {
    return 'edge-server';
  }
  return 'building-gateway';
}

function inferDeviceTypePool(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('dorm')) {
    return ['dorm-device', 'access-control', 'smart-meter', 'camera', 'env-sensor'];
  }
  if (text.includes('canteen') || text.includes('stadium') || text.includes('activity') || text.includes('hospital')) {
    return ['camera', 'access-control', 'smart-meter', 'env-sensor'];
  }
  if (text.includes('network-security')) {
    return ['lab-terminal', 'camera', 'env-sensor', 'access-control', 'smart-meter'];
  }
  if (/^[a-z]\s*building$/i.test(text) || text.includes('building')) {
    return ['classroom-terminal', 'camera', 'env-sensor', 'access-control', 'smart-meter'];
  }
  return ['camera', 'env-sensor', 'access-control', 'smart-meter', 'iot-device'];
}

function createNodeState(seed, core = false) {
  if (core) {
    return { online: true, status: 'normal' };
  }
  const hash = hashString(seed);
  if (hash % 41 === 0) {
    return { online: false, status: 'offline' };
  }
  if (hash % 13 === 0) {
    return { online: true, status: 'warning' };
  }
  if (hash % 17 === 0) {
    return { online: true, status: 'busy' };
  }
  return { online: true, status: 'normal' };
}

function createCampusNode({
  id,
  name,
  type,
  layer,
  zone,
  geo,
  role,
  stateSeed,
  core = false,
  synthetic = false,
}) {
  const state = createNodeState(stateSeed || id, core);
  return {
    id,
    name,
    type,
    layer,
    synthetic: !!synthetic,
    role: role || type,
    campusZone: zone,
    location: {
      geo: {
        lat: roundCoord(clamp(geo.lat, CAMPUS_LAT_RANGE.min, CAMPUS_LAT_RANGE.max)),
        lng: roundCoord(clamp(geo.lng, CAMPUS_LNG_RANGE.min, CAMPUS_LNG_RANGE.max)),
        altitude: toFiniteNumber(geo.altitude, 0),
      },
    },
    state,
    energy: core ? 98 : 88,
    capacity: core ? 95 : 72,
    cpu: core ? 0.34 : 0.24,
    load: core ? 0.42 : 0.29,
  };
}

function createDeviceGeoAroundBuilding(buildingGeo, seed, index, total) {
  const hash = hashString(`${seed}-${index}`);
  const baseAngle = (index / Math.max(1, total)) * Math.PI * 2;
  const randomAngle = ((hash % 360) / 360) * Math.PI * 2;
  const angle = baseAngle + (randomAngle * 0.45);
  const radius = 0.00008 + ((hash % 7) * 0.000022);
  const latOffset = Math.sin(angle) * radius;
  const lngOffset = Math.cos(angle) * radius;
  return {
    lat: roundCoord(clamp(buildingGeo.lat + latOffset, CAMPUS_LAT_RANGE.min, CAMPUS_LAT_RANGE.max)),
    lng: roundCoord(clamp(buildingGeo.lng + lngOffset, CAMPUS_LNG_RANGE.min, CAMPUS_LNG_RANGE.max)),
    altitude: 2 + (hash % 6),
  };
}

function createCampusLink({
  id,
  from,
  to,
  type,
  bandwidthMbps,
  delayMs,
  lossRate,
  utilization,
  snrDb,
  state = 'up',
  availability = 0.995,
}) {
  return {
    id,
    from,
    to,
    type,
    state,
    bandwidthMbps,
    delayMs,
    lossRate,
    utilization,
    availability,
    snrDb,
  };
}

function buildGeneratedSouthCampusTopology() {
  const coreGeo = XDU_SOUTH_CAMPUS_SPECIAL_NODE_GEO[CAMPUS_CORE_NODE_ID] || {
    lat: XDU_CAMPUS_DEFAULT_CENTER.lat,
    lng: XDU_CAMPUS_DEFAULT_CENTER.lng,
    altitude: 30,
  };

  const coreNode = createCampusNode({
    id: CAMPUS_CORE_NODE_ID,
    name: 'South Campus Network Center',
    type: 'network-center',
    layer: 'backbone',
    zone: 'network-center',
    geo: coreGeo,
    role: 'network-center',
    stateSeed: CAMPUS_CORE_NODE_ID,
    core: true,
    synthetic: true,
  });

  const buildingNodes = XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.map((building, index) => {
    const zone = inferBuildingZone(building.name);
    const type = inferBuildingGatewayType(building.name);
    return createCampusNode({
      id: building.buildingId,
      name: building.name,
      type,
      layer: 'access',
      zone,
      geo: {
        lat: toFiniteNumber(building.lat, XDU_CAMPUS_DEFAULT_CENTER.lat),
        lng: toFiniteNumber(building.lng, XDU_CAMPUS_DEFAULT_CENTER.lng),
        altitude: 14 + (index % 8),
      },
      role: 'building-gateway',
      stateSeed: building.buildingId,
      synthetic: true,
    });
  });

  const deviceNodes = [];
  const buildingDeviceIds = {};
  buildingNodes.forEach((buildingNode) => {
    const pool = inferDeviceTypePool(buildingNode.name);
    const deviceCount = 3 + (hashString(`${buildingNode.id}-device-count`) % 4); // 3~6
    const typeSeed = hashString(`${buildingNode.id}-device-type`);
    const currentIds = [];
    for (let index = 0; index < deviceCount; index += 1) {
      const deviceType = pool[(typeSeed + index) % pool.length];
      const deviceId = `${buildingNode.id}-IOT-${String(index + 1).padStart(2, '0')}`;
      currentIds.push(deviceId);
      const geo = createDeviceGeoAroundBuilding(buildingNode.location.geo, buildingNode.id, index, deviceCount);
      deviceNodes.push(createCampusNode({
        id: deviceId,
        name: `${buildingNode.name} ${XDU_CAMPUS_NODE_TYPE_META[deviceType]?.label || 'IoT Device'} ${String(index + 1).padStart(2, '0')}`,
        type: deviceType,
        layer: 'edge',
        zone: buildingNode.campusZone,
        geo,
        role: deviceType,
        stateSeed: deviceId,
        synthetic: true,
      }));
    }
    buildingDeviceIds[buildingNode.id] = currentIds;
  });

  const links = [];
  const relations = [];

  buildingNodes.forEach((buildingNode, index) => {
    const hash = hashString(`${buildingNode.id}-core-link`);
    links.push(createCampusLink({
      id: `XDU-LNK-CORE-${String(index + 1).padStart(3, '0')}`,
      from: CAMPUS_CORE_NODE_ID,
      to: buildingNode.id,
      type: 'wired',
      bandwidthMbps: 1000,
      delayMs: 2 + (hash % 6),
      lossRate: Number((0.001 + ((hash % 8) / 10000)).toFixed(4)),
      utilization: Number((0.21 + ((hash % 35) / 100)).toFixed(3)),
      snrDb: 35 + (hash % 6),
      availability: Number((0.996 + ((hash % 3) / 1000)).toFixed(3)),
    }));

    relations.push({
      id: `XDU-REL-CORE-${String(index + 1).padStart(3, '0')}`,
      from: CAMPUS_CORE_NODE_ID,
      to: buildingNode.id,
      relation: 'campus-core-aggregation',
    });
  });

  buildingNodes.forEach((buildingNode) => {
    const deviceIds = buildingDeviceIds[buildingNode.id] || [];
    deviceIds.forEach((deviceId, index) => {
      const hash = hashString(`${buildingNode.id}-${deviceId}-access`);
      links.push(createCampusLink({
        id: `XDU-LNK-ACC-${buildingNode.id}-${String(index + 1).padStart(2, '0')}`,
        from: buildingNode.id,
        to: deviceId,
        type: 'wireless',
        bandwidthMbps: 80 + (hash % 80),
        delayMs: 5 + (hash % 18),
        lossRate: Number((0.002 + ((hash % 12) / 1000)).toFixed(4)),
        utilization: Number((0.12 + ((hash % 52) / 100)).toFixed(3)),
        snrDb: 20 + (hash % 12),
        availability: Number((0.982 + ((hash % 16) / 1000)).toFixed(3)),
      }));
    });
  });

  const redundancyPairSet = new Set();
  let redundancyIndex = 1;
  buildingNodes.forEach((buildingNode, index) => {
    if (index % 3 !== 0) {
      return;
    }
    const neighbors = buildingNodes
      .filter((candidate) => candidate.id !== buildingNode.id)
      .map((candidate) => ({
        node: candidate,
        distance: distanceSquared(buildingNode.location.geo, candidate.location.geo),
      }))
      .sort((left, right) => left.distance - right.distance);

    const nearest = neighbors[0]?.node;
    if (!nearest) {
      return;
    }
    const pairKey = [buildingNode.id, nearest.id].sort().join('|');
    if (redundancyPairSet.has(pairKey)) {
      return;
    }
    redundancyPairSet.add(pairKey);
    const hash = hashString(`redundancy-${pairKey}`);
    links.push(createCampusLink({
      id: `XDU-LNK-RED-${String(redundancyIndex).padStart(3, '0')}`,
      from: buildingNode.id,
      to: nearest.id,
      type: 'wired',
      bandwidthMbps: 400,
      delayMs: 4 + (hash % 6),
      lossRate: Number((0.001 + ((hash % 6) / 10000)).toFixed(4)),
      utilization: Number((0.18 + ((hash % 40) / 100)).toFixed(3)),
      snrDb: 28 + (hash % 10),
      availability: Number((0.99 + ((hash % 8) / 1000)).toFixed(3)),
    }));
    redundancyIndex += 1;
  });

  return {
    nodes: [coreNode, ...buildingNodes, ...deviceNodes],
    links,
    crossLayerRelations: relations,
  };
}

function normalizeSourceLink(rawLink, index) {
  if (!rawLink || typeof rawLink !== 'object') {
    return null;
  }
  const id = String(rawLink.id || `SRC-LINK-${index + 1}`).trim();
  const from = String(rawLink.from || '').trim();
  const to = String(rawLink.to || '').trim();
  if (!id || !from || !to) {
    return null;
  }
  return {
    ...rawLink,
    id,
    from,
    to,
  };
}

export function applyXduCampusPreset(topology) {
  const source = topology && typeof topology === 'object' ? topology : {};
  const sourceNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const sourceLinks = Array.isArray(source.links) ? source.links : [];
  const sourceRelations = Array.isArray(source.crossLayerRelations) ? source.crossLayerRelations : [];

  const generatedTopology = buildGeneratedSouthCampusTopology();
  const generatedNodes = generatedTopology.nodes;
  const generatedLinks = generatedTopology.links;
  const generatedRelations = generatedTopology.crossLayerRelations;

  const generatedNodeIdSet = new Set(generatedNodes.map((node) => node.id));
  const generatedLinkIdSet = new Set(generatedLinks.map((link) => link.id));
  const generatedRelationIdSet = new Set(generatedRelations.map((relation) => relation.id));

  // Keep source nodes for runtime compatibility (Add/Remove, alerts, playback),
  // while avoiding ID collision with generated building topology.
  const mappedSourceNodes = sourceNodes
    .map((node, index) => mapNodeToXduCampus(node, index))
    .filter((node) => node && node.id && !generatedNodeIdSet.has(node.id));

  const mergedNodes = [...generatedNodes, ...mappedSourceNodes];
  const mergedNodeIdSet = new Set(mergedNodes.map((node) => node.id));

  const mergedLinks = [...generatedLinks];
  sourceLinks.forEach((rawLink, index) => {
    const link = normalizeSourceLink(rawLink, index);
    if (!link) {
      return;
    }
    if (generatedLinkIdSet.has(link.id)) {
      return;
    }
    if (!mergedNodeIdSet.has(link.from) || !mergedNodeIdSet.has(link.to)) {
      return;
    }
    mergedLinks.push(link);
  });

  const mergedRelations = [...generatedRelations];
  sourceRelations.forEach((relation, index) => {
    if (!relation || typeof relation !== 'object') {
      return;
    }
    const relationId = String(relation.id || `SRC-REL-${index + 1}`).trim();
    if (!relationId || generatedRelationIdSet.has(relationId)) {
      return;
    }
    mergedRelations.push({
      ...relation,
      id: relationId,
    });
  });

  return {
    ...source,
    meta: {
      ...(source.meta || {}),
      name: 'xdu-south-campus-building-topology',
      version: CAMPUS_TOPOLOGY_VERSION,
      buildingCount: XDU_SOUTH_CAMPUS_BUILDINGS_WGS84.length,
    },
    nodes: mergedNodes,
    links: mergedLinks,
    crossLayerRelations: mergedRelations,
  };
}
