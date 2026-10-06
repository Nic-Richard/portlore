const ICON_MAP = {
  market: '🛒', museum: '🏛️', gallery: '🎨', park: '🌿', garden: '🌿',
  waterfall: '💧', water: '💧', rapids: '💧', harbour: '🌊', beach: '🏖️',
  fort: '🏰', castle: '🏰', tower: '🗼', church: '⛪', cathedral: '⛪',
  trail: '🚶', walk: '🚶', nature: '🌿', wildlife: '🌿',
  theatre: '🎭', theater: '🎭', music: '🎵', art: '🎨',
  ship: '🚢', port: '🚢', terminal: '🚢',
  historic: '🍁', heritage: '🍁', burial: '🍁', cemetery: '🍁',
  lookout: '🔭', viewpoint: '🔭', observation: '🔭',
  default: '📍',
};
const FOOD_ICON_RULES = [
  [['lobster'], '🦞'],
  [['shrimp', 'prawn'], '🍤'],
  [['sushi'], '🍣'],
  [['japanese', 'onigiri'], '🍙'],
  [['seafood', 'fish', 'oyster', 'crab'], '🐟'],
  [['pizza'], '🍕'],
  [['indian', 'curry'], '🍛'],
  [['mexican', 'taco'], '🌮'],
  [['italian', 'pasta'], '🍝'],
  [['chinese', 'dumpling', 'dim sum'], '🥟'],
  [['thai', 'ramen', 'noodle', 'pho'], '🍜'],
  [['sandwich', 'deli'], '🥪'],
  [['bakery', 'pastry', 'croissant'], '🥐'],
  [['dessert', 'cake'], '🍰'],
  [['ice cream', 'gelato'], '🍦'],
  [['breakfast', 'brunch', 'pancake'], '🥞'],
  [['barbecue', 'bbq', 'steak', 'grill'], '🍖'],
  [['salad', 'vegan', 'vegetarian'], '🥗'],
  [['coffee', 'cafe', 'espresso', 'tea'], '☕'],
  [['wine'], '🍷'],
  [['cocktail'], '🍸'],
  [['beer', 'brewery'], '🍺'],
  [['burger', 'pub', 'gastropub'], '🍔'],
];
function isEmoji(value) {
  return typeof value === 'string' && /\p{Extended_Pictographic}/u.test(value);
}
function matchFoodIcon(text) {
  const normalized = text.filter(Boolean).join(' ').toLowerCase();
  for (const [terms, emoji] of FOOD_ICON_RULES) {
    if (terms.some(term => normalized.includes(term))) return emoji;
  }
  return null;
}
function foodIcon(place) {
  const taggedIcon = matchFoodIcon([
    place?.subtype,
    ...(place?.tags || []),
    ...(place?.cuisine || []),
  ]);
  if (taggedIcon) return taggedIcon;

  const descriptiveIcon = matchFoodIcon([
    place?.name,
    place?.subtitle,
    ...(place?.goodFor || []),
  ]);
  if (descriptiveIcon) return descriptiveIcon;

  return '🍔';
}
const PLACE_ICON_RULES = [
  [['beach', 'swimming', 'seaside', 'shore'], '🏖️'],
  [['waterfront', 'harbour', 'harbor', 'river', 'waterfall', 'falls', 'rapids', 'ocean'], '🌊'],
  [['birdwatching', 'birds', 'bird'], '🐦'],
  [['wildlife'], '🦌'],
  [['hiking', 'trail', 'walking', 'walk'], '🥾'],
  [['lookout', 'viewpoint', 'views', 'scenic', 'panorama'], '🔭'],
  [['photography', 'photo'], '📷'],
  [['nature', 'park', 'garden', 'outdoors'], '🌿'],
  [['fort', 'castle'], '🏰'],
  [['tower', 'observation'], '🗼'],
  [['museum', 'history', 'historic', 'heritage', 'landmark'], '🏛️'],
  [['church', 'cathedral', 'chapel', 'religious'], '⛪'],
  [['gallery', 'art'], '🎨'],
  [['theatre', 'theater', 'performance'], '🎭'],
  [['music'], '🎵'],
  [['market', 'shopping', 'shops'], '🛍️'],
  [['information', 'orientation', 'visitor centre', 'visitor center'], 'ℹ️'],
  [['family', 'families', 'kids', 'children'], '👨‍👩‍👧'],
  [['tour', 'activity', 'experience'], '🎟️'],
  [['terminal', 'cruise', 'ship', 'port'], '🚢'],
];
function findPlaceIcon(values) {
  const normalized = values.filter(Boolean).join(' ').toLowerCase();
  for (const [terms, emoji] of PLACE_ICON_RULES) {
    if (terms.some(term => normalized.includes(term))) return emoji;
  }
  return null;
}
function matchPlaceIcon(place) {
  const taggedIcon = findPlaceIcon([
    place?.subtype,
    ...(place?.tags || []),
    ...(place?.goodFor || []),
  ]);
  if (taggedIcon) return taggedIcon;

  return findPlaceIcon([
    place?.name,
    place?.subtitle,
  ]);
}
function resolveIcon(placeOrIcon) {
  const place = typeof placeOrIcon === 'object' && placeOrIcon ? placeOrIcon : null;
  const icon = place ? place.icon : placeOrIcon;
  const category = String(place?.category || '').toLowerCase();
  if (category === 'food_drink' || category === 'food' || category === 'restaurant') return foodIcon(place);

  const matchedIcon = place ? matchPlaceIcon(place) : null;
  if (matchedIcon) return matchedIcon;

  if (isEmoji(icon) && icon !== ICON_MAP.default) return icon;
  if (icon) {
    const lower = String(icon).toLowerCase();
    if (/food|restaurant|dining|cafe|coffee|pub|bar|brewery/.test(lower)) return foodIcon(place || { icon });
    for (const [key, emoji] of Object.entries(ICON_MAP)) {
      if (key !== 'default' && lower.includes(key)) return emoji;
    }
  }

  if (category === 'outdoors') return '🌿';
  if (category === 'attractions' || category === 'attraction') return '🏛️';
  if (category === 'shopping') return '🛍️';
  if (category === 'essentials') return 'ℹ️';
  return ICON_MAP.default;
}
// Line icons: Lucide (ISC licence) plus Portlore's own drawings in the same style.
const LINE_ICON_SHAPES = {"aquarium":"<rect x=\"3\" y=\"4.5\" width=\"18\" height=\"15\" rx=\"1.5\"/><path d=\"M6.5 12.5c2-2.2 5.2-2.2 7.2 0-2 2.2-5.2 2.2-7.2 0z\"/><path d=\"m13.7 12.5 3-2v4z\"/><path d=\"M3 8h18\"/><circle cx=\"17\" cy=\"16.5\" r=\".6\" fill=\"currentColor\"/><circle cx=\"15.5\" cy=\"15\" r=\".4\" fill=\"currentColor\"/>","banknote":"<rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/><path d=\"M6 12h.01M18 12h.01\"/>","beach":"<path d=\"M3.5 11a8.5 8.5 0 0 1 17 0z\"/><path d=\"M9 11c0-4 1.3-7 3-8.5M15 11c0-4-1.3-7-3-8.5\"/><path d=\"M12 11v8.5\"/><path d=\"M3 20.5c2 0 2-1 4.5-1s2.5 1 4.5 1 2-1 4.5-1 2.5 1 4.5 1\"/>","beer":"<path d=\"M17 11h1a3 3 0 0 1 0 6h-1\"/><path d=\"M9 12v6\"/><path d=\"M13 12v6\"/><path d=\"M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z\"/><path d=\"M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8\"/>","bike":"<circle cx=\"18.5\" cy=\"17.5\" r=\"3.5\"/><circle cx=\"5.5\" cy=\"17.5\" r=\"3.5\"/><circle cx=\"15\" cy=\"5\" r=\"1\"/><path d=\"M12 17.5V14l-3-3 4-3 2 3h2\"/>","binoculars":"<path d=\"M10 10h4\"/><path d=\"M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3\"/><path d=\"M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z\"/><path d=\"M 22 16 L 2 16\"/><path d=\"M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z\"/><path d=\"M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3\"/>","bird":"<path d=\"M16 7h.01\"/><path d=\"M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20\"/><path d=\"m20 7 2 .5-2 .5\"/><path d=\"M10 18v3\"/><path d=\"M14 17.75V21\"/><path d=\"M7 18a6 6 0 0 0 3.84-10.61\"/>","book-open":"<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>","burger":"<path d=\"M4 10.5C4 6.9 7.6 4.5 12 4.5s8 2.4 8 6z\"/><path d=\"M3.5 13.5c1.2 0 1.8.9 3 .9s1.8-.9 3-.9 1.8.9 3 .9 1.8-.9 3-.9 1.8.9 3 .9 1.8-.9 3-.9\"/><path d=\"M4 16.5h16v1a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z\"/><path d=\"M9 7.5h.01M12 6.8h.01M15 7.5h.01\"/>","bus":"<path d=\"M8 6v6\"/><path d=\"M15 6v6\"/><path d=\"M2 12h19.6\"/><path d=\"M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3\"/><circle cx=\"7\" cy=\"18\" r=\"2\"/><path d=\"M9 18h5\"/><circle cx=\"16\" cy=\"18\" r=\"2\"/>","cake-slice":"<circle cx=\"9\" cy=\"7\" r=\"2\"/><path d=\"M7.2 7.9 3 11v9c0 .6.4 1 1 1h16c.6 0 1-.4 1-1v-9c0-2-3-6-7-8l-3.6 2.6\"/><path d=\"M16 13H3\"/><path d=\"M16 17H3\"/>","camera":"<path d=\"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z\"/><circle cx=\"12\" cy=\"13\" r=\"3\"/>","car-taxi-front":"<path d=\"M10 2h4\"/><path d=\"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8\"/><path d=\"M7 14h.01\"/><path d=\"M17 14h.01\"/><rect width=\"18\" height=\"8\" x=\"3\" y=\"10\" rx=\"2\"/><path d=\"M5 18v2\"/><path d=\"M19 18v2\"/>","castle":"<path d=\"M22 20v-9H2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z\"/><path d=\"M18 11V4H6v7\"/><path d=\"M15 22v-4a3 3 0 0 0-3-3a3 3 0 0 0-3 3v4\"/><path d=\"M22 11V9\"/><path d=\"M2 11V9\"/><path d=\"M6 4V2\"/><path d=\"M18 4V2\"/><path d=\"M10 4V2\"/><path d=\"M14 4V2\"/>","cemetery":"<path d=\"M7 21V9.5a5 5 0 0 1 10 0V21\"/><path d=\"M4.5 21h15\"/><path d=\"M12 10.5v5.5M9.8 12.5h4.4\"/>","check":"<path d=\"M20 6 9 17l-5-5\"/>","cheese":"<path d=\"M3 18.5V11L16.5 5l4.5 6v7.5z\"/><path d=\"M3 11h18\"/><circle cx=\"8\" cy=\"15\" r=\"1.2\"/><circle cx=\"14.5\" cy=\"14.3\" r=\"1.5\"/><circle cx=\"17.5\" cy=\"17\" r=\".8\"/>","chevron-left":"<path d=\"m15 18-6-6 6-6\"/>","chocolate":"<path d=\"M6 3h6.5c.3 2.4 2.6 4 5.5 4v14H6z\"/><path d=\"M6 9h12M6 15h12M12 9v12\"/><path d=\"M12 3v6\"/>","church":"<path d=\"M10 9h4\"/><path d=\"M12 7v5\"/><path d=\"M14 22v-4a2 2 0 0 0-4 0v4\"/><path d=\"M18 22V5.618a1 1 0 0 0-.553-.894l-4.553-2.277a2 2 0 0 0-1.788 0L6.553 4.724A1 1 0 0 0 6 5.618V22\"/><path d=\"m18 7 3.447 1.724a1 1 0 0 1 .553.894V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.618a1 1 0 0 1 .553-.894L6 7\"/>","coffee":"<path d=\"M10 2v2\"/><path d=\"M14 2v2\"/><path d=\"M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1\"/><path d=\"M6 2v2\"/>","croissant":"<path d=\"m4.6 13.11 5.79-3.21c1.89-1.05 4.79 1.78 3.71 3.71l-3.22 5.81C8.8 23.16.79 15.23 4.6 13.11Z\"/><path d=\"m10.5 9.5-1-2.29C9.2 6.48 8.8 6 8 6H4.5C2.79 6 2 6.5 2 8.5a7.71 7.71 0 0 0 2 4.83\"/><path d=\"M8 6c0-1.55.24-4-2-4-2 0-2.5 2.17-2.5 4\"/><path d=\"m14.5 13.5 2.29 1c.73.3 1.21.7 1.21 1.5v3.5c0 1.71-.5 2.5-2.5 2.5a7.71 7.71 0 0 1-4.83-2\"/><path d=\"M18 16c1.55 0 4-.24 4 2 0 2-2.17 2.5-4 2.5\"/>","curry":"<path d=\"M2.5 15.5c0 2.2 4.3 4 9.5 4s9.5-1.8 9.5-4\"/><path d=\"M4.5 15.5c1-3.6 4-6 7.5-6s6.5 2.4 7.5 6z\"/><path d=\"M8 5c-.8.8.8 1.6 0 2.5M12 4c-.8.8.8 1.6 0 2.5M16 5c-.8.8.8 1.6 0 2.5\"/><path d=\"M13 12.5c1.5.3 2.6 1.2 3 2.5\"/>","deer":"<path d=\"M9 11c0 3.5 1.3 7.3 3 9 1.7-1.7 3-5.5 3-9 0-2.2-1.3-3.5-3-3.5S9 8.8 9 11z\"/><path d=\"M10.3 7.8 7 3.5M7 3.5 4.8 4.5M7 3.5V1.8M8.6 5.6 6.3 6.2M13.7 7.8 17 3.5M17 3.5l2.2 1M17 3.5V1.8M15.4 5.6l2.3.6\"/><path d=\"M9.2 10 6.5 9.2M14.8 10l2.7-.8\"/><circle cx=\"12\" cy=\"18\" r=\".5\" fill=\"currentColor\"/>","distillery":"<path d=\"M5 7.5h14l-1.6 12a1.5 1.5 0 0 1-1.5 1.3H8.1a1.5 1.5 0 0 1-1.5-1.3z\"/><path d=\"M5.8 13.5h12.4\"/><rect x=\"8.5\" y=\"9.5\" width=\"4\" height=\"4\" rx=\".6\" transform=\"rotate(-12 10.5 11.5)\"/><path d=\"M13.5 16.5h1.5\"/>","drama":"<path d=\"M10 11h.01\"/><path d=\"M14 6h.01\"/><path d=\"M18 6h.01\"/><path d=\"M6.5 13.1h.01\"/><path d=\"M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3\"/><path d=\"M17.4 9.9c-.8.8-2 .8-2.8 0\"/><path d=\"M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7\"/><path d=\"M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4\"/>","droplets":"<path d=\"M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z\"/><path d=\"M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97\"/>","dumpling":"<path d=\"M3 15c1.2-5.2 5-8 9-8s7.8 2.8 9 8c-2.4 2.4-5.6 3.5-9 3.5S5.4 17.4 3 15z\"/><path d=\"M6 11.2c.6.4 1.3.4 1.8 0 .6.5 1.4.5 2 0 .6.5 1.4.5 2.2 0 .6.5 1.4.5 2 0 .6.5 1.4.5 2 0 .5.4 1.2.4 1.8 0\"/><path d=\"M9 7.8 9.6 10M12 7v3M15 7.8 14.4 10\"/>","fish":"<path d=\"M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z\"/><path d=\"M18 12v.5\"/><path d=\"M16 17.93a9.77 9.77 0 0 1 0-11.86\"/><path d=\"M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33\"/><path d=\"M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4\"/><path d=\"m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98\"/>","footprints":"<path d=\"M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z\"/><path d=\"M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z\"/><path d=\"M16 17h4\"/><path d=\"M4 13h4\"/>","gem":"<path d=\"M6 3h12l4 6-10 13L2 9Z\"/><path d=\"M11 3 8 9l4 13 4-13-3-6\"/><path d=\"M2 9h20\"/>","grill":"<path d=\"M5 10h14a7 7 0 0 1-14 0z\"/><path d=\"M8.5 16.5 6.5 21M15.5 16.5l2 4.5M12 17v4\"/><path d=\"M9 3c-.7.7.7 1.5 0 2.5M12 3c-.7.7.7 1.5 0 2.5M15 3c-.7.7.7 1.5 0 2.5\"/>","ice-cream-cone":"<path d=\"m7 11 4.08 10.35a1 1 0 0 0 1.84 0L17 11\"/><path d=\"M17 7A5 5 0 0 0 7 7\"/><path d=\"M17 7a2 2 0 0 1 0 4H7a2 2 0 0 1 0-4\"/>","info":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4\"/><path d=\"M12 8h.01\"/>","landmark":"<line x1=\"3\" x2=\"21\" y1=\"22\" y2=\"22\"/><line x1=\"6\" x2=\"6\" y1=\"18\" y2=\"11\"/><line x1=\"10\" x2=\"10\" y1=\"18\" y2=\"11\"/><line x1=\"14\" x2=\"14\" y1=\"18\" y2=\"11\"/><line x1=\"18\" x2=\"18\" y1=\"18\" y2=\"11\"/><polygon points=\"12 2 20 7 4 7\"/>","lighthouse":"<path d=\"M9 21 10.5 9h3L15 21z\"/><path d=\"M7.5 21h9\"/><path d=\"M10 9h4V5.5h-4zM9.5 5.5h5\"/><path d=\"M12 3.5v2\"/><path d=\"M3.5 5.5 7 7M20.5 5.5 17 7\"/><path d=\"M10 14h4M9.6 17.5h4.8\"/>","lobster":"<ellipse cx=\"12\" cy=\"13.5\" rx=\"3\" ry=\"5\"/><path d=\"M10.5 18.5 9.5 21M13.5 18.5l1 2.5M12 18.5V21\"/><path d=\"M10 10 6.5 6.5M14 10l3.5-3.5\"/><path d=\"M6.5 6.5c-2.2-.3-3.4 1.6-2.6 3 .5.8 1.8.8 2.6-.1M17.5 6.5c2.2-.3 3.4 1.6 2.6 3-.5.8-1.8.8-2.6-.1\"/><path d=\"M11 8.7 9.5 3M13 8.7 14.5 3M9.5 13h5M9.5 15.5h5\"/>","map-pin":"<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/>","market":"<path d=\"M3.5 9 5 4h14l1.5 5\"/><path d=\"M3.5 9c0 1.4 1.1 2.3 2.4 2.3S8.3 10.4 8.3 9c0 1.4 1.1 2.3 2.4 2.3S13.1 10.4 13.1 9c0 1.4 1.1 2.3 2.4 2.3s2.4-.9 2.4-2.3c0 1.4 1.1 2.3 2.4 2.3\"/><path d=\"M5 11.2V20h14v-8.8\"/><path d=\"M10 20v-5h4v5\"/>","martini":"<path d=\"M8 22h8\"/><path d=\"M12 11v11\"/><path d=\"m19 3-7 8-7-8Z\"/>","music":"<path d=\"M9 18V5l12-2v13\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><circle cx=\"18\" cy=\"16\" r=\"3\"/>","noodles":"<path d=\"M3 12h18c0 4-4 7-9 7s-9-3-9-7z\"/><path d=\"M9 19l-.5 2h7L15 19\"/><path d=\"M13.5 3 10 11M19.5 4 13 11\"/><path d=\"M6 12c0-1.5.8-2.5 1.6-1.5S8.8 12 9.6 11\"/>","onigiri":"<path d=\"M12 3.5c1 0 1.9.6 2.6 1.8l4.9 8.8c1 2-.3 4.4-2.6 4.4H7.1c-2.3 0-3.6-2.4-2.6-4.4l4.9-8.8C10.1 4.1 11 3.5 12 3.5z\"/><path d=\"M9 18.5V14h6v4.5\"/>","palette":"<circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><path d=\"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z\"/>","pancakes":"<ellipse cx=\"12\" cy=\"8\" rx=\"8\" ry=\"2.5\"/><path d=\"M4 8v2.5C4 11.9 7.6 13 12 13s8-1.1 8-2.5V8M4 10.5V13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-2.5M4 13v2.5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V13\"/><path d=\"M15 9.5v3.5M15 16v1.5\"/><path d=\"M9.5 5.2 11 3h2l1.5 2.2\"/>","pasta":"<ellipse cx=\"12\" cy=\"18\" rx=\"9\" ry=\"3\"/><path d=\"M4.5 17c.6-3.6 3.6-6 7.5-6s6.9 2.4 7.5 6\"/><path d=\"M8 15c1.3-1.2 2.7-1.2 4 0s2.7 1.2 4 0\"/><path d=\"M15.5 11V3M13.5 3v4a2 2 0 0 0 4 0V3\"/>","pill":"<path d=\"m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z\"/><path d=\"m8.5 8.5 7 7\"/>","pizza":"<path d=\"m12 14-1 1\"/><path d=\"m13.75 18.25-1.25 1.42\"/><path d=\"M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12\"/><path d=\"M18.8 9.3a1 1 0 0 0 2.1 7.7\"/><path d=\"M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z\"/>","plus":"<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>","ruins":"<path d=\"M3.5 8.5 10 5l4 2\"/><path d=\"M3.5 8.5h8.5\"/><path d=\"M5 8.5V18M8.5 8.5V18M12 8.5V18\"/><path d=\"M15.5 18v-6l.9-.9.8.9.9-1 .9.8V18\"/><path d=\"M18.5 21h2.5v-2h-2.5z\" transform=\"rotate(-8 19.7 20)\"/><path d=\"M2.5 18h17M2 21h15\"/>","sailboat":"<path d=\"M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4Z\"/><path d=\"M21 14 10 2 3 14h18Z\"/><path d=\"M10 2v16\"/>","salad":"<path d=\"M7 21h10\"/><path d=\"M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z\"/><path d=\"M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1\"/><path d=\"m13 12 4-4\"/><path d=\"M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2\"/>","sandwich":"<path d=\"m2.37 11.223 8.372-6.777a2 2 0 0 1 2.516 0l8.371 6.777\"/><path d=\"M21 15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-5.25\"/><path d=\"M3 15a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h9\"/><path d=\"m6.67 15 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2\"/><rect width=\"20\" height=\"4\" x=\"2\" y=\"11\" rx=\"1\"/>","scroll-text":"<path d=\"M15 12h-5\"/><path d=\"M15 8h-5\"/><path d=\"M19 17V5a2 2 0 0 0-2-2H4\"/><path d=\"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3\"/>","ship":"<path d=\"M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/><path d=\"M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76\"/><path d=\"M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6\"/><path d=\"M12 10v4\"/><path d=\"M12 2v3\"/>","shopping-bag":"<path d=\"M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z\"/><path d=\"M3 6h18\"/><path d=\"M16 10a4 4 0 0 1-8 0\"/>","shrimp":"<path d=\"M16.5 4.5C11 4.5 7 8.6 7 13.6c0 3 2 5.4 5 5.9\"/><path d=\"M16.5 8.5c-3.3 0-5.6 2.4-5.6 5.3 0 1.6.8 2.8 2 3.3\"/><path d=\"M16.5 4.5c1.9 0 3.3 1.3 3.3 2.9 0 .7-.4 1.1-1.1 1.1h-2.2\"/><path d=\"M19.5 5.5 22 3.5M19.7 7 22.5 7.6\"/><circle cx=\"17.6\" cy=\"6.2\" r=\".55\" fill=\"currentColor\"/><path d=\"M10.4 7.7 12.6 10M8.1 11.3l3.1.8M7.9 15.2l3.2-.9\"/><path d=\"M12.5 18.3 9.8 21.3M12.5 18.3l.3 3.2M12.5 18.3l2.9 2\"/><path d=\"M13.3 11.2l1.4 1.1M12.4 13.8l1.7.3\"/>","shuffle":"<path d=\"M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22\"/><path d=\"m18 2 4 4-4 4\"/><path d=\"M2 6h1.9c1.5 0 2.9.9 3.6 2.2\"/><path d=\"M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8\"/><path d=\"m18 14 4 4-4 4\"/>","sushi":"<rect x=\"4.5\" y=\"12.5\" width=\"15\" height=\"6.5\" rx=\"3\"/><path d=\"M3 12.2c0-1.9 1.4-3.3 3.3-3.6l11.2-1.5c2-.3 3.5 1.2 3.5 3.1v.6c0 .8-.6 1.4-1.4 1.4H4.4c-.8 0-1.4-.6-1.4-1.3z\"/><path d=\"M8.3 8.3 9.6 12.2M12.2 7.8l1.3 4.4M16.1 7.3l1.3 4.9\"/><path d=\"M8 16h.01M11 17h.01M14.5 16h.01\" stroke-width=\"2\"/>","taco":"<path d=\"M3 18.5h18a9 9 0 0 0-18 0z\"/><path d=\"M4.6 12.4c-.4-1.5.6-2.7 1.9-2.6.2-1.5 1.8-2.3 3.1-1.6.7-1.3 2.6-1.5 3.6-.4 1-1 2.9-.7 3.4.7 1.3-.1 2.4 1 2.2 2.3 1.1.4 1.6 1.6 1.1 2.6\"/><circle cx=\"9\" cy=\"8.6\" r=\"1.3\"/><circle cx=\"15.2\" cy=\"8.8\" r=\"1.3\"/>","ticket":"<path d=\"M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z\"/><path d=\"M13 5v2\"/><path d=\"M13 17v2\"/><path d=\"M13 11v2\"/>","tower":"<path d=\"M8 21 11 9h2l3 12\"/><path d=\"M7 9h10l-1.3-3.5H8.3z\"/><path d=\"M12 5.5V2.5\"/><path d=\"M9.8 14h4.4M9 17.5h6\"/>","trees":"<path d=\"M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z\"/><path d=\"M7 16v6\"/><path d=\"M13 19v3\"/><path d=\"M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5\"/>","users":"<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/>","utensils":"<path d=\"M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2\"/><path d=\"M7 2v20\"/><path d=\"M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7\"/>","walker":"<circle cx=\"13\" cy=\"4.5\" r=\"1.8\"/><path d=\"m9 21 2.5-6.5 2.5 2V21\"/><path d=\"M11.5 14.5 12.5 8l-3 2L8 13\"/><path d=\"m12.5 8 2.5 3.5 2.5 1\"/>","waves":"<path d=\"M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/><path d=\"M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/><path d=\"M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/>","wifi":"<path d=\"M12 20h.01\"/><path d=\"M2 8.82a15 15 0 0 1 20 0\"/><path d=\"M5 12.859a10 10 0 0 1 14 0\"/><path d=\"M8.5 16.429a5 5 0 0 1 7 0\"/>","wine":"<path d=\"M8 22h8\"/><path d=\"M7 10h10\"/><path d=\"M12 15v7\"/><path d=\"M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z\"/>"};
const LINE_ICON_BY_EMOJI = {"🦞":"lobster","🍤":"shrimp","🐟":"fish","🍣":"sushi","🍙":"onigiri","🍜":"noodles","🥟":"dumpling","🍛":"curry","🌮":"taco","🍝":"pasta","🍕":"pizza","🍔":"burger","🍖":"grill","🥗":"salad","🥪":"sandwich","🥞":"pancakes","🥐":"croissant","🍰":"cake-slice","🍦":"ice-cream-cone","☕":"coffee","🍷":"wine","🍸":"martini","🍺":"beer","🍽️":"utensils","🏛️":"landmark","⛪":"church","🏰":"castle","🗼":"tower","🎨":"palette","🎭":"drama","🎵":"music","🍁":"scroll-text","📷":"camera","🎟️":"ticket","👨‍👩‍👧":"users","🚢":"ship","🌿":"trees","🏖️":"beach","🌊":"waves","💧":"droplets","🔭":"binoculars","🥾":"footprints","🚶":"walker","🐦":"bird","🦌":"deer","🛍️":"shopping-bag","🛒":"market","ℹ️":"info","📍":"map-pin","⛴️":"ship","⛵":"sailboat","📚":"book-open","🍫":"chocolate","🧀":"cheese","🥃":"distillery","🚲":"bike","🚌":"bus","🚕":"car-taxi-front","💊":"pill","🏧":"banknote","📶":"wifi","🏺":"ruins","🐠":"aquarium","🪦":"cemetery"};
function lineIconSvg(name, className = 'line-icon') {
  const shape = LINE_ICON_SHAPES[name] || LINE_ICON_SHAPES['map-pin'];
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}
function placeLineIcon(place, className) {
  return lineIconSvg(LINE_ICON_BY_EMOJI[resolveIcon(place)] || 'map-pin', className);
}

export { resolveIcon, lineIconSvg, placeLineIcon };
