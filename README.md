# Tauch-Vorschau

Wind, Seegang und Wassertemperatur der nächsten 7 Tage für die eigenen Tauchplätze,
mit Ampel-Bewertung. Live: https://tauch-vorschau.pages.dev/

- Reines HTML/CSS/JavaScript (ES-Module), kein Bauschritt.
- Wetter: Open-Meteo (Forecast + Marine), Pegel: PEGELONLINE.
- Tauchplätze: aus dem Tauchlogbuch (Supabase, Anmeldung mit dem Logbuch-Konto,
  Zugriff über Row Level Security) oder selbst angelegt (Suche über Nominatim und GBIF).
- Karte: Leaflet, Diagramme: Chart.js (beide von cdnjs).

## Lokal starten

```powershell
npx serve .
```

Service-Worker und Module brauchen einen Webserver; die Datei direkt zu öffnen reicht nicht.

## Veröffentlichen

Jeder Push auf `main` lädt die App per GitHub Action zu Cloudflare Pages
(`.github/workflows/deploy.yml`). Dafür braucht das Repo die Secrets
`CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` – dieselben wie beim Tauchlogbuch.

Vor dem Hochladen laufen die Tests (`npm test`), und die Cache-Version in `sw.js` wird auf den
Commit gesetzt – die installierte App holt sich so nach jeder Veröffentlichung den neuen Stand.
