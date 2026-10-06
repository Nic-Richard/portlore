function hav(a,b,c,d){const R=6371000,p1=a*Math.PI/180,p2=c*Math.PI/180,dp=(c-a)*Math.PI/180,dl=(d-b)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function dlabel(m){const w=Math.round(m/80);return w<2?'<1 min':w<60?`${w} min walk`:`${Math.floor(w/60)}h ${w%60}m walk`;}
function accessFromDistance(m){
  if (m <= 1600) return 'walkable';
  if (m <= 3000) return 'long_walk';
  if (m <= 7000) return 'short_ride';
  return 'transport_required';
}
function accessLabel(access){
  return ({walkable:'Short walk',long_walk:'Longer walk',short_ride:'Short ride',transport_required:'Transport needed'})[access]||'';
}
function enrich(arr, city){
  if (!city?.port) return arr.map(p => ({...p}));
  // Gateway ports (Civitavecchia for Rome) measure walks from the city passengers travel into.
  const origin = city.centre || city.port;
  const calcLat = origin.lat;
  const calcLng = origin.lng;
  const terminalId = city.port.id || city.port.sourceId || '';

  return arr.map(p=>{
    const m=hav(calcLat,calcLng,p.lat,p.lng);
    const minutes=Number(p.suggestedVisitMinutes) || 45;
    return{
      ...p,
      _m:m,
      distLabel:dlabel(m),
      tnLabel:minutes>=60?`${Math.floor(minutes/60)}h${minutes%60?` ${minutes%60}m`:""}`:`${minutes} min`,
      distanceFromTerminalMeters:Math.round(m),
      nearestTerminalId:terminalId,
      access:accessFromDistance(m),
      accessLabel:accessLabel(accessFromDistance(m))
    };
  }).sort((a,b)=>a._m-b._m);
}

const STOP_CATEGORY_LABELS = {
  attraction: 'Attraction',
  food_drink: 'Food & drink',
  shopping: 'Shopping',
  outdoors: 'Outdoors',
  essentials: 'Essentials'
};
function inferStopCategory(place) {
  if (STOP_CATEGORY_LABELS[place?.category]) return place.category;
  const text = `${place?.icon || ''} ${place?.name || ''} ${place?.subtitle || ''} ${(place?.goodFor || []).join(' ')}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/cafe|coffee|restaurant|food|drink|bar|pub|brewery|bakery|market hall|dining/.test(text)) return 'food_drink';
  if (/\bshop(?:ping)?\b|\bstore\b|souvenir|retail|farmers'? market|city market|\bmall\b/.test(text)) return 'shopping';
  if (/park|trail|beach|garden|nature|waterfall|lookout|viewpoint|scenic|outdoor/.test(text)) return 'outdoors';
  if (/pharmacy|hospital|clinic|grocery|bank|atm|post office|visitor centre|visitor center/.test(text)) return 'essentials';
  return 'attraction';
}
function normalizeStop(place) {
  return {...place, category: inferStopCategory(place)};
}

function defaultVisitMinutes(place) {
  if (Number(place?.suggestedVisitMinutes) > 0) return Number(place.suggestedVisitMinutes);
  const text = `${place?.category || ''} ${place?.name || ''}`.toLowerCase();
  if (/restaurant|cafe|coffee|bar|pub|food|bakery/.test(text)) return 60;
  if (/museum|attraction|gallery|historic|aquarium|zoo/.test(text)) return 60;
  if (/shop|market|mall|store|souvenir/.test(text)) return 45;
  if (/park|view|lookout|beach|garden/.test(text)) return 30;
  if (/pharmacy|bank|post|grocery/.test(text)) return 20;
  return 45;
}

export { hav, dlabel, accessFromDistance, accessLabel, enrich, STOP_CATEGORY_LABELS, inferStopCategory, normalizeStop, defaultVisitMinutes };

export const walkMinutes = place => Math.max(1, Math.round((place._m || 0) / 80));
