export const isDesktop = () => window.innerWidth >= 900;

export function createScreens(state, { initDesktopMap, initMobileMap }) {
  function fitWelcomeHero() {
    const root = document.documentElement.style;
    if (isDesktop()) return root.removeProperty('--w-hero-h');
    root.setProperty('--w-hero-h', `${document.querySelector('.w-card').offsetTop}px`);
  }
  const welcomeResize = new ResizeObserver(fitWelcomeHero);
  welcomeResize.observe(document.querySelector('.w-card'));
  welcomeResize.observe(document.querySelector('.w-hero'));
  window.addEventListener('resize', fitWelcomeHero);
  // The status bar inset arrives later as padding, which a content-box observer would miss.
  new ResizeObserver(([entry]) => {
    if (entry.target.offsetHeight) document.documentElement.style.setProperty('--topbar-h', `${entry.target.offsetHeight}px`);
  }).observe(document.getElementById('topbar'), { box: 'border-box' });
  document.querySelectorAll('.nav-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
      if(tab.dataset.tab==='map')setTimeout(()=>{if(!state.mReady)initMobileMap();else state.mMap.invalidateSize();},50);
    });
  });
  function applyDesktopTabs(){const t=document.querySelector('[data-tab="map"]');if(t)t.style.display=isDesktop()?'none':'';}
  applyDesktopTabs();
  window.addEventListener('resize',applyDesktopTabs);
  // Rotating can cross the 900 px breakpoint, which swaps the Map tab and page scroll for the side map and a
  // scrolling list column, so the maps, tabs and scroll position are carried across.
  let listAnchor=null,anchorQueued=false;
  function guideScrollLine(){return document.querySelector('#page-explore .nav-tabs').getBoundingClientRect().bottom+4;}
  function rememberListAnchor(){
    anchorQueued=false;
    if(!document.getElementById('page-explore').classList.contains('active'))return;
    const col=document.querySelector('#page-explore .app-col').getBoundingClientRect();
    const line=guideScrollLine();
    const el=document.elementFromPoint(col.left+col.width/2,line);
    listAnchor=el?.closest('.tab-panel')?{el,top:el.getBoundingClientRect().top-line}:null;
  }
  function queueListAnchor(){if(!anchorQueued){anchorQueued=true;requestAnimationFrame(rememberListAnchor);}}
  window.addEventListener('scroll',queueListAnchor,{passive:true});
  document.querySelector('#page-explore .app-col').addEventListener('scroll',queueListAnchor,{passive:true});
  let guideWidth=innerWidth,guideDesktop=isDesktop(),mapTabBeforeWide=false;
  // Only width changes: the keyboard opening changes the height, and the browser handles that itself.
  window.addEventListener('resize',()=>{
    if(innerWidth===guideWidth)return;
    guideWidth=innerWidth;
    const anchor=listAnchor;
    const crossed=isDesktop()!==guideDesktop;
    guideDesktop=isDesktop();
    if(crossed&&state.exploreBooted&&state.city){
      if(guideDesktop){
        mapTabBeforeWide=document.getElementById('tab-map').classList.contains('active');
        if(mapTabBeforeWide)document.querySelector('[data-tab="explore"]').click();
        if(state.dReady)state.dMap.invalidateSize();else initDesktopMap();
      }else if(mapTabBeforeWide)document.querySelector('[data-tab="map"]').click();
    }
    requestAnimationFrame(()=>{
      if(!anchor?.el.isConnected||!anchor.el.offsetParent)return;
      const delta=anchor.el.getBoundingClientRect().top-guideScrollLine()-anchor.top;
      if(isDesktop())document.querySelector('#page-explore .app-col').scrollTop+=delta;else window.scrollBy(0,delta);
      listAnchor=anchor;
    });
  });
}
