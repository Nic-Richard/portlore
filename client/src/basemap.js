export const MAP_TIERS = [
  { file: 'world.pmtiles', minZoom: 0, maxZoom: 9, radiusKm: null },
  { file: 'outer.pmtiles', minZoom: 10, maxZoom: 11, radiusKm: 100 },
  { file: 'region.pmtiles', minZoom: 12, maxZoom: 12, radiusKm: 60 },
  { file: 'town.pmtiles', minZoom: 13, maxZoom: 13, radiusKm: 45 },
  { file: 'detail.pmtiles', minZoom: 14, maxZoom: 15, radiusKm: 30 },
];

export async function findMapTile(views, coordinates) {
  const zoom = Math.max(0, Math.min(15, coordinates.z - 1));
  for (let level = zoom; level >= 0; level--) {
    const tile = await views[level].getDisplayTile(coordinates);
    if (tile.data.size) return tile;
  }
  throw new Error('No background map tile available');
}

let tileViews;
export function addBasemap(map, origin) {
  const renderer = window.protomapsL;
  if (!tileViews) {
    // Shared caches need concurrent data zooms; discard the unused cancellation list.
    class MapSource extends renderer.PmtilesSource {
      constructor(url) { super(url, false); }
      async get(coordinates, size) {
        try { return await super.get(coordinates, size); }
        finally { this.zoomaborts.length = 0; }
      }
    }
    tileViews = MAP_TIERS.flatMap(tier => {
      const source = new MapSource(`${origin}/maps/${tier.file}`);
      const cache = new renderer.TileCache(source, 512);
      return Array.from({ length: tier.maxZoom - tier.minZoom + 1 }, (_, index) =>
        new renderer.View(cache, tier.minZoom + index, 1));
    });
  }
  const layer = renderer.leafletLayer({
    url: `${origin}/maps/world.pmtiles`, flavor: 'light', lang: 'en', maxZoom: 19,
    attribution: '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> &middot; <a href="' + origin + '/map-licenses.html" target="_blank" rel="noopener">Licences</a>',
  });
  // Use the renderer's parent-tile transforms to keep fallback geometry aligned.
  layer.views.set('', { getDisplayTile: coordinates => findMapTile(tileViews, coordinates) });
  layer.addTo(map);
  return layer;
}
