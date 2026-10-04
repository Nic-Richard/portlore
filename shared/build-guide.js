import { buildCityCurationPrompt, buildCityData } from './poi-curation.js';
import { curateCity } from './curation-model.js';
import { fillPlaceIds, googleSearchCount, resolveCatalogGooglePlaces, resolveCurationGooglePlaces } from './google-places.js';
import { describeFromWebsites, findMissingWebsites, liveWebsiteIds } from './website-descriptions.js';

// Google is only asked whether businesses are still open; sights, parks, beaches, markets and malls rarely close.
// A business whose own website is live is open, so it is skipped as well, and missing websites are looked up
// first so more of them can be.
function needsOpenCheck(poi) {
  return (['food_drink', 'shopping'].includes(poi.category) || poi.subcategory === 'pharmacy')
    && !['marketplace', 'mall'].includes(poi.subcategory);
}

export async function buildGuideData(portInfo, catalog, { apiKey, cachePath, patient = false }) {
  const searchesBefore = googleSearchCount();
  const model = await curateCity(buildCityCurationPrompt(portInfo, catalog));
  const curation = model.curation;

  const picked = new Set((Array.isArray(curation.places) ? curation.places : []).map(item => item?.sourceId).filter(Boolean));
  const businesses = (catalog.pois || []).filter(poi => picked.has(poi.sourceId) && needsOpenCheck(poi));
  const sites = businesses.map(poi => ({
    id: poi.sourceId, name: poi.nameEnglish || poi.name, address: poi.address, category: poi.category, website: poi.website,
  }));
  let search = { found: new Set(), searches: 0, cost: 0 };
  try {
    search = await findMissingWebsites(sites, [portInfo.city, portInfo.country].filter(Boolean).join(', '));
  } catch {}
  for (const site of sites) site.found = search.found.has(site.id);
  const pages = new Map();
  const live = await liveWebsiteIds(sites.filter(site => site.website), pages);
  const foundSites = new Map(sites.filter(site => site.found && live.has(site.id)).map(site => [site.id, site.website]));

  const googleMatches = await resolveCatalogGooglePlaces(portInfo, catalog, {
    apiKey,
    cachePath,
    onlyIds: businesses.filter(poi => !live.has(poi.sourceId)).map(poi => poi.sourceId),
    requireFields: true,
  });
  const resolvedCuration = await resolveCurationGooglePlaces(portInfo, catalog, curation, {
    apiKey,
    cachePath,
    catalogMatches: googleMatches,
    patient,
  });
  const data = { ...buildCityData(portInfo, catalog, resolvedCuration, googleMatches), model: model.model };
  if (!data.places.length) throw new Error('None of the stops the model picked are in the catalog');
  try {
    await fillPlaceIds(data, apiKey);
  } catch (error) {
    console.warn(`Free place ID lookups stopped: ${error.message}`);
  }

  let websites = { checked: 0, found: 0, searches: 0, rewritten: 0, dead: 0, cost: 0 };
  try {
    websites = await describeFromWebsites(data, catalog, { pages, foundSites });
  } catch (error) {
    websites.error = error.message;
  }
  websites.searches += search.searches;
  websites.cost += search.cost;
  return { data, model, websites, googleSearches: googleSearchCount() - searchesBefore };
}
