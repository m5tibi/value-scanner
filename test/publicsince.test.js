import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicSince, loadConfig } from '../src/config.js';
import { publicSinceSql } from '../src/db.js';

test('PUBLIC_SINCE: üres vagy hibás érték -> nincs szűrés', () => {
  assert.equal(parsePublicSince(undefined), null);
  assert.equal(parsePublicSince(''), null);
  assert.equal(parsePublicSince('holnap'), null);
  assert.equal(loadConfig({}).publicSince, null);
  assert.equal(publicSinceSql(null), '');
  assert.equal(publicSinceSql('nem dátum'), '');
});

test('PUBLIC_SINCE: budapesti helyi idő (téli és nyári időszámítás)', () => {
  assert.equal(parsePublicSince('2026-11-26').toISOString(), '2026-11-25T23:00:00.000Z');
  assert.equal(parsePublicSince('2026-11-26 08:00').toISOString(), '2026-11-26T07:00:00.000Z');
  assert.equal(parsePublicSince('2026-07-01T08:30').toISOString(), '2026-07-01T06:30:00.000Z');
});

test('PUBLIC_SINCE: időzónás ISO-idő változatlanul', () => {
  assert.equal(parsePublicSince('2026-11-26T08:00:00+01:00').toISOString(), '2026-11-26T07:00:00.000Z');
  assert.equal(parsePublicSince('2026-11-26T07:00:00Z').toISOString(), '2026-11-26T07:00:00.000Z');
  assert.equal(loadConfig({ PUBLIC_SINCE: '2026-11-26 08:00  # indulás' }).publicSince.toISOString(), '2026-11-26T07:00:00.000Z');
});

test('PUBLIC_SINCE: SQL-feltétel csak ISO-literállal', () => {
  assert.equal(publicSinceSql(new Date('2026-11-26T07:00:00Z')), " and public_posted_at >= '2026-11-26T07:00:00.000Z'::timestamptz");
});
