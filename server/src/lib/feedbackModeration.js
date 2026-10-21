import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ActionError } from './moderationAuth.js';

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function publish(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.linkSync(temp, file); return true; }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  } finally { fs.rmSync(temp, { force: true }); }
}
export function createFeedbackModeration(directory) {
  return data => {
    if (data.target.kind !== 'feedback' || !/^[a-f0-9-]{36}$/i.test(data.target.id)) throw new ActionError('Invalid feedback target', 400);
    const root = path.join(directory, '.feedback-moderation');
    const claimFile = path.join(root, 'requests', `${data.requestId.toLowerCase()}.json`);
    const decisions = path.join(root, 'decisions', data.target.id.toLowerCase());
    const claim = read(claimFile);
    if (claim && (claim.target !== data.target.id || claim.action !== data.action)) throw new ActionError('That request belongs to another action');
    let reports;
    try { reports = fs.readFileSync(path.join(directory, '.feedback.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') reports = []; else throw error; }
    const report = reports.find(row => row.id === data.target.id);
    if (!report) throw new ActionError('Feedback is no longer available', 404);
    let decision = null, revision = 0;
    for (;;) {
      const next = read(path.join(decisions, `${revision + 1}.json`));
      if (!next) break;
      revision++;
      if (next.requestId === data.requestId) return next.result;
      decision = next;
    }
    const status = decision?.result.status || 'open';
    const version = createHash('sha256').update(JSON.stringify(report) + ':' + status + ':' + revision).digest('hex');
    const state = { ok: true, status, version, title: `${report.kind} feedback${report.port ? ': ' + report.port : ''}`, summary: report.message.slice(0, 1000), actions: status === 'open' ? ['resolve', 'dismiss'] : ['reopen'], confirmations: { reopen: 'Reopen this feedback for review. Previous decisions remain in the audit history.' }, actor: decision?.result.actor || null, references: [report.id] };
    if (data.action === 'inspect') return state;
    if (status !== 'open' && !state.actions.includes(data.action)) return { ...state, changed: false, summary: 'This feedback was already handled' };
    if (state.version !== data.expectedVersion || !state.actions.includes(data.action)) throw new ActionError('Feedback changed; review it again');
    // The intent binds retries; the exclusive, complete decision file is the authoritative outcome.
    if (!claim) {
      publish(claimFile, { requestId: data.requestId, target: report.id, action: data.action });
      const bound = read(claimFile);
      if (bound.target !== report.id || bound.action !== data.action) throw new ActionError('That request belongs to another action');
    }
    const result = { ok: true, changed: true, status: data.action === 'reopen' ? 'open' : data.action === 'dismiss' ? 'dismissed' : 'resolved', summary: `Feedback ${data.action === 'reopen' ? 'reopened' : data.action === 'dismiss' ? 'dismissed' : 'resolved'}`, actor: data.actor, requestId: data.requestId, at: Date.now() };
    result.version = createHash('sha256').update(JSON.stringify(report) + ':' + result.status + ':' + (revision + 1)).digest('hex');
    result.actions = result.status === 'open' ? ['resolve', 'dismiss'] : ['reopen'];
    const decisionFile = path.join(decisions, `${revision + 1}.json`);
    if (!publish(decisionFile, { requestId: data.requestId, target: report.id, action: data.action, result })) {
      const existing = read(decisionFile);
      return existing.requestId === data.requestId ? existing.result : { ...existing.result, changed: false };
    }
    return result;
  };
}
