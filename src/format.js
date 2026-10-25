// Közös magyar formázók a Telegram-üzenetekhez.

const SPORTS_HU = {
  soccer: 'Foci',
  football: 'Foci',
  basketball: 'Kosárlabda',
  tennis: 'Tenisz',
  hockey: 'Jégkorong',
  'ice hockey': 'Jégkorong',
  icehockey: 'Jégkorong',
  volleyball: 'Röplabda',
  'beach volleyball': 'Strandröplabda',
  handball: 'Kézilabda',
  'american football': 'Amerikai foci',
  americanfootball: 'Amerikai foci',
  baseball: 'Baseball',
  mma: 'MMA',
  boxing: 'Ökölvívás',
  'table tennis': 'Asztalitenisz',
  futsal: 'Futsal',
  rugby: 'Rögbi',
  'rugby league': 'Rögbi (league)',
  'rugby union': 'Rögbi (union)',
  cricket: 'Krikett',
  darts: 'Darts',
  snooker: 'Snooker',
  badminton: 'Tollaslabda',
  'water polo': 'Vízilabda',
  waterpolo: 'Vízilabda',
  floorball: 'Floorball',
  bandy: 'Bandy',
  'aussie rules': 'Ausztrál futball',
  aussierules: 'Ausztrál futball',
  'counter-strike': 'E-sport · Counter-Strike',
  'league of legends': 'E-sport · League of Legends',
  'dota 2': 'E-sport · Dota 2',
  valorant: 'E-sport · Valorant',
  'mobile legends': 'E-sport · Mobile Legends',
};

/** "Soccer" -> "Foci"; The Odds API kulcsnál ("soccer_epl") az előtag alapján. Ismeretlennél az eredeti marad. */
export function sportHu(sport) {
  if (!sport) return '';
  const s = String(sport).trim().toLowerCase();
  if (SPORTS_HU[s]) return SPORTS_HU[s];
  const prefix = s.split('_')[0];
  return SPORTS_HU[prefix] ?? sport;
}

/**
 * Kezdésig hátralévő idő magyarul.
 *   45 -> "45 perc", 62 -> "1 óra 2 perc", 120 -> "2 óra", 1545 -> "1 nap 1 óra 45 perc"
 */
export function durationHu(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} perc`;
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  return [days && `${days} nap`, hours && `${hours} óra`, mins && `${mins} perc`].filter(Boolean).join(' ');
}

/** " (1 óra 2 perc múlva)" vagy " (már megy)" vagy "" */
export function untilHu(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '';
  return minutes >= 0 ? ` (${durationHu(minutes)} múlva)` : ' (már megy)';
}
