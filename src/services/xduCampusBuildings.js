// Source: Excel `Sheet1` from `主要建筑.xlsx`
// Columns: 建筑名称 | lng | lat
// These lng/lat values are collected from Gaode map (GCJ-02).
// Keep raw GCJ values here and convert to WGS84 in preset pipeline.
export const XDU_SOUTH_CAMPUS_BUILDINGS = [
  { buildingId: 'XDU-BLD-001', name: 'Activity center', coordSystem: 'gcj02', gcjLng: 108.828413, gcjLat: 34.126971 },
  { buildingId: 'XDU-BLD-002', name: 'A building', coordSystem: 'gcj02', gcjLng: 108.830554, gcjLat: 34.127011 },
  { buildingId: 'XDU-BLD-003', name: 'B building', coordSystem: 'gcj02', gcjLng: 108.831664, gcjLat: 34.125998 },
  { buildingId: 'XDU-BLD-004', name: 'C building', coordSystem: 'gcj02', gcjLng: 108.833117, gcjLat: 34.125931 },
  { buildingId: 'XDU-BLD-005', name: 'D building', coordSystem: 'gcj02', gcjLng: 108.835413, gcjLat: 34.124815 },
  { buildingId: 'XDU-BLD-006', name: 'E building', coordSystem: 'gcj02', gcjLng: 108.837145, gcjLat: 34.123652 },
  { buildingId: 'XDU-BLD-007', name: 'F building', coordSystem: 'gcj02', gcjLng: 108.836586, gcjLat: 34.124312 },
  { buildingId: 'XDU-BLD-008', name: 'G building', coordSystem: 'gcj02', gcjLng: 108.838289, gcjLat: 34.123538 },
  { buildingId: 'XDU-BLD-009', name: 'Stadium', coordSystem: 'gcj02', gcjLng: 108.838098, gcjLat: 34.120063 },
  { buildingId: 'XDU-BLD-010', name: 'Hospital', coordSystem: 'gcj02', gcjLng: 108.842371, gcjLat: 34.126378 },
  { buildingId: 'XDU-BLD-011', name: 'Office1', coordSystem: 'gcj02', gcjLng: 108.836922, gcjLat: 34.121934 },
  { buildingId: 'XDU-BLD-012', name: 'Network-security building', coordSystem: 'gcj02', gcjLng: 108.834635, gcjLat: 34.121409 },
  { buildingId: 'XDU-BLD-013', name: 'Dingxiang-Canteen', coordSystem: 'gcj02', gcjLng: 108.829307, gcjLat: 34.123631 },
  { buildingId: 'XDU-BLD-014', name: 'Dingxiang-Dorm', coordSystem: 'gcj02', gcjLng: 108.828036, gcjLat: 34.123053 },
  { buildingId: 'XDU-BLD-015', name: 'Haitang-Canteen', coordSystem: 'gcj02', gcjLng: 108.833941, gcjLat: 34.129658 },
  { buildingId: 'XDU-BLD-016', name: 'Haitang-Dorm', coordSystem: 'gcj02', gcjLng: 108.832541, gcjLat: 34.130115 },
  { buildingId: 'XDU-BLD-017', name: 'Zhuyuan-Canteen', coordSystem: 'gcj02', gcjLng: 108.837998, gcjLat: 34.126653 },
  { buildingId: 'XDU-BLD-018', name: 'Zhuyuan-Dorm', coordSystem: 'gcj02', gcjLng: 108.839957, gcjLat: 34.126931 },
  { buildingId: 'XDU-BLD-019', name: 'XDU-Network-Center', coordSystem: 'gcj02', gcjLng: 108.834601, gcjLat: 34.124625 },
];

export const XDU_SOUTH_CAMPUS_BUILDING_BY_NAME = XDU_SOUTH_CAMPUS_BUILDINGS.reduce((acc, item) => {
  acc[item.name.toLowerCase()] = item;
  return acc;
}, {});
