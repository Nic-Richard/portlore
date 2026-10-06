export function createGuideApi({ origin = '', request = globalThis.fetch, store }) {
  async function loadGuide(portId) {
    try {
      const response = await request(`${origin}/api/city/${portId}`);
      if (response.ok) {
        const guide = await response.json();
        store.saveGuide(portId, guide);
        return { guide, offline: false };
      }
      if (response.status === 404) return null;
    } catch {
      const guide = store.readSaved(`portlore-guide:${portId}`);
      if (guide) return { guide, offline: true };
    }
    try {
      const response = await request(`${origin}/cities/${portId}.json`);
      if (response.ok) return { guide: await response.json(), offline: false };
    } catch {}
    return null;
  }
  return { loadGuide };
}
