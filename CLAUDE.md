# Hinweise für Claude

Tauch-Bedingungs-Vorschau, ein einziger Nutzer. Code, Kommentare und Commit-Nachrichten auf Deutsch.
Statische Web-App ohne Bauschritt; was im Repo liegt, wird so ausgeliefert.

- Neue oder umbenannte App-Dateien in `sw.js` (`SHELL`) eintragen und `CACHE` hochzählen.
- Neue Ordner der App auch im Schritt „App zusammenstellen“ in `.github/workflows/deploy.yml` ergänzen.
- Die Verbindung zum Tauchlogbuch (`js/config.js`, `js/logbook.js`) nur lesend nutzen.
  Eingriffe ins Logbuch (Schema, Daten) vorher mit dem Nutzer absprechen.

## Veröffentlichen ohne Zutun des Nutzers

Wie beim Tauchplatzkarten-Generator: Änderung auf einem Arbeitszweig, lokal prüfen
(`npx serve .` und Browser), Pull Request nach `main` anlegen und selbst zusammenführen,
den Lauf „Web-App veröffentlichen“ beobachten und `tauch-vorschau.pages.dev` live prüfen.
Dem Nutzer nur das Ergebnis melden.

Der Nutzer arbeitet auch lokal (`C:\Users\Sebas\OneDrive\Dokumente\Wetter-Bedingungs-Vorschau`).
Vor eigener Arbeit deshalb immer zuerst `main` frisch holen.
