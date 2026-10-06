const OSM_DAYS=['Su','Mo','Tu','We','Th','Fr','Sa'];
function osmDayListIncludes(list,day){
  return list.split(',').some(part=>{
    const [from,to]=part.split('-').map(d=>OSM_DAYS.indexOf(d));
    if(from<0)return false;
    if(to===undefined)return from===day;
    return from<=to ? day>=from&&day<=to : day>=from||day<=to;
  });
}
function osmTime(value){
  const [h,m]=value.split(':').map(Number);
  const hour=h%24;
  return `${hour%12||12}:${String(m).padStart(2,'0')} ${hour<12?'AM':'PM'}`;
}
// OpenStreetMap hours read like "Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off". Later rules override earlier
// ones for the days they name. Anything beyond the common forms (holidays, months) returns null.
function osmTodaysHours(hours, date = new Date()){
  const text=String(hours||'').trim().replace(/;$/,'');
  if(!text)return '';
  if(text==='24/7')return 'Open 24 hours';
  const day=date.getDay();
  let today='';
  for(const rule of text.split(/\s*;\s*/)){
    const m=rule.match(/^(?:((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*) )?(off|closed|\d\d:\d\d-\d\d:\d\d(?:,\d\d:\d\d-\d\d:\d\d)*)$/);
    if(!m)return null;
    if(m[1]&&!osmDayListIncludes(m[1],day))continue;
    today=/^(off|closed)$/.test(m[2])
      ? 'Closed'
      : m[2].split(',').map(range=>range.split('-').map(osmTime).join(' – ')).join(', ');
  }
  // Days no rule names are closed.
  return today||'Closed';
}
// Hours are either Google's older "Monday: 9:00 AM – 5:00 PM · Tuesday: ..." or OpenStreetMap's syntax.
function todaysHours(hours, date = new Date()){
  const today=date.toLocaleDateString('en-US',{weekday:'long'});
  const entry=String(hours||'').split(/\s*·\s*/).find(part=>part.startsWith(`${today}:`));
  if(entry)return entry.slice(today.length+1).trim();
  return osmTodaysHours(hours, date)||'';
}
function escapeText(value){
  return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function closingMinutes(todayText){
  const times=[...String(todayText).matchAll(/(\d{1,2}):(\d{2})\s*([AP]M)/gi)];
  if(times.length<2)return null;
  const [,h,m,ap]=times[times.length-1];
  return (Number(h)%12+(ap.toUpperCase()==='PM'?12:0))*60+Number(m);
}
function clockLabel(mins){
  const d=new Date();d.setHours(0,mins,0,0);
  return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
}

export { todaysHours, escapeText, closingMinutes, clockLabel };
