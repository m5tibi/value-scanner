// A reggeli (privát) papíros value-riport szövege.
export function pct(x) { return x === null || x === undefined ? '–' : `${(x * 100).toFixed(1)}%`; }

const roi = (r) => (r.elszamolt ? `, ROI ${pct(r.profit / r.elszamolt)}` : '');
const row = (label, r) => `${label}: ${r.n} db, profit ${Number(r.profit).toFixed(2)}${roi(r)}, CLV ${pct(r.atlag_clv)}`;

export function formatReport({ overall: o, bySport = [], byEdge = [], byOdds = [], byMarket = [], bySource = [] }, days = 30) {
  const decided = o.nyert + o.vesztett;
  return [
    `📊 <b>Papíros value-riport (utolsó ${days} nap)</b>`,
    `Jelzés: ${o.jelzes} | elszámolt: ${o.elszamolt} | nyert/vesztett: ${o.nyert}/${o.vesztett}` +
      (decided ? ` (${pct(o.nyert / decided)})` : ''),
    `Profit: <b>${o.profit.toFixed(2)} egység</b> | ROI: <b>${o.elszamolt ? pct(o.profit / o.elszamolt) : '–'}</b>`,
    `Átlagos előny jelzéskor: ${pct(o.atlag_elony)}`,
    `Átlagos CLV: <b>${pct(o.atlag_clv)}</b> | pozitív CLV aránya: ${pct(o.pozitiv_clv_arany)}`,
    ``,
    `<b>Előny-sávok</b>`,
    ...byEdge.map((r) => `${r.sav}: ${r.n} db, profit ${r.profit.toFixed(2)}, CLV ${pct(r.atlag_clv)}`),
    ...(bySource.length > 1 ? [``, `<b>Források</b>`, ...bySource.map((r) => row(r.forras, r))] : []),
    ...(byOdds.length ? [``, `<b>Odds-sávok</b>`, ...byOdds.map((r) => row(r.sav, r))] : []),
    ...(byMarket.length ? [``, `<b>Piacok</b>`, ...byMarket.map((r) => row(r.piac, r))] : []),
    ``,
    `<b>Sportágak</b>`,
    ...bySport.map((r) => `${r.sport_key}: ${r.n} db, profit ${r.profit.toFixed(2)}, CLV ${pct(r.atlag_clv)}`),
    ``,
    `ℹ️ A CLV a legfontosabb szám: ha tartósan pozitív, a jelzések valódi előnyt mutatnak.`,
  ].join('\n');
}
