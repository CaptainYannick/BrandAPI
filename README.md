# BrandAPI

Eigen, gratis te hosten API die per merk (op naam of afkorting) een logo en merkkleur teruggeeft — gebouwd voor de Pasmaatje-app.

Geen betaalde hosting nodig:
- **Data** (`data/brands.json` + `logos/*`) wordt gratis gehost via **GitHub Pages**.
- De **API** is een **Cloudflare Worker** (gratis tier: 100.000 requests/dag) die de data live van GitHub Pages ophaalt (5 min edge-cache) en matcht op zoekterm.

Nieuw merk toevoegen = entry in `data/brands.json` + logo-bestand pushen naar GitHub. Geen redeploy van de Worker nodig.

## Structuur
```
data/brands.json   → merkdata (naam, aliassen, kleuren, logo-pad)
logos/              → logo-bestanden (svg/png), zelf aan te leveren
worker/             → Cloudflare Worker (de API)
```

## 1. Een merk toevoegen of aanvullen

1. Zet het logo-bestand in `logos/<slug>.svg` (of `.png`).
2. Voeg (of vul aan) een entry in `data/brands.json`:
   ```json
   {
     "slug": "albert-heijn",
     "name": "Albert Heijn",
     "aliases": ["ah"],
     "colors": { "primary": "#0000FF" },
     "logo": "logos/albert-heijn.svg"
   }
   ```
   - Heb je een **bestaand** logo-bestand vervangen (zelfde bestandsnaam, nieuwe inhoud)? Voeg dan een `"version": <nummer>` toe (of hoog 'm met 1 op) aan die brand-entry. De Worker plakt dit als `?v=<nummer>` achter de logo-URL, zodat caches (ook in Pasmaatje zelf) het als een nieuw bestand zien en niet de oude, gecachte afbeelding blijven tonen. Zonder dit veld verandert de logo-URL niet, en kan een al-gecachet plaatje soms tot een paar minuten (of langer, afhankelijk van de cache in Pasmaatje) blijven hangen ondanks een geüpdatet bestand.
   - `aliases`: alle extra zoektermen/afkortingen die gebruikers zouden intypen (naam en slug hoeven er niet nogmaals in).
   - `colors.primary`: officiële hex-kleur van het merk — vul deze zelf in (bv. uit de brand-guidelines van het merk), er staat nu overal een lege placeholder `""`.
3. Commit + push naar `main`. GitHub Pages en de Worker pikken de wijziging vanzelf op (Worker cachet max. 5 minuten).

De 5 merken die al als (lege) placeholder in `data/brands.json` staan: Albert Heijn (`ah`), Etos, Gall & Gall (`gall`), Kruidvat, Holland & Barrett (`h&b`, `de tuinen`, `tuinen`). Logo's en kleuren moeten daar nog voor ingevuld worden.

## 2. GitHub Pages aanzetten

Dit moet je zelf eenmalig doen in de GitHub-repo-instellingen (kan niet via de CLI zonder `gh`):

1. Push dit repo naar GitHub (zie stap 4).
2. Ga naar **Settings → Pages**.
3. Bij **Build and deployment**: source = **Deploy from a branch**, branch = **main**, folder = **/ (root)**.
4. Na een paar minuten is de data bereikbaar op:
   `https://<jouw-github-gebruikersnaam>.github.io/<repo-naam>/data/brands.json`

## 3. Worker configureren en lokaal draaien

```bash
cd worker
npm install
```

Zet in `worker/wrangler.toml` de `DATA_BASE_URL` op je eigen GitHub Pages URL (zonder pad erna), bv.:
```toml
DATA_BASE_URL = "https://jouwnaam.github.io/BrandAPI"
```

Lokaal testen:
```bash
npm run dev
curl "http://localhost:8787/brand?q=ah"
curl "http://localhost:8787/brand?q=tuinen"
curl "http://localhost:8787/brands"
```

## 4. Naar GitHub pushen

```bash
gh repo create BrandAPI --public --source=. --remote=origin
git push -u origin main
```
(of maak het repo aan via github.com en voeg de remote handmatig toe met `git remote add origin <url>`)

## 5. Worker deployen naar Cloudflare

Vereist een gratis Cloudflare-account.

```bash
cd worker
npx wrangler login
npm run deploy
```

Wrangler geeft na deploy de live URL, bv. `https://brandapi.<jouw-subdomein>.workers.dev`.

## API

**`GET /brand?q=<zoekterm>`** — zoekt op naam, slug of alias (hoofdletterongevoelig, spaties/leestekens genegeerd).

```json
{
  "slug": "albert-heijn",
  "name": "Albert Heijn",
  "colors": { "primary": "#0000FF" },
  "logo": "https://jouwnaam.github.io/BrandAPI/logos/albert-heijn.svg"
}
```

Geen match → `404`:
```json
{ "error": "not found", "query": "xyz" }
```

**`GET /brands`** — geeft alle merken terug (handig om in de app te cachen).

CORS staat open (`Access-Control-Allow-Origin: *`), dus rechtstreeks aan te roepen vanuit de Pasmaatje-app.

**`POST /track`** — anonieme winkelteller voor Pasmaatje (zie `store_usage_test.dart`/`BRANDAPI_TRACKING.md` in de Pasmaatje-repo voor de app-kant). Body is `{"slug": "ikea"}` of `{"custom": "praxis"}`, altijd `204` terug, gelimiteerd tot 20 requests/min per IP. Geen CORS nodig, wordt niet vanuit een browser aangeroepen.

**`GET /stats?token=<STATS_TOKEN>`** — HTML-dashboard met welke merken/eigen-getypte winkels het vaakst voorkomen (eigen-getypte namen pas vanaf 3x, om toevallige/persoonlijke invoer niet te tonen). `401` zonder of met verkeerd token.

## 6. Eenmalige setup voor `/track` en `/stats` (D1 + secret)

Dit hoef je maar één keer te doen, met je eigen Cloudflare-login (`npx wrangler login`, zie stap 5):

```bash
cd worker
npx wrangler d1 create pasmaatje-stats
```
Plak de `database_id` die dit teruggeeft in `worker/wrangler.toml` bij `[[d1_databases]]` (i.p.v. `REPLACE-ME-AFTER-D1-CREATE`).

```bash
npx wrangler d1 execute pasmaatje-stats --remote --file=schema.sql
npx wrangler secret put STATS_TOKEN
```
Verzin bij die laatste een eigen lang, willekeurig token — dat is straks je wachtwoord voor `/stats`.

De rate limiter (`[[ratelimits]]` in `wrangler.toml`) heeft geen aparte aanmaakstap nodig — die is direct actief na de eerstvolgende `npm run deploy`.

**Belangrijk, buiten deze repo:** de vlag `storeUsageTrackingEnabled` in de Pasmaatje-app blijft `false` totdat ook de privacybeleid- en Play Data Safety-aanpassingen zijn doorgevoerd (zie `BRANDAPI_TRACKING.md` in de Pasmaatje-repo, sectie "Voor je live gaat") — dat is aan de Pasmaatje-kant, niet iets in dit repo.
