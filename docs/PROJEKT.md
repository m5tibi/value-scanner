# Mondom a Tutit! · Value – projektösszefoglaló és terv

_Állapot: 2026. november 18. · Tulajdonos: Varga Tibor (Tibi, @m5tibi) · Nyelv: magyar_

## 1. A cél

A **mondomatutit.hu** átalakítása: a régi meccs előtti tippek helyett **Pinnacle-alapú value-tippeket** árul,
egy Telegram-csatornán, **automatikus (Stripe) előfizetéssel**.

- Csak tippeket adunk. **Irodát nem ajánlunk**: hogy hol fogad, az előfizető dolga (pl. a legális vegas.hu is jó).
- A régi mondomatutit.hu-tagok a 90perc.hu-ra kerültek át. A mondomatutit.hu neve és domainje az új value-szolgáltatásé lesz.
- A 90perc.hu (repo: `m5tibi/vip-value-tipster`) **külön termék** marad: foci-tippek, Pro csomag 14 990 Ft/hó, Stripe.

## 2. Ami már működik (repo: `m5tibi/value-scanner`)

### Szolgáltatások a Renderen (auto-deploy a GitHub `main` ágról)
| Szolgáltatás | Típus | Parancs | Feladat |
|---|---|---|---|
| `value-scanner` | Cron (10 percenként) | `node src/index.js --tick` | Szkennelés, eredmény-elszámolás, napi riportok |
| `sportfolio-figyelo` | Background Worker | `node src/sportfolio/listener.js` | Telegram userbot: Sportfolio-csatornák figyelése (**csak privát használatra**) |

Adatbázis: **Supabase Postgres** (`DATABASE_URL`); a séma a `sql/schema.sql` fájlban van, és indításkor fut le (idempotens migrációk).

### A value-logika röviden
- **Adatforrás:** The Odds API (20 ezres csomag, $30/hó, minden hónap 1-jén nullázódik, UTC). Ugyanezt a keretet a VIP Value Tipster is használja (~175 kredit/nap).
- **Éles ár (sharp):** Pinnacle. **Lágy irodák (soft):** `onexbet, marathonbet, betsson, nordicbet, unibet_se, williamhill, sport888, coolbet, tipico_de`.
- **Reálérték:** a Pinnacle-oddsból vig nélkül (power de-vig). Jelzés akkor megy ki, ha az előny ≥ `MIN_EDGE` (2%). Ha egy csoportban mindkét oldal átmegy a küszöbön, a jelzést elvetjük (`mindket_oldal`). A 2-utas és a 3-utas h2h külön csoport (`h2h` / `h2h@3`).
- **Tét:** negyed Kelly, 0,25 egységre kerekítve. A nyilvános csatornában **legfeljebb 1 egység**, alsóbb osztályban és kupában fél tét.
- **Kreditbeosztás:** `DAILY_CREDIT_BUDGET=auto` (a megmaradt havi keretből naponta számolja, `src/budget.js`; a VIP Value Tipster fogyasztását méri), `MIN_QUOTA_REMAINING=1500`, a fel nem használt keret átvihető (`scan_carry`).
- **Ligaválasztás:** `SPORTS=auto`, hetente felmérjük a ligákat, és az utolsó 21 nap uniója alapján választunk (`src/discover.js`).
- **Piacok:** a dashboardon `MARKETS=h2h,spreads`.
- **Minőségmérés:** a fő mutató a **CLV** (a Pinnacle-záróárhoz képest); a papíros ROI ennél kevésbé fontos.

