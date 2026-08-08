const DEBUG_PORTLORE = process.env.DEBUG_PORTLORE === '1';

export function debug(...args) {
  if (DEBUG_PORTLORE) console.log(...args);
}

export function info(...args) {
  console.log(...args);
}

export function warn(...args) {
  console.warn(...args);
}

export function error(...args) {
  console.error(...args);
}
