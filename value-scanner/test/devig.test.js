import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devig, margin } from '../src/devig.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);

test('multiplicative: valószínűségek összege 1, arányok megmaradnak', () => {
  const p = devig([1.9, 1.9], 'multiplicative');
  assert.ok(Math.abs(sum(p) - 1) < 1e-12);
  assert.ok(Math.abs(p[0] - 0.5) < 1e-12);
});

test('power: összeg 1, és a favorit valószínűsége nagyobb, mint multiplikatívnál', () => {
  const odds = [1.25, 4.2];
  const pw = devig(odds, 'power');
  const mu = devig(odds, 'multiplicative');
  assert.ok(Math.abs(sum(pw) - 1) < 1e-9);
  assert.ok(pw[0] > mu[0]);
});

test('power: háromesélyes piac (1X2)', () => {
  const p = devig([2.1, 3.4, 3.6], 'power');
  assert.equal(p.length, 3);
  assert.ok(Math.abs(sum(p) - 1) < 1e-9);
  assert.ok(p[0] > p[1] && p[1] > p[2]);
});

test('árrés számítás', () => {
  assert.ok(Math.abs(margin([1.95, 1.95]) - (2 / 1.95 - 1)) < 1e-12);
});

test('érvénytelen bemenet hibát dob', () => {
  assert.throws(() => devig([1.9]));
  assert.throws(() => devig([1.9, 0.9]));
});
