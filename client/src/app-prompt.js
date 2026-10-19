(() => {
  const script = document.currentScript;
  const name = script?.dataset.appName;
  const destination = script?.dataset.playUrl;
  if (!name || !destination || !/Android/i.test(navigator.userAgent) || !matchMedia('(max-width: 800px)').matches || matchMedia('(display-mode: standalone)').matches || window.Capacitor?.isNativePlatform?.()) return;
  let url;
  try { url = new URL(destination); } catch { return; }
  if (url.origin !== 'https://play.google.com' || url.pathname !== '/store/apps/details' || !url.searchParams.get('id')) return;
  const storageKey = 'play-prompt-dismissed:' + url.searchParams.get('id');
  try { if (Date.now() - Number(localStorage.getItem(storageKey) || 0) < 7 * 86400000) return; } catch {}
  const show = () => {
    const host = document.createElement('aside');
    host.dataset.appPrompt = '';
    host.style.cssText = 'position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));max-width:440px;margin:auto;z-index:10000;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{font-family:inherit}section{background:#161b22;color:#e6edf3;border:1px solid #48515d;border-radius:12px;padding:20px;box-shadow:0 8px 32px #0006;font-size:15px;line-height:1.5}p{margin:0 0 16px}strong{display:block;font-size:18px;margin-bottom:6px}a,button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-height:44px;width:100%;border-radius:6px;padding:10px 14px;font:inherit;font-weight:600;cursor:pointer}a{background:#58a6ff;color:#0d1117;text-decoration:none}button{background:transparent;border:1px solid #48515d;color:inherit;margin-top:10px}:focus-visible{outline:2px solid #58a6ff;outline-offset:3px}';
    const section = document.createElement('section');
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-label', name + ' Android app');
    const title = document.createElement('strong');
    title.textContent = name + ' is better in the app';
    const text = document.createElement('p');
    text.textContent = 'Get the Android app on Google Play.';
    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = 'Get the app';
    const dismiss = () => {
      try { localStorage.setItem(storageKey, String(Date.now())); } catch {}
      host.remove();
    };
    link.addEventListener('click', dismiss);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Continue in browser';
    close.addEventListener('click', dismiss);
    section.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
    section.append(title, text, link, close);
    shadow.append(style, section);
    document.body.append(host);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
})();
