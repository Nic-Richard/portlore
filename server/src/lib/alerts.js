const APP = 'portlore';

// Posts to the Discord alerts relay. Never throws and never delays the caller.
export function sendAlert(type, alert) {
  const { ALERTS_URL, ALERTS_SECRET } = process.env;
  if (!ALERTS_URL || !ALERTS_SECRET) return;
  fetch(ALERTS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ALERTS_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: APP, type, ...alert }),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => console.warn('alert not sent:', err.message));
}

export function errorAlert(args) {
  const title = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 200);
  const err = args.find((a) => a instanceof Error);
  sendAlert('errors', {
    title,
    key: typeof args[0] === 'string' ? args[0] : title,
    description: err?.stack ? '```\n' + err.stack.slice(0, 3000) + '\n```' : '',
  });
}