### Telegram
- **Privát csatorna** (`TELEGRAM_CHAT_ID`): minden jelzés, plusz reggel 9-kor papíros riport és szkennelési diagnosztika.
- **Nyilvános csatorna – „Mondom a Tutit! · Value”** (`PUBLIC_CHAT_ID`, `PUBLIC_BOT_TOKEN`). Jelenleg **csak teszt, egyedül Tibi látja**.
  - Szűrés: előny ≥ `PUBLIC_MIN_EDGE` (0.02), odds 1,50–5,00, meccsenként 1 tipp, folyamatos sorszám (#N, sosem ismétlődik).
  - Formátum: nincs irodanév; látszik az „Odds most · fair · előny”, a „✅ Csak akkor, ha az odds ≥ …” és a „💰 Tét”; a csapatnevek koppintásra másolhatók (`<code>`); a válogatottak neve magyarul (`src/names.js`); 18+ lábléc.
  - Ha az odds javul, követő jelzés megy (🔔).
  - Reggel 9-kor napi eredményposzt: a tegnapi tippek, majd a **csatorna saját** összesítője („eddigi tippjei … óta”, 30 nap után „utolsó 30 napja”).

### Eredmények (2026. nov. 17.)
- A rendszer összes jelzése, 30 nap: 78 elszámolt tipp, ROI +7,3%, **CLV +4,1%**, a tippek 75%-ánál pozitív CLV.
- A nyilvános csatorna nov. 12. óta: 34 tipp, +10,28 egység, CLV +3,2%. A ROI még nagyrészt szórás.

## 3. Teendők (prioritás szerint)

### A) Nyilvános indulás előkészítése
1. **A sorszám nullázása induláskor** (#1-től), és a tesztidőszak üzeneteinek törlése a csatornából. Ehhez kell egy egyszeri migráció vagy egy `PUBLIC_NO_OFFSET` változó. Az új összesítő csak az indulás utáni tippeket számolja (pl. egy `PUBLIC_SINCE` dátum alapján).
2. Egy „utólag elszámolva” sor a napi posztban azoknak a tippeknek, amelyek eredménye később érkezett (opcionális).
3. A csatorna leírása, logója és kitűzött üzenete: hogyan használd a tippeket, mi az egység, mi a CLV, felelős játék, 18+.

### B) Előfizetés (Stripe → Telegram-meghívó) – **ez a fő fejlesztés**
**Eldöntendő (Tibi):**
- Melyik kód és Stripe-fiók kezelje: a mondomatutit.hu meglévő FastAPI-repója (`m5tibi/foci-telegram-bot`), vagy egy új, kicsi szolgáltatás ebben a repóban?
- Ár és csomagok: havi, esetleg negyedéves; legyen-e próbaidő.

**Javasolt folyamat:**
1. A nyilvános csatornát **privát csatornává** alakítjuk. A jelenlegi `PUBLIC_*` csatorna lesz a fizetős.
2. A mondomatutit.hu-n egy Stripe Checkout (subscription) gomb van. Sikeres fizetés után a webhook (`checkout.session.completed`) a bottal létrehoz egy **egyszer használható meghívót**: `createChatInviteLink` `member_limit: 1` és lejárat beállítással. Ezt a vevő e-mailben és a köszönőoldalon kapja meg.
   - A kapcsolás alternatívája: a vevő a bot `/start <token>` parancsával köti össze a Stripe-ügyfelet a Telegram-felhasználójával. Ez megbízhatóbb, mert így tudjuk, kit kell kiléptetni.
3. Lemondáskor vagy sikertelen fizetéskor (`customer.subscription.deleted`, `invoice.payment_failed` a türelmi idő után) a tagot kiléptetjük: `banChatMember`, majd `unbanChatMember`, így később újra csatlakozhat.
4. Adatbázis-tábla: `subscribers` (stripe_customer_id, subscription_id, telegram_user_id, status, current_period_end).
5. Napi egyeztetés (cron): a Stripe-státuszt összevetjük a csatornatagokkal, és a lejártakat kiléptetjük.
6. A bot legyen a csatorna admina, „Invite users” és „Ban users” joggal.

### C) Statisztika-oldal a mondomatutit.hu-n
- A nyilvános tippek eredménysora, havi bontás, ROI, CLV, odds-sávok.
- Adatforrás: egy csak olvasható API vagy Supabase-nézet, amely **csak a lezárt nyilvános tippeket** mutatja. Függő tippet soha nem adunk ki.

### D) Később / feltételhez kötött
- A The Odds API **100 ezres csomagja ($59)**, ha a tippszám kevés vagy több liga kell.
- Fizetős adatforrás (pinnapi és/vagy OddsPapi, ~$136/hó) csak akkor, ha az előfizetők száma kitermeli. Az adatforrás-teszt eredménye: a pinnapi a jó Pinnacle-forrás, magyar irodát egyik szolgáltatás sem ad. A teszt `PROBE=1`-gyel kapcsolható vissza.
- Blogabet-profil a **90perc.hu VIP single tippjeivel** kirakatként. Ez nem ennek a repónak a része. Kézi feladás, robotos feladás nem lesz, mert a Blogabet letilthatja érte a fiókot.

## 4. Kötelező szabályok (nem alkudható)
- **A Sportfolio-tartalom soha nem kerül nyilvánosságra.** A nyilvános és a fizetős csatorna csak a szkenner **saját** jelzéseit kapja.
- **A `.env` és a `node_modules` soha nem kerül a GitHubra** (a repo nyilvános). A kulcsok a Render Environment beállításaiba mennek, chatbe nem.
- Ugyanaz a `TG_SESSION` nem futhat két helyen egyszerre (PC és Render).
- Ne legyen `.github` workflow, ami szkennel: ez duplán fogyasztaná az Odds API keretét.
- Minden módosítás előtt `git fetch && git rebase origin/main`, mert több munkamenet is pushol a repóba.
- Push előtt minden tesztnek zöldnek kell lennie: `npm test` (jelenleg 87 teszt).
- A felhasználói szövegek magyarul legyenek, tizedesvesszővel. Irodanév ne kerüljön nyilvános posztba.

## 5. Hasznos fájlok
- `src/index.js`: tick, szkennelés, nyilvános folyamat, napi posztok
- `src/public.js`: a nyilvános formátumok (jelzés, napi eredmény, tét)
- `src/scanner.js`, `src/markets.js`, `src/devig.js`: a value-matek
- `src/db.js`, `sql/schema.sql`: adatbázis
- `src/discover.js`: ligafelmérés
- `src/telegram.js`: üzenetküldés újrapróbálással
- `src/sportfolio/*`: a privát figyelő (OddsHub-parser, megerősítés)
- `render.yaml`, `.env.example`: konfiguráció
