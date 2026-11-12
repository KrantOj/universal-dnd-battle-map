'use strict';
// Построители тестовых карт (формат vestfalia-battlemap/1) для geometry/movement тестов.

function mkMap(cols, rows, o) {
  o = o || {};
  function grid(v) {
    const g = [];
    for (let y = 0; y < rows; y++) { g.push([]); for (let x = 0; x < cols; x++) g[y].push(v); }
    return g;
  }
  const layers = {
    terrain: grid('floor'), elevation_ft: grid(0), difficult: grid(0),
    hazard: grid(null), obstacle: grid(0), walkable: grid(1),
  };
  if (o.set) o.set(layers);
  const meta = {
    format: 'vestfalia-battlemap/1',
    resolution: { map_size: { x: cols, y: rows }, pixels_per_grid: 70, feet_per_cell: 5 },
    layers, line_of_sight: o.los || [], portals: o.portals || [],
  };
  return { name: 'test', cols, rows, ppg: 70, feet: 5, meta };
}

// Стены + закрытые двери; open — массив флагов по дверям (true = открыта).
function segsOf(VTT, map, open) {
  return VTT.geometry.blockingSegments(VTT.geometry.segmentsFromMap(map.meta), open || []);
}

function P(x, y) { return { x, y }; }

function line(...nums) {
  const a = [];
  for (let i = 0; i < nums.length; i += 2) a.push({ x: nums[i], y: nums[i + 1] });
  return a;
}

module.exports = { mkMap, segsOf, P, line };
