import crypto from 'node:crypto';

class ActionError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
function parseAction(raw, headers, secret, now = Date.now()) {
  if (!secret || secret.length < 32) throw new ActionError('Moderation is not configured', 503);
  const timestamp = headers['x-action-timestamp'];
  const signature = headers['x-action-signature'];
  if (!Buffer.isBuffer(raw) || raw.length > 65536 || !/^\d{1,12}$/.test(timestamp || '') || !/^[a-f0-9]{64}$/.test(signature || '') || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new ActionError('Invalid action signature', 401);
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new ActionError('Invalid action signature', 401);
  let data;
  try { data = JSON.parse(raw); } catch { throw new ActionError('Invalid action JSON', 400); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !['inspect', 'resolve', 'dismiss', 'blacklist', 'remove', 'reopen', 'unblock', 'ban', 'unban'].includes(data.action) || !/^[a-f0-9-]{36}$/i.test(data.requestId || '') || typeof data.target?.id !== 'string' || data.target.id.length > 80 || typeof data.target.kind !== 'string') throw new ActionError('Invalid action request', 400);
  const actor = data.actor;
  if (data.action === 'inspect' && actor?.id === 'system') return data;
  let permitted = false;
  try { permitted = /^\d{1,30}$/.test(actor?.permissions || '') && (BigInt(actor.permissions) & ((1n << 3n) | (1n << 40n))) !== 0n; } catch {}
  if (!permitted || !/^\d{1,20}$/.test(actor?.id || '') || typeof actor.name !== 'string' || actor.name.length > 100) throw new ActionError('Moderator permission is required', 403);
  if (data.action !== 'inspect' && (typeof data.expectedVersion !== 'string' || data.expectedVersion.length > 200)) throw new ActionError('Review the current report first', 400);
  return data;
}
function actionHandler(execute) {
  return async (req, res) => {
    try {
      const data = parseAction(req.body, req.headers, process.env.ALERTS_ACTION_SECRET);
      return res.json(await execute(data));
    } catch (error) {
      const status = error instanceof ActionError ? error.status : 500;
      return res.status(status).json({ ok: false, error: status === 500 ? 'Could not complete the moderation action' : error.message });
    }
  };
}
export { parseAction, actionHandler, ActionError };
