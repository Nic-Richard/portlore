(() => {
  const script = document.currentScript;
  const name = script?.dataset.appName;
  const destination = script?.dataset.playUrl;
  const preview = new URL(window.location.href).searchParams.get('app-prompt') === 'preview';
  if (
    !name ||
    (!destination && !preview) ||
    (!preview && !/Android/i.test(navigator.userAgent)) ||
    (!preview && !matchMedia('(max-width: 800px)').matches) ||
    (!preview && matchMedia('(display-mode: standalone)').matches) ||
    window.Capacitor?.isNativePlatform?.()
  ) return;
  let url;
  try { url = destination ? new URL(destination) : null; } catch { return; }
  if (url && (url.origin !== 'https://play.google.com' || url.pathname !== '/store/apps/details' || !url.searchParams.get('id'))) return;
  const storageKey = 'play-prompt-dismissed:' + (url?.searchParams.get('id') || name);
  try {
    if (!preview && Date.now() - Number(localStorage.getItem(storageKey) || 0) < 3 * 86400000) return;
  } catch {}
  const show = () => {
    if (document.querySelector('[data-app-prompt]')) return;
    const host = document.createElement('aside');
    host.dataset.appPrompt = '';
    host.dataset.theme = script?.dataset.appTheme || document.documentElement.dataset.theme || '';
    host.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));max-width:480px;margin:auto;z-index:10000;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host{font-family:inherit;--bg:#fff;--ink:#192331;--muted:#657083;--line:#dce1e8;--button:#17263c;--button-ink:#fff}
      @media(prefers-color-scheme:dark){:host{--bg:#161b22;--ink:#e6edf3;--muted:#a3adba;--line:#394351;--button:#e6edf3;--button-ink:#16202b}}
      :host([data-theme="light"]){--bg:#fff;--ink:#192331;--muted:#657083;--line:#dce1e8;--button:#17263c;--button-ink:#fff}
      :host([data-theme="dark"]){--bg:#161b22;--ink:#e6edf3;--muted:#a3adba;--line:#394351;--button:#e6edf3;--button-ink:#16202b}
      *{box-sizing:border-box}
      section{display:grid;grid-template-columns:40px minmax(0,1fr) auto 36px;align-items:center;gap:8px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:10px;box-shadow:0 6px 24px #0002}
      img{display:block;width:40px;height:40px;border-radius:10px;object-fit:contain}
      .copy{min-width:0}strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:650;letter-spacing:-.01em}
      p{margin:0;color:var(--muted);font-size:12px;line-height:17px}
      a,button{font:inherit;-webkit-tap-highlight-color:transparent}
      a{display:flex;align-items:center;justify-content:center;min-height:44px;padding:0 13px;background:var(--button);color:var(--button-ink);border-radius:9px;font-size:13px;font-weight:650;text-decoration:none;white-space:nowrap}
      a[aria-disabled="true"]{cursor:default}
      button{display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin-left:-4px;border:0;border-radius:9px;padding:0;background:transparent;color:var(--muted);cursor:pointer}
      button:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
      :focus-visible{outline:2px solid var(--ink);outline-offset:3px}
    `;
    const section = document.createElement('section');
    section.setAttribute('role', 'region');
    section.setAttribute('aria-label', name + ' Android app');
    const icon = document.createElement('img');
    icon.src = script?.dataset.appIcon || (name === 'Miscellary' ? '/icon.svg' : '/icon-192.png');
    icon.alt = '';
    icon.width = 40;
    icon.height = 40;
    const copy = document.createElement('div');
    copy.className = 'copy';
    const title = document.createElement('strong');
    title.textContent = name;
    const text = document.createElement('p');
    text.textContent = 'Better in the app';
    copy.append(title, text);
    const link = document.createElement('a');
    link.textContent = 'Get app';
    if (url) link.href = url.href;
    else { link.setAttribute('aria-disabled', 'true'); link.tabIndex = -1; }
    const dismiss = () => {
      try { if (!preview) localStorage.setItem(storageKey, String(Date.now())); } catch {}
      host.remove();
    };
    if (url) link.addEventListener('click', dismiss);
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss app banner');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    for (const [key, value] of Object.entries({ d: 'm4 4 8 8M12 4l-8 8', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round' })) path.setAttribute(key, value);
    svg.append(path);
    close.append(svg);
    close.addEventListener('click', dismiss);
    section.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
    section.append(icon, copy, link, close);
    shadow.append(style, section);
    document.body.append(host);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
})();
