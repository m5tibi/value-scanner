# Value-szkenner (papíros mód)

Pinnacle-alapú value-kereső: a Pinnacle oddsaiból árrésmentes (fair) valószínűséget számol, és jelez, ha egy soft iroda (alapból 1xBet, Marathon) **ugyanarra a piacra és vonalra** a fair odds fölötti árat ad. Minden jelzést elment, követi a **záró Pinnacle-oddsot (CLV)**, a meccs után elszámolja az eredményt, és naponta riportot küld Telegramra.

**Célja nem az automatikus fogadás**, hanem hogy pár hét alatt adatokkal kiderüljön, van-e valódi előny (pozitív CLV), mielőtt pénzt tennél bele.

## Hogyan dönt?

1. Lekéri a meccseket a következő `LOOKAHEAD_HOURS` órából (The Odds API).
2. A Pinnacle piacából (1X2 / moneyline, totals, spreads) **power** módszerrel kiszámolja a fair valószínűséget.
3. Soft oddsonként: `előny = soft_odds × fair_valószínűség − 1`.
4. Csak akkor jelez, ha minden szűrőn átmegy:

| Szűrő | Alapérték | Miért |
|---|---|---|
| `MIN_EDGE` – `MAX_EDGE` | 2% – 10% | a csatorna adatai alapján a 10% feletti „value” szinte mindig hibás/elavult vonal |
| azonos piac és vonal | mindig | nincs „Win” vs „AH(0.0)” jellegű párosítás |
| `MIN_MINUTES_TO_START` | 10 perc | legyen időd ellenőrizni és megtenni |
| `MAX_STALENESS_SEC` | 300 mp | régi odds nem számít (se Pinnacle, se soft) |
| `MIN_ODDS` – `MAX_ODDS` | 1.30 – 5.0 | szélsőséges oddsok kiszűrése |

5. Egy kimenetelre csak egyszer jelez (az első észlelést menti).

A Telegram-üzenet végén lévő **„Saját irodánál akkor éri meg, ha az odds ≥ X”** sor azt mondja meg, minimum milyen odds kell a te irodádnál (pl. Bankonbet), hogy még meglegyen a `MIN_EDGE` előny.

## CLV – a legfontosabb szám

Amíg a meccs nem kezdődik el, a bot minden körben frissíti a jelzéshez tartozó legutolsó Pinnacle-adatot. Kezdéskor ez lesz a záró vonal:

```
CLV = jelzéskori soft odds × záró fair valószínűség − 1
```

Ha a CLV **tartósan pozitív** (100+ jelzésen), a jelzések valóban a piac előtt járnak. Ha nulla körüli vagy negatív, nincs valódi előny, akármit mutat a rövid távú profit.

## Telepítés

```bash
npm install
cp .env.example .env          # töltsd ki
node --env-file=.env src/index.js --migrate   # tábla létrehozása (Supabase-ben is jó)
node --env-file=.env src/index.js --once      # egy próbakör
node --env-file=.env src/index.js             # folyamatos futás
```

Egyéb parancsok: `--tick` (egy teljes kör: szkennelés + esedékes elszámolás + esedékes riport, majd kilép), `--settle`, `--report`.

## Automatikus futtatás

**A) Render Cron Job (ajánlott, olcsó).** A repóban lévő `render.yaml` 5 percenként `node src/index.js --tick`-et futtat. A Render a cron jobot percre arányosan számlázza, csak a futás idejére.
1. Töltsd fel a mappát egy (privát) GitHub-repóba.
2. Render Dashboard → **New → Blueprint** → válaszd ki a repót.
3. Add meg a titkokat: `ODDS_API_KEY`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
4. Első futás után a Logs fülön látod a „Szkennelés kész” sort; a tábla magától létrejön.

**B) Render Background Worker.** Folyamatosan fut (`node src/index.js`), fix havidíjas; a `render.yaml` alján kommentben ott a blokk.

**C) GitHub Actions (ingyenes, de pontatlan).** A `.github/workflows/value-scanner.yml` 5 percenként futtatja a `--tick`-et. A GitHub az ütemezett futásokat terhelés idején késleltetheti vagy kihagyhatja, ezért papíros naplózásra jó, gyors jelzésekhez kevésbé. Titkok: repó → Settings → Secrets and variables → Actions.

Az elszámolás és a napi riport időpontját az adatbázis (`value_bot_state` tábla) tartja nyilván, így ütemezett futásnál sem duplikálódik.

A `DATABASE_URL` lehet a meglévő Supabase-adatbázisod (külön táblák: `value_signals`, `value_bot_state`). Renderről/GitHubról a Supabase **connection pooler** URL-jét érdemes használni.

## Kvóta (The Odds API)

A dokumentáció szerint egy lekérés költsége `piacok száma × régiók száma`; max. 10 iroda a `bookmakers` paraméterben 1 régiónak számít, az üres válasz ingyenes, a `/scores` (daysFrom) 2 kredit.

Becslés: `sportok, amelyeknek van meccse az ablakban × piacok × (60 / SCAN_INTERVAL_MIN) × 24`.
Például 4 aktív sport × 3 piac × 12 kör/óra × 24 óra ≈ **3456 kredit/nap**. Ezért:

- kezdd kevés sporttal és piaccal (pl. `MARKETS=totals,spreads`),
- növeld a `SCAN_INTERVAL_MIN`-t, vagy csökkentsd a `LOOKAHEAD_HOURS`-t,
- a `MIN_QUOTA_REMAINING` alatt a szkennelés magától leáll,
- a `DAILY_CREDIT_BUDGET` napi keretet ad (budapesti nap szerint, az adatbázisban számolva); ha elfogy, a szkennelés másnapig szünetel, az elszámolás tovább fut.

A `render.yaml` alapbeállítása egy 20 000 kredites havi csomaghoz igazodik, amelynek kb. a fele más projekté: 10 percenként, 5 sport, `totals,spreads`, 3 órás előretekintés, napi 260 kredit (≈ 8000/hó).

## Ismert korlátok

- **A Bankonbet nincs benne az API-ban**: a bot az 1xBet/Marathon árát látja, a saját irodádnál kézzel kell megnézni (ehhez van a küszöb-odds).
- A Pinnacle-adat a The Odds API szerint a nyilvános oldalról jön, késhet; a soft irodák is gyorsan igazodnak (az 1xBet pár perc alatt).
- Foci: az elszámolás a rendes játékidő eredményével számol; kosár/hoki moneyline-nál a hosszabbítással együttes eredménnyel.
- A `my_book`, `my_odds`, `my_stake` oszlopokba kézzel beírhatod, mit tettél meg ténylegesen, így a valós és a papíros eredmény összevethető.

## Tesztek

```bash
npm test
```
