// The app serves the client from the phone, but uses the same live API and Capacitor bridge.
export const NATIVE_APP = !!window.Capacitor?.isNativePlatform?.();
export const API_ORIGIN = NATIVE_APP ? 'https://portlore.com' : '';
export const nativePlugin = name => (NATIVE_APP ? window.Capacitor.Plugins?.[name] || null : null);
