# Wer am ehesten? 👉

Eine Frage, alle zeigen gleichzeitig auf eine Person. „Wer von euch stellt
sieben Wecker und verschläft trotzdem?" – und dann ist eine halbe Minute lang
Diskussion. Das Spiel zählt nur mit; interessant ist, was danach am Tisch
gesagt wird.

Läuft auf **Deno**, ohne eine einzige externe Abhängigkeit. Kein Build-Schritt,
kein `node_modules`, ein Prozess.

---

## Starten

```bash
deno task dev          # http://localhost:8074/
PORT=9000 deno task dev
deno task check        # Typprüfung
deno task probe        # spielt zwei Runden durch (Server muss laufen)
```

Zum Ausprobieren allein: die Seite in **mehreren Browserfenstern** öffnen. Jedes
Fenster ist ein eigener Spieler (die Sitzung hängt am `sessionStorage`, ein
zweiter Tab im selben Fenster wäre dieselbe Person).

## An den Tisch kommen

Wie bei den anderen Spielen: Name eintippen, **Raum eröffnen** oder über die
Liste bzw. den vierstelligen **Code** beitreten. Der geteilte Link mit `#CODE`
führt direkt hinein.

**Drei bis zehn** Leute. Drei ist keine Willkür: zu zweit kann man nur sich
selbst oder den anderen wählen, und beides sagt nichts. Zehn statt acht wie in
den anderen Rundenspielen, weil hier niemand wartet, bis er dran ist – alle
tippen gleichzeitig, die Runde dauert zu zehnt genauso lang wie zu viert.

## Eine Runde

1. Der Server zieht eine Frage. Sie ergänzt immer den Satz **„Wer von euch …?"**
2. Darunter stehen alle Namen aus dem Raum. **Alle tippen gleichzeitig** auf die
   Person, auf die es am ehesten zutrifft.
3. Solange nicht alle durch sind, kann man **umentscheiden** – die eigene Wahl
   bleibt sichtbar, die der anderen nicht.
4. **Aufgedeckt wird erst, wenn alle gewählt haben.** So schielt niemand ab und
   niemand hängt sich an eine sichtbare Mehrheit. Wer nicht warten will:
   der Host löst vorzeitig auf.
5. Die Auflösung sind Balken – wer wie viele Stimmen bekommen hat **und von
   wem**. Der zweite Teil ist der eigentliche Gesprächsanlass.

Jede erhaltene Stimme ist ein Punkt. Wer eine Runde anführt, bekommt zusätzlich
eine 👑. Am Ende steht, über wen am meisten geredet wurde.

## Die Fragen

`fragen.js` hat drei getrennte Stapel:

| Stapel | Inhalt |
|---|---|
| `HARMLOS` | 81 Fragen, die man an einem Familientisch vorlesen kann |
| `FRECH` | 115 Fragen über Macken, Peinlichkeiten und unangenehme Wahrheiten |
| `SCHMUTZIG` | 176 Fragen ab 18: Sex, Kink, Rausch, Betrug |

Vier Modi:

| Modus | zieht aus |
|---|---|
| **Harmlos** | `HARMLOS` |
| **Gemischt** (Vorgabe) | `HARMLOS` + `FRECH` |
| **Frech** | `FRECH` |
| **18+** | `SCHMUTZIG`, und nur daraus |

Innerhalb einer Partie wiederholt sich keine Frage, bis der Stapel durch ist –
deshalb zieht der **Server** und nicht jeder Client für sich.

`probe.js` prüft, dass keine 18+-Frage in einen der drei anderen Modi
durchrutscht. Das ist die eigentliche Grenze: wer „gemischt" spielt, darf nie
eine davon sehen.

### Warum der 18+-Stapel nach Menschentypen sortiert ist

Das Spiel zeigt auf **Personen**, nicht auf Themen. Eine Frage trifft nur, wenn
am Tisch jemand sitzt, auf den sie passt – eine lange Reihe Sexfragen läuft
nach zehn Runden leer, weil immer dieselben zwei gewählt werden. `SCHMUTZIG`
ist deshalb nach Archetypen gebaut: die Stillen, die Lauten, die
Gleichgültigen, die chronisch Onlinen, die mit dem Spiegelfoto, die mit der
Theorie darüber, warum alle anderen falsch liegen. Dazu Filmklischees und die
Sorte Sache, die jeder erlebt hat und niemand erzählt. So wird auch gewählt,
wer sonst nie gewählt wird.

`FRECH` ist aus demselben Grund von 50 auf 115 gewachsen und deckt die
jugendfreie Hälfte derselben Typen ab.

### Jugendschutz

Der 18+-Stapel bringt die Abwägung mit, die `doku/inhalte.md` beschreibt:

- eigener Modus, nicht in „gemischt" untergemischt
- **Voreinstellung bleibt „Gemischt"** und damit ohne 18+
- eine Abfrage vor dem Umschalten *und* vor dem Beitritt in einen Raum, der
  schon so eingestellt ist – auch für den, der über einen geteilten Link
  hereinkommt und die Raumliste nie gesehen hat
- die Bestätigung liegt unter `amehesten_ab18` im `localStorage`, getrennt von
  der aus „Ich hab noch nie"

Gleiche Bauart wie dort, gleicher Vorbehalt: eine echte Schranke ist das nicht,
aber der Unterschied zwischen „aus Versehen" und „bewusst" ist dokumentiert.

Alle Texte sind selbst geschrieben, aus keiner Anleitung und keiner App
abgetippt. Regeln sind frei, fremde Fragenlisten nicht.

