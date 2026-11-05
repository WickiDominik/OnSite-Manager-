# BCF-OnSite

Mobil-optimierte App für Bauabnahmen und Mängelmanagement mit BimCollab-Anbindung. Läuft als **Android-App** (Capacitor) und als **PWA** im Browser.

## Funktionen

| Bereich | Umfang |
| --- | --- |
| Projekte | Liste mit Name, Ort, Status (Aktiv / Abgeschlossen / Pausiert), BCF-Kennzeichnung, anlegen, löschen, Status ändern |
| Mängel | Status- und Prioritäts-Badges, Zähler (Offen / In Arbeit / Erledigt), Filter, Sortierung nach Priorität, neuer Mangel |
| Prüfbericht | Prüfstatus, Bemerkung mit Auto-Speichern, Fotodokumentation, feste Speicherleiste, Sync-Status, BimCollab-Kommentare |
| Fotos & Redlining | Kamera oder Galerie, Vollbild-Editor mit Stift, Marker, Pfeil, Rechteck, Kreis, Farben, Strichstärken, Rückgängig, Alles löschen |
| 3D-BIM-Viewer | three.js + web-ifc, IFC pro Projekt hinterlegen (IFC-Button in der Mangelliste) oder ad-hoc laden, Vollbild, BCF-Kamerastandpunkte |
| BimCollab | OAuth2 mit PKCE und Token-Erneuerung, Mandanten-Einstellungen (URL, Client-ID, Secret, sonst Playground), Abgleich mit Fortschritt |
| BCF | Import von `.bcfzip` (Themen, Kommentare, Kameras, Snapshots), Export als BCF 2.1 inkl. Prüfdaten und Fotos |
| Offline-First | Alles lokal in IndexedDB, Markierung „nicht synchronisiert“, Offline-Banner, Upload beim nächsten Sync |
| Anmeldung | Optional über Supabase Auth (E-Mail/Passwort, Google, Passwort-Reset) |

## Entwicklung

```bash
npm install
npm run dev        # Browser-Version auf http://localhost:5173
npm test           # Unit-Tests (Mapping, BCF-XML, PKCE, Sync)
npm run build      # Produktions-Build nach dist/
```

## Android-App

Voraussetzung: Android Studio (bzw. Android SDK) und JDK 21.

```bash
npm run android:sync   # Web-Build + Capacitor sync
npm run android:open   # in Android Studio öffnen und auf Gerät starten
npm run android:apk    # Debug-APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Ohne lokale Android-Umgebung baut der GitHub-Workflow **Android APK** bei jedem Push und Pull Request eine Debug-APK. Sie liegt im Workflow-Lauf unter *Artifacts → BCF-OnSite-debug-apk* und kann direkt auf dem Gerät installiert werden (Installation aus unbekannten Quellen erlauben).

## BimCollab

> **Derzeit deaktiviert (lokaler Modus).** Login, Abgleich und Mandanten-Einstellungen sind ausgeblendet, bis eine eigene OAuth-Client-ID vorliegt. Die App arbeitet vollständig lokal; Daten werden per `.bcfzip` importiert und exportiert. Wieder einschalten: `VITE_BIMCOLLAB_ENABLED=true` in `.env` bzw. als GitHub-Repository-Variable (*Settings → Secrets and variables → Actions → Variables*) setzen.

- Standard ist der BimCollab-Playground (`https://playground.bimcollab.com`).
- Unter *Einstellungen → Mandanten-Einstellungen* lassen sich eigene URL, Client-ID, Client-Secret und Scopes hinterlegen.
- Die Weiterleitungs-URL, die beim OAuth-Client registriert sein muss, wird dort angezeigt. In der Android-App ist das `https://localhost/`.
- In der Android-App laufen API-Aufrufe über native HTTP-Requests (kein CORS-Problem). In der Browser-Variante muss der BimCollab-Server CORS für die App-Domain erlauben.

Abgleich (Sync):
1. Lokale Prüfberichte hochladen: Bemerkung als Kommentar, Fotos als Viewpoint-Snapshots, Prüfstatus als Topic-Status.
2. Lokale Mängel ohne BimCollab-Bezug werden übersprungen und als erledigt (synchronisiert, „nur lokal“) markiert.
3. Projekte und Themen inklusive Kamerastandpunkten und Kommentaren von BimCollab holen.

## Plattform-Anmeldung (optional)

Ohne Konfiguration startet die App direkt im lokalen Modus. Für die Anmeldung `.env` anlegen (siehe `.env.example`):

```
VITE_SUPABASE_URL=https://xyz.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Für den APK-Build dieselben Werte als Repository-Secrets hinterlegen.
