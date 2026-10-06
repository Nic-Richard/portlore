export function createGuideStore(storage) {
  // Ports and the last few guides opened are kept on the device, so a passenger ashore without data still
  // has them.
  const SAVED_GUIDE_LIMIT = 10;
  function readSaved(key) {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
  }
  function saveGuide(portId, guide) {
    try {
      const ids = (readSaved('portlore-saved-guides') || []).filter(id => id !== portId);
      ids.unshift(portId);
      for (const old of ids.splice(SAVED_GUIDE_LIMIT)) storage.removeItem(`portlore-guide:${old}`);
      storage.setItem(`portlore-guide:${portId}`, JSON.stringify(guide));
      storage.setItem('portlore-saved-guides', JSON.stringify(ids));
    } catch {}
  }

  return { readSaved, saveGuide };
}
