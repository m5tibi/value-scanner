// Próba: elérhető-e a TippmixPro oddsforrása erről a gépről (pl. Render Shell). Futtatás: node src/tippmix/probe.js
import { connectTmp, topics, parseRecords } from './client.js';

const t0 = Date.now();
try {
  const c = await connectTmp();
  console.log(`✅ Kapcsolódva (${Date.now() - t0} ms)`);
  const s = await c.call('/sports#getSessionInfo', { lang: 'hu' });
  console.log(`   A TippmixPro szerint az IP országa: ${s?.ipCountryCode ?? '?'}`);
  const tours = await c.dump(topics.tournaments(1, 77)); // labdarúgás, Anglia
  const names = tours.filter((r) => r._type === 'TOURNAMENT').map((r) => `${r.name} (${r.id})`);
  console.log(`✅ Angol foci-bajnokságok: ${names.length} db – ${names.slice(0, 4).join('; ')}`);
  const pl = tours.find((r) => r._type === 'TOURNAMENT' && /^Premier Liga 20/.test(r.name)) ?? tours.find((r) => r._type === 'TOURNAMENT');
  const list = parseRecords(await c.dump(topics.leagueMatches(pl.id)));
  console.log(`✅ ${pl.name}: ${list.length} meccs 1X2-vel`);
  for (const m of list.slice(0, 5)) {
    const x = m.markets[0];
    console.log(`   ${m.start.toISOString().slice(0, 16)} ${m.name}: ${x ? x.outcomes.map((o) => `${o.name} ${o.odds}`).join(' · ') : '–'}`);
  }
  if (list[0]) {
    const [full] = parseRecords(await c.dump(topics.matchOdds(list[0].id)));
    const totals = full?.markets.filter((m) => m.type === 'Gólszám' && m.part === 'Rendes játékidő') ?? [];
    console.log(`✅ ${list[0].name}: ${full?.markets.length ?? 0} piac; gólvonalak: ${totals.map((m) => m.outcomes.map((o) => `${o.name}${o.odds}`).join('/')).slice(0, 4).join(' | ')}`);
  }
  c.close();
  console.log(`\nKész (${Date.now() - t0} ms). Ha mindenhol ✅ van, a TippmixPro-szkennelés innen megvalósítható.`);
  process.exit(0);
} catch (e) {
  console.log(`❌ Hiba: ${e.message}`);
  console.log('Ha "HTTP 403" vagy időtúllépés: a TippmixPro valószínűleg nem engedi a kapcsolódást erről a szerverről (külföldi IP).');
  process.exit(1);
}
