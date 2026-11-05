import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNotifier } from '../src/telegram.js';

const quiet = { log() {}, sleep: async () => {} };

test('hálózati hiba után újrapróbál, és elküldi', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; if (n < 3) throw new TypeError('fetch failed'); return new Response('{"ok":true}', { status: 200 }); };
  const notify = makeNotifier({ token: 't', chatId: 'c', fetchImpl, ...quiet });
  assert.equal(await notify('szia'), true);
  assert.equal(n, 3);
});

test('429-nél a Telegram retry_after értékét várja ki', async () => {
  const waits = [];
  let n = 0;
  const fetchImpl = async () => (++n === 1
    ? new Response('{"ok":false,"parameters":{"retry_after":7}}', { status: 429 })
    : new Response('{"ok":true}', { status: 200 }));
  const notify = makeNotifier({ token: 't', chatId: 'c', fetchImpl, log() {}, sleep: async (ms) => { waits.push(ms); } });
  assert.equal(await notify('x'), true);
  assert.deepEqual(waits, [7000]);
});

test('400-as hibánál (pl. hibás HTML) nem próbál újra; tartós hibánál feladja', async () => {
  let n = 0;
  const bad = makeNotifier({ token: 't', chatId: 'c', fetchImpl: async () => { n++; return new Response('{"ok":false}', { status: 400 }); }, ...quiet });
  assert.equal(await bad('x'), false);
  assert.equal(n, 1);
  let m = 0;
  const down = makeNotifier({ token: 't', chatId: 'c', fetchImpl: async () => { m++; throw new TypeError('fetch failed'); }, ...quiet });
  assert.equal(await down('x'), false);
  assert.equal(m, 4); // 1 + 3 újrapróbálkozás
});
