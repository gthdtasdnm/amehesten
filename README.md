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

`fragen.js` hat zwei getrennte Stapel:

| Stapel | Inhalt |
|---|---|
| `HARMLOS` | 81 Fragen, die man an einem Familientisch vorlesen kann |
| `FRECH` | 50 Fragen über Macken und Peinlichkeiten |

Drei Modi: **Harmlos**, **Gemischt**, **Frech**. Innerhalb einer Partie
wiederholt sich keine Frage, bis der Stapel durch ist – deshalb zieht der
**Server** und nicht jeder Client für sich.

Anders als „Ich hab noch nie" kommt dieses Spiel **ohne 18+-Stapel und ohne
Altersabfrage** aus. Beide Stapel sind frei von Alkohol, Sex und Körperlichem;
„frech" heißt hier peinlich, nicht anzüglich. Das ist eine bewusste
Entscheidung: die Altersabfrage drüben ist Aufwand, den dieses Spiel nicht
braucht.

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

## Dateien

| Datei | Was |
|---|---|
| `server.js` | statische Dateien, WebSocket, Räume, Rundenlogik |
| `fragen.js` | die beiden Fragenstapel |
| `bremse.js` | gemeinsames Rate-Limiting, **wortgleich in allen Spielen** |
| `probe.js` | spielt zwei Runden mit vier Clients durch und prüft die Regeln |
| `public/index.html` | alle vier Bildschirme plus die Hilfe |
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
