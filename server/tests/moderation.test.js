import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createFeedbackModeration } from '../src/lib/feedbackModeration.js';
import { parseAction } from '../src/lib/moderationAuth.js';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portlore-moderation-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(directory, '.feedback.jsonl'), JSON.stringify({ id, kind: 'bug', message: 'The guide needs a correction', port: 'Port', createdAt: new Date().toISOString() }) + '\n');
  const data = { action: 'inspect', target: { kind: 'feedback', id }, requestId: crypto.randomUUID(), actor: { id: '123', name: 'Moderator', permissions: '8' } };
  return { directory, data, execute: createFeedbackModeration(directory) };
}

test('feedback decisions persist, replay safely and never rewrite the original report', t => {
  const { directory, data, execute } = fixture(t);const original = fs.readFileSync(path.join(directory, '.feedback.jsonl'), 'utf8');
  const state = execute(data);const decision = { ...data, action: 'resolve', expectedVersion: state.version };
  const result = execute(decision);assert.equal(result.status, 'resolved');
  assert.deepEqual(createFeedbackModeration(directory)(decision), result);
  assert.equal(fs.readdirSync(path.join(directory, '.feedback-moderation', 'decisions')).length, 1);
  assert.equal(fs.readFileSync(path.join(directory, '.feedback.jsonl'), 'utf8'), original);
  assert.throws(() => execute({ ...decision, action: 'dismiss' }), /another action/);
  assert.equal(execute({ ...decision, requestId: crypto.randomUUID(), action: 'dismiss' }).changed, false);
});

test('stale, deleted and traversal targets cannot be actioned', t => {
  const { directory, data, execute } = fixture(t);
  assert.throws(() => execute({ ...data, action: 'resolve', expectedVersion: 'stale' }), /changed/);
  assert.throws(() => execute({ ...data, target: { kind: 'feedback', id: '../outside' } }), /Invalid/);
  fs.writeFileSync(path.join(directory, '.feedback.jsonl'), '');
  assert.throws(() => execute(data), /no longer available/);
});

test('callback authentication refuses tampering and non-moderators', () => {
  const secret = 's'.repeat(40);const timestamp = String(Math.floor(Date.now() / 1000));
  const data = { action: 'inspect', target: { kind: 'feedback', id: crypto.randomUUID() }, requestId: crypto.randomUUID(), actor: { id: '123', name: 'Moderator', permissions: '8' } };
  const raw = Buffer.from(JSON.stringify(data));const headers = { 'x-action-timestamp': timestamp, 'x-action-signature': crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex') };
  assert.equal(parseAction(raw, headers, secret).actor.id, '123');
  assert.throws(() => parseAction(Buffer.from('{}'), headers, secret), /signature/);
  assert.throws(() => parseAction(raw, headers, 'x'.repeat(40)), /signature/);
  data.actor.permissions = '0';const denied = Buffer.from(JSON.stringify(data));headers['x-action-signature'] = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(denied).digest('hex');
  assert.throws(() => parseAction(denied, headers, secret), /permission/);
});

test('reopened feedback retains immutable receipts and rejects stale decisions from earlier cycles', t => {
  const { execute, data, directory } = fixture(t);
  const initial = execute(data);
  const close = { ...data, action: 'dismiss', expectedVersion: initial.version };
  const closed = execute(close);
  const reopen = { ...data, requestId: crypto.randomUUID(), action: 'reopen', expectedVersion: closed.version };
  const reopened = execute(reopen);
  assert.equal(reopened.status, 'open');
  assert.notEqual(reopened.version, initial.version);
  assert.deepEqual(createFeedbackModeration(directory)(close), closed);
  assert.deepEqual(execute(reopen), reopened);
  assert.equal(execute({ ...data, requestId: crypto.randomUUID() }).status, 'open');
  assert.throws(() => execute({ ...close, requestId: crypto.randomUUID() }), /changed/);
  assert.equal(execute({ ...close, requestId: crypto.randomUUID(), expectedVersion: reopened.version }).status, 'dismissed');
  assert.equal(fs.readdirSync(path.join(directory, '.feedback-moderation', 'decisions', data.target.id)).length, 3);
});