Zwei Regeln, die `probe.js` für jede einzelne Frage prüft: sie fängt **klein**
an und endet mit einem **Fragezeichen**. Beides, weil die Frage im Bildschirm
hinter dem festen Kopf „Wer von euch …" steht – ohne die Regeln stünde dort ein
halber Satz.

Und sie sind **geschlechtsneutral** formuliert. Die Fragen zeigen auf echte
Personen in der Runde; ein „als Erster" oder „weil er selbst" trifft dabei jedes
Mal jemanden falsch. Deshalb „zuerst" statt „als Erster" und Umschreibungen
statt Pronomen.

## Wenn jemand geht

- **Gewählt werden kann nur, wer da ist.** Sonst gewinnt am Ende jemand, der
  seit vier Runden nicht mehr im Raum sitzt.
- Bricht während der Abstimmung eine Verbindung ab, fällt die Stimme dieser
  Person weg und die Runde löst auf, sobald der Rest durch ist – sie hängt
  nicht bis zum Ablauf der Karenzzeit.
- Verlässt jemand den Raum ganz, verfallen auch die Stimmen, die **für** ihn
  abgegeben wurden. Sie zeigten sonst auf jemanden, den es nicht mehr gibt.

## Weg sein darf hier nichts kosten

Das ist das ruhigste Spiel im Haus: eine Frage, ein Tipp, danach wird zwei
Minuten geredet. In diesen zwei Minuten legen Leute das Handy weg, sperren den
Bildschirm oder gehen kurz in eine andere App – und auf dem Handy ist das jedes
Mal eine gekappte Verbindung, ohne dass jemand etwas davon merkt.

Mit den Vorgaben aus `raum.js` (Warteraum: Platz sofort frei, Partie: eine
Minute) hieß das: wer aus der Hosentasche zurückkam, war ein **neuer** Spieler.
Der alte Platz stand noch da, das Hostzeichen war weitergewandert, und lief die
Runde inzwischen, kam gar nichts mehr – „Die Runde läuft schon". Genau das war
der gemeldete Fehler, in der Lobby wie im Spiel.

Die Zahlen sind deshalb dieselben wie in Imposter, wo das schon einmal gelöst
wurde:

| Was | Wie lange | Warum |
|---|---|---|
| Platz im Warteraum | 5 min | reicht für einen Anruf, blockiert aber keinen Platz über einen ganzen Abend |
| Platz in der Partie | 20 min | Zigarette, leerer Akku, Funkloch |
| Hostzeichen | 45 s | muss wandern, sonst kann niemand starten – aber nicht bei jedem gesperrten Bildschirm |
| leerer Raum | 30 min | |

Wer beim Start des Spiels gerade nicht verbunden ist, bekommt die lange
Karenzzeit nachgereicht – sonst verlöre ausgerechnet der seinen Platz, der beim
Warten das Handy weggelegt hat.

**Endgültig geht nur, wer selbst auf „Raum verlassen" tippt.**

Dazu die Client-Hälfte in `public/app.js`, ebenfalls wie in Imposter:

- eine **einzige** Verbindung – `connect()` bricht ab, wenn schon eine steht
- bei jedem Zeichen von Rückkehr (`visibilitychange`, `pageshow`, `focus`,
  `online`) sofort neu verbinden, ohne die bis zu acht Sekunden Wartezeit
- „Verbindung weg" erscheint erst nach 1,5 s – die meisten Abbrüche sind vorher
  geheilt, und eine Warnung, die dauernd aufblinkt, liest niemand mehr
- eine Fehlermeldung wirft nur dann aus dem Raum, wenn auf dieser Verbindung
  noch nie ein Raumzustand ankam. Dann ist der Wiedereinstieg gescheitert und
  die gemerkte Sitzung wird gelöscht – sonst versuchte der Client sie im
  Halbminutentakt weiter

Nachgewiesen wird das in `probe.js` (Warteraum, laufende Runde, Hostzeichen)
und in `werkzeug/lobbyprobe.mjs` (L06, L09, L17).

## Dateien

| Datei | Was |
|---|---|
| `server.js` | statische Dateien, WebSocket, Räume, Rundenlogik |
| `fragen.js` | die drei Fragenstapel |
| `raum.js` | gemeinsame Raumverwaltung, hier mit langen Karenzzeiten aufgerufen |
| `statisch.js` | gemeinsamer Einstieg: statische Dateien, WebSocket |
| `bremse.js` | gemeinsames Rate-Limiting, **wortgleich in allen Spielen** |
| `probe.js` | spielt zwei Runden mit vier Clients durch, prüft die Regeln, die Stapel und den Wiedereinstieg |
| `public/index.html` | alle vier Bildschirme, die Hilfe und die 18+-Abfrage |
| `public/style.css` | oben der gemeinsame Lobby-Block, darunter das Eigene |
| `public/app.js` | Verbindung, Warteraum, Abstimmung, Balken |

`bremse.js` und der CSS-Block bis `══ Gemeinsame Lobby-Basis ══ Ende ══` sind in
allen Spielen identisch und werden **von Hand** synchron gehalten. Wer dort
etwas ändert, ändert es überall.

## Betrieb

Port **8074**, gebunden auf `127.0.0.1`, davor Apache als Reverse Proxy unter
`/amehesten/`. Dienst: `amehesten.service` (systemd, läuft als `www-data`).

```bash
systemctl status amehesten
journalctl -u amehesten -f
```

Der Zustand liegt vollständig im RAM. Ein Neustart wirft alle laufenden Partien
weg – das ist gewollt, es gibt nichts zu sichern.
