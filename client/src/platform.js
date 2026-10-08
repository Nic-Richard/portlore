// The app serves the client from the phone, but uses the same live API and Capacitor bridge.
export const NATIVE_APP = !!window.Capacitor?.isNativePlatform?.();
export const API_ORIGIN = NATIVE_APP ? 'https://portlore.com' : '';
export const nativePlugin = name => (NATIVE_APP ? window.Capacitor.Plugins?.[name] || null : null);

if (NATIVE_APP && window.CapacitorWebFetch) {
  const nativeFetch = window.fetch;
  // Android's HTTP proxy fails on non-zero map ranges; nginx allows direct map requests.
  window.fetch = (resource, options) => {
    const url = typeof resource === 'string' ? resource : resource.url || resource.href;
    return url.startsWith(`${API_ORIGIN}/maps/`)
      ? window.CapacitorWebFetch(resource, options)
      : nativeFetch(resource, options);
  };
}
