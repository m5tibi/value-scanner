// Válogatottak (országnevek) magyarul a nyilvános posztokhoz.
// Csak PONTOS egyezésre fordít (pl. "Hungary"), így klubnevekhez nem nyúl.
const COUNTRIES = {
  'Albania': 'Albánia', 'Algeria': 'Algéria', 'Andorra': 'Andorra', 'Argentina': 'Argentína', 'Armenia': 'Örményország',
  'Australia': 'Ausztrália', 'Austria': 'Ausztria', 'Azerbaijan': 'Azerbajdzsán', 'Belarus': 'Fehéroroszország',
  'Belgium': 'Belgium', 'Bolivia': 'Bolívia', 'Bosnia & Herzegovina': 'Bosznia-Hercegovina', 'Bosnia and Herzegovina': 'Bosznia-Hercegovina',
  'Brazil': 'Brazília', 'Bulgaria': 'Bulgária', 'Cameroon': 'Kamerun', 'Canada': 'Kanada', 'Chile': 'Chile', 'China': 'Kína',
  'Colombia': 'Kolumbia', 'Costa Rica': 'Costa Rica', 'Croatia': 'Horvátország', 'Cyprus': 'Ciprus', 'Czech Republic': 'Csehország',
  'Czechia': 'Csehország', 'Denmark': 'Dánia', 'Ecuador': 'Ecuador', 'Egypt': 'Egyiptom', 'England': 'Anglia', 'Estonia': 'Észtország',
  'Faroe Islands': 'Feröer', 'Finland': 'Finnország', 'France': 'Franciaország', 'Georgia': 'Grúzia', 'Germany': 'Németország',
  'Ghana': 'Ghána', 'Gibraltar': 'Gibraltár', 'Greece': 'Görögország', 'Hungary': 'Magyarország', 'Iceland': 'Izland', 'India': 'India',
  'Iran': 'Irán', 'Iraq': 'Irak', 'Ireland': 'Írország', 'Republic of Ireland': 'Írország', 'Israel': 'Izrael', 'Italy': 'Olaszország',
  'Ivory Coast': 'Elefántcsontpart', "Cote d'Ivoire": 'Elefántcsontpart', 'Jamaica': 'Jamaica', 'Japan': 'Japán', 'Jordan': 'Jordánia',
  'Kazakhstan': 'Kazahsztán', 'Kosovo': 'Koszovó', 'Latvia': 'Lettország', 'Liechtenstein': 'Liechtenstein', 'Lithuania': 'Litvánia',
  'Luxembourg': 'Luxemburg', 'Malta': 'Málta', 'Mexico': 'Mexikó', 'Moldova': 'Moldova', 'Montenegro': 'Montenegró', 'Morocco': 'Marokkó',
  'Netherlands': 'Hollandia', 'New Zealand': 'Új-Zéland', 'Nigeria': 'Nigéria', 'North Macedonia': 'Észak-Macedónia',
  'Northern Ireland': 'Észak-Írország', 'Norway': 'Norvégia', 'Panama': 'Panama', 'Paraguay': 'Paraguay', 'Peru': 'Peru',
  'Poland': 'Lengyelország', 'Portugal': 'Portugália', 'Qatar': 'Katar', 'Romania': 'Románia', 'Russia': 'Oroszország',
  'San Marino': 'San Marino', 'Saudi Arabia': 'Szaúd-Arábia', 'Scotland': 'Skócia', 'Senegal': 'Szenegál', 'Serbia': 'Szerbia',
  'Slovakia': 'Szlovákia', 'Slovenia': 'Szlovénia', 'South Africa': 'Dél-Afrika', 'South Korea': 'Dél-Korea', 'Korea Republic': 'Dél-Korea',
  'Spain': 'Spanyolország', 'Sweden': 'Svédország', 'Switzerland': 'Svájc', 'Tunisia': 'Tunézia', 'Turkey': 'Törökország', 'Türkiye': 'Törökország',
  'Ukraine': 'Ukrajna', 'United States': 'Egyesült Államok', 'USA': 'Egyesült Államok', 'Uruguay': 'Uruguay', 'Uzbekistan': 'Üzbegisztán',
  'Venezuela': 'Venezuela', 'Wales': 'Wales',
};
const SUFFIX = { 'U21': 'U21', 'U19': 'U19', 'U20': 'U20', 'U23': 'U23', 'Women': 'női', 'W': 'női' };

export function huName(name) {
  if (name == null) return name;
  const n = String(name).trim();
  if (COUNTRIES[n]) return COUNTRIES[n];
  const m = n.match(/^(.*\S)\s+(U21|U19|U20|U23|Women|W)$/);
  if (m && COUNTRIES[m[1]]) return `${COUNTRIES[m[1]]} ${SUFFIX[m[2]]}`;
  return n;
}
