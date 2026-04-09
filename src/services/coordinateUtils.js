const EARTH_A = 6378245.0;
const EARTH_EE = 0.00669342162296594323;
const PI = Math.PI;

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function transformLat(x, y) {
  let ret = -100.0 + (2.0 * x) + (3.0 * y) + (0.2 * y * y) + (0.1 * x * y) + (0.2 * Math.sqrt(Math.abs(x)));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * (2.0 / 3.0);
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * (2.0 / 3.0);
  ret += (160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * (2.0 / 3.0);
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + (2.0 * y) + (0.1 * x * x) + (0.1 * x * y) + (0.1 * Math.sqrt(Math.abs(x)));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * (2.0 / 3.0);
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * (2.0 / 3.0);
  ret += (150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * (2.0 / 3.0);
  return ret;
}

export function outOfChina(lng, lat) {
  const safeLng = toFiniteNumber(lng);
  const safeLat = toFiniteNumber(lat);
  if (!Number.isFinite(safeLng) || !Number.isFinite(safeLat)) {
    return true;
  }
  return safeLng < 72.004 || safeLng > 137.8347 || safeLat < 0.8293 || safeLat > 55.8271;
}

function gcjDelta(lng, lat) {
  const dLat = transformLat(lng - 105.0, lat - 35.0);
  const dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - (EARTH_EE * magic * magic);
  const sqrtMagic = Math.sqrt(magic);
  return {
    lat: (dLat * 180.0) / (((EARTH_A * (1 - EARTH_EE)) / (magic * sqrtMagic)) * PI),
    lng: (dLng * 180.0) / ((EARTH_A / sqrtMagic) * Math.cos(radLat) * PI),
  };
}

/**
 * Convert Gaode/Tencent GCJ-02 coordinate to WGS84.
 * Input:  GCJ-02 (lng, lat)
 * Output: WGS84  (lng, lat) for Leaflet/OSM
 */
export function gcj02ToWgs84(lng, lat) {
  const safeLng = toFiniteNumber(lng);
  const safeLat = toFiniteNumber(lat);
  if (!Number.isFinite(safeLng) || !Number.isFinite(safeLat)) {
    return { lng: safeLng, lat: safeLat };
  }
  if (outOfChina(safeLng, safeLat)) {
    return { lng: safeLng, lat: safeLat };
  }

  const delta = gcjDelta(safeLng, safeLat);
  return {
    lng: safeLng - delta.lng,
    lat: safeLat - delta.lat,
  };
}

/**
 * Normalize coordinates to WGS84 based on declared source coordinate system.
 * - coordSystem = "gcj02": apply GCJ-02 -> WGS84
 * - coordSystem = "wgs84": passthrough
 */
export function normalizeToWgs84({ lng, lat, coordSystem = 'wgs84' }) {
  const safeSystem = String(coordSystem || 'wgs84').trim().toLowerCase();
  if (safeSystem === 'gcj02' || safeSystem === 'gcj-02') {
    return gcj02ToWgs84(lng, lat);
  }
  return {
    lng: toFiniteNumber(lng),
    lat: toFiniteNumber(lat),
  };
}

