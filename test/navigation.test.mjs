import test from 'node:test';
import assert from 'node:assert/strict';
import { initialTab } from '../src/lib/navigation.js';

test('opens sales on phone-sized screens and retains the desktop homepage', () => {
  assert.equal(initialTab(320), 'chat');
  assert.equal(initialTab(390), 'chat');
  assert.equal(initialTab(600), 'chat');
  assert.equal(initialTab(601), 'home');
  assert.equal(initialTab(1280), 'home');
});
