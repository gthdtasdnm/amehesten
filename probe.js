// Spielt den ganzen Ablauf mit vier Clients durch: Raum, Warteraum, Abstimmen,
// Umentscheiden, Auflösung mit Balken, Selbstwahl-Schalter, Rausflug eines
// Wählers, Endstand, Neustart.
//
// Kein Testrahmen, keine Abhaengigkeit – das Skript wirft, wenn etwas nicht
// stimmt, und schreibt sonst mit, was passiert ist. Der Server muss dafuer
// laufen:
//
//   deno task dev            (in einer zweiten Sitzung)
//   deno task probe
// Gegen die Live-Fassung statt gegen den lokalen Server:
//   WS_URL=wss://inf-zeus.de/amehesten/ws deno task probe

import { FRECH, HARMLOS, MODI, SCHMUTZIG, stapelFuer } from "./fragen.js";

const PORT = Deno.env.get("PORT") ?? "8074";
const URL_WS = Deno.env.get("WS_URL") ?? `ws://127.0.0.1:${PORT}/ws`;

function client(name) {
  const c = {
    name, ws: new WebSocket(URL_WS), you: null, room: null, runde: null,
    final: null, fehler: [],
  };
  c.ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "joined") { c.you = m.you; c.token = m.token; }
    if (m.t === "room") c.room = m;
    if (m.t === "runde") c.runde = m;
    if (m.t === "final") c.final = m;
    if (m.t === "error") c.fehler.push(m.msg);
  };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.offen = new Promise((res) => { c.ws.onopen = res; });
  return c;
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function bis(bedingung, was, ms = 3000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return;
    await warte(25);
  }
  throw new Error("Zeitüberschreitung: " + was);
}

// --- Erst die Fragenstapel, ohne Server -------------------------------------

const STAPEL = [["HARMLOS", HARMLOS], ["FRECH", FRECH], ["SCHMUTZIG", SCHMUTZIG]];

for (const [name, liste] of STAPEL) {
  if (new Set(liste).size !== liste.length) throw new Error(`${name} enthält Doppelte`);
  for (const f of liste) {
    // Jede Frage ergaenzt „Wer von euch …?" – klein anfangen, mit Fragezeichen
    // enden. Sonst steht auf dem Bildschirm ein halber Satz.
    if (!f.endsWith("?")) throw new Error(`${name}: ohne Fragezeichen: „${f}"`);
    if (f[0] !== f[0].toLowerCase()) throw new Error(`${name}: groß geschrieben: „${f}"`);
  }
}
// --- Die wichtigste Regel: Vermutung, nicht Beichte -------------------------
//
// „Wer von euch WUERDE am ehesten …" – nicht „wer HAT schon mal …". Der
// Unterschied entscheidet, was fuer ein Spiel das hier ist:
//
//   Bei „wer hat schon mal" kennt nur eine Person die Antwort. Die anderen
//   raten nicht, sie wissen es schlicht nicht. Die Aufloesung ist dann ein
//   Outing oder eine Luege, und der Getroffene muss sich erklaeren. Das ist
//   ein Verhoer – und es ist ausserdem das Spiel nebenan, „Ich hab noch nie".
//
//   Bei „wer wuerde am ehesten" gibt es gar keine Wahrheit, nur das Urteil
//   des Tisches. Niemand kann falsch liegen, niemand muss etwas zugeben, und
//   der Gespraechsanlass ist nicht „stimmt das?", sondern „warum denkt ihr
//   das ueber mich?".
//
// Und genau das macht den 18+-Stapel erst spielbar: als Vermutung geht eine
// Frage durch, die als Geständnis den Abend beenden wuerde.
//
// Erlaubt sind zwei Formen:
//   1. die Vermutung  – „wuerde am ehesten …", „waere …", „haette …"
//   2. die Zuschreibung im Jetzt – „hat den groessten …", „sagt am
//      haeufigsten …". Auch das schaetzt der Tisch, es blickt nur nicht
//      zurueck.
// Verboten ist die Vergangenheit.
//
// Mechanisch faengt das hier nur „schon mal" ab – das ist die Form, in der es
// sich einschleicht, und sie ist eindeutig. Den Rest traegt der Kopf beim
// Schreiben. Gleiche Bauart wie die Wortliste in Flaschendrehen: eine harte
// Grenze, die nicht vom guten Willen des naechsten Durchgangs abhaengt.
for (const [name, liste] of STAPEL) {
  const beichte = liste.filter((f) => /schon mal/i.test(f));
  if (beichte.length) {
    throw new Error(
      `${name}: ${beichte.length} Frage(n) in der Beichtform statt als Vermutung.\n` +
        beichte.map((f) => `  „${f}"\n  → besser: „würde am ehesten …?"`).join("\n"),
    );
  }
}

// Auch ueber die Stapel hinweg: „gemischt" wirft zwei davon zusammen, eine
// Dublette kaeme sonst in derselben Partie zweimal.
const alleFragen = STAPEL.flatMap(([, l]) => l);
const doppelt = alleFragen.filter((f, i) => alleFragen.indexOf(f) !== i);
if (doppelt.length) throw new Error("Über die Stapel hinweg doppelt: " + doppelt.join(" | "));

if (stapelFuer("gemischt").length !== HARMLOS.length + FRECH.length) {
  throw new Error("Gemischt ist nicht die Summe beider Stapel");
}
// Der 18+-Stapel darf nirgendwo sonst auftauchen. Sonst haette „harmlos" oder
// „gemischt" plötzlich Fragen, für die es die Abfrage im Client gibt.
for (const m of ["harmlos", "gemischt", "frech"]) {
  const stapel = new Set(stapelFuer(m));
  const durchgerutscht = SCHMUTZIG.filter((f) => stapel.has(f));
  if (durchgerutscht.length) {
    throw new Error(`Modus ${m} zieht 18+-Fragen: ` + durchgerutscht.join(" | "));
  }
}
if (stapelFuer("ab18").length !== SCHMUTZIG.length) {
  throw new Error("Der Modus ab18 zieht nicht genau den 18+-Stapel");
}
if (!MODI.includes("ab18")) throw new Error("ab18 fehlt in MODI");
const vermutung = alleFragen.filter((f) => /^(würde|wäre|hätte)|(würde|wäre|hätte) am ehesten/.test(f));
console.log(
  `ok  Fragen: ${HARMLOS.length} harmlos, ${FRECH.length} frech, ` +
    `${SCHMUTZIG.length} ab 18 – keine Doppelten, 18+ nur im eigenen Modus`,
);
console.log(
  `ok  keine einzige in der Beichtform; ${vermutung.length} von ${alleFragen.length} ` +
    "sind ausdrückliche Vermutungen, der Rest Zuschreibungen im Jetzt",
);

// --- Jetzt der Server -------------------------------------------------------

const A = client("Anna"), B = client("Ben"), C = client("Cem"), D = client("Dana");
const alleC = [A, B, C, D];
/** Die Clients der Verbindungsproben – am Ende genauso auf Fehler geprüft. */
const extra = [];
await Promise.all(alleC.map((c) => c.offen));

A.send({ t: "create", name: "Anna", isPublic: true, modus: "gemischt" });
await bis(() => A.room, "Raum angelegt");
const code = A.room.code;
console.log("Raum:", code);

B.send({ t: "join", code, name: "Ben" });
C.send({ t: "join", code, name: "Cem" });
D.send({ t: "join", code, name: "Dana" });
await bis(() => A.room.players.length === 4, "vier Spieler");

// --- Weg und wieder da, im Warteraum ----------------------------------------
//
// Das ruhigste Spiel im Haus: zwischen zwei Knopfdruecken wird geredet, nicht
// getippt, und genau dann legen Leute das Handy weg. Auf dem Handy ist jeder
// gesperrte Bildschirm eine gekappte Verbindung. Frueher war der Platz im
// Warteraum dann sofort frei – wer zurueckkam, war ein neuer Spieler auf einem
// neuen Platz, und wenn die Runde inzwischen lief, kam er gar nicht mehr rein.
// Seit `lobbyGraceMs` bleibt der Platz stehen und der Wiedereinstieg fuehrt
// zurueck auf denselben.

const E = client("Eren");
extra.push(E);
await E.offen;
E.send({ t: "join", code, name: "Eren" });
await bis(() => E.you && A.room.players.length === 5, "Eren sitzt");
const erenId = E.you, erenToken = E.token;

E.ws.close();                                    // wegwischen, kein „leave"
await bis(
  () => A.room.players.find((p) => p.id === erenId)?.connected === false,
  "Eren gilt als abwesend",
);
if (A.room.players.length !== 5) {
  throw new Error("Der Platz wurde im Warteraum sofort geräumt");
}
console.log("ok  wer im Warteraum die Verbindung verliert, behält seinen Platz");

const E2 = client("Eren");
extra.push(E2);
await E2.offen;
E2.send({ t: "join", code, token: erenToken, name: "Eren" });
await bis(
  () => E2.you === erenId &&
    A.room.players.find((p) => p.id === erenId)?.connected === true,
  "Eren zurück auf seinem Platz",
);
if (A.room.players.length !== 5) {
  throw new Error("Beim Wiedereinstieg ist ein zweiter Platz entstanden");
}
console.log("ok  Wiedereinstieg landet auf demselben Platz, nicht auf einem neuen");

E2.send({ t: "leave" });
await bis(() => A.room.players.length === 4, "Eren endgültig raus");
console.log("ok  endgültig geht nur, wer selbst auf Verlassen tippt");

// --- Das Hostzeichen wandert nicht bei jedem gesperrten Bildschirm ----------
//
// In einem eigenen Raum, damit die Partie oben davon nichts merkt. Wandert das
// Zeichen sofort, findet der Host seine Runde nach dem Blick aufs Handy in
// fremder Hand – und die Einstellungen sind weg.

{
  const H1 = client("Host"), H2 = client("Gast");
  extra.push(H1, H2);
  await Promise.all([H1.offen, H2.offen]);
  H1.send({ t: "create", name: "Host", isPublic: false, modus: "harmlos" });
  await bis(() => H1.room, "zweiter Raum");
  const code2 = H1.room.code;
  H2.send({ t: "join", code: code2, name: "Gast" });
  await bis(() => H2.room?.players.length === 2, "zwei im zweiten Raum");
  const hostId = H1.you, hostToken = H1.token;
  if (H2.room.hostId !== hostId) throw new Error("Der Ersteller ist nicht Host");

  H1.ws.close();
  await bis(
    () => H2.room.players.find((p) => p.id === hostId)?.connected === false,
    "Host gilt als abwesend",
  );
  await warte(500);
  if (H2.room.hostId !== hostId) {
    throw new Error("Das Hostzeichen ist sofort weitergewandert");
  }
  console.log("ok  das Hostzeichen bleibt liegen, solange der Host nur weg ist");

  const H3 = client("Host");
  extra.push(H3);
  await H3.offen;
  H3.send({ t: "join", code: code2, token: hostToken, name: "Host" });
  await bis(
    () => H3.you === hostId && H3.room?.hostId === hostId,
    "Host zurück, Zeichen noch da",
  );
  console.log("ok  der Host kommt zurück und hat seine Runde noch");
  H3.send({ t: "leave" });
  H2.send({ t: "leave" });
  await warte(120);
  H3.ws.close();
  H2.ws.close();
}

A.send({ t: "start" });
await warte(150);
if (A.room.phase !== "lobby") throw new Error("Start ging ohne Bereit durch");
console.log("ok  Start blockiert, solange nicht alle bereit sind");

for (const c of [B, C, D]) c.send({ t: "ready", value: true });
await bis(() => A.room.players.every((p) => p.ready || p.host), "alle bereit");

A.send({ t: "settings", rounds: 8, selbst: true });
await warte(120);
A.send({ t: "start" });
await bis(() => A.runde && A.room.phase === "playing", "Runde 1 läuft");
console.log(`R1 Frage: „Wer von euch ${A.runde.frage}"`);

// --- Wählbar sind nur Anwesende, inklusive man selbst ------------------------

if (A.runde.waehlbar.length !== 4) throw new Error("Nicht alle vier sind wählbar");
if (!A.runde.waehlbar.some((w) => w.id === A.you)) {
  throw new Error("Man selbst fehlt in der Wahlliste, obwohl Selbstwahl erlaubt ist");
}
console.log("ok  alle vier wählbar, Selbstwahl inbegriffen");

// --- Abstimmen: erst wenn alle durch sind, wird aufgelöst --------------------

A.send({ t: "stimme", ziel: B.you });
await bis(() => A.runde.stimmenAb === 1, "erste Stimme");
if (A.runde.schritt !== "abstimmen") throw new Error("Zu früh aufgelöst");
if (A.runde.meineStimme !== B.you) throw new Error("Die eigene Stimme kommt nicht zurück");
// Andere duerfen die fremde Stimme nicht sehen.
if (C.runde.meineStimme != null) throw new Error("Cem sieht eine fremde Stimme");
console.log("ok  eigene Stimme sichtbar, fremde nicht");

// Umentscheiden muss gehen, solange nicht alle durch sind.
A.send({ t: "stimme", ziel: C.you });
await bis(() => A.runde.meineStimme === C.you, "umentschieden");
if (A.runde.stimmenAb !== 1) throw new Error("Umentscheiden hat doppelt gezählt");
console.log("ok  umentscheiden ändert die Stimme, ohne doppelt zu zählen");

B.send({ t: "stimme", ziel: C.you });
C.send({ t: "stimme", ziel: C.you });          // Selbstwahl
await bis(() => A.runde.stimmenAb === 3, "drei Stimmen");
if (A.runde.schritt !== "abstimmen") throw new Error("Vor der letzten Stimme aufgelöst");
D.send({ t: "stimme", ziel: A.you });

await bis(() => A.runde.schritt === "aufloesung", "aufgelöst");
const erg = A.runde.ergebnis;
console.log("    " + erg.map((e) => `${e.name} ${e.stimmen}`).join(" · "));

const cem = erg.find((e) => e.id === C.you);
const anna = erg.find((e) => e.id === A.you);
if (cem.stimmen !== 3) throw new Error("Cem müsste drei Stimmen haben, hat " + cem.stimmen);
if (anna.stimmen !== 1) throw new Error("Anna müsste eine Stimme haben");
if (erg.reduce((s, e) => s + e.stimmen, 0) !== 4) throw new Error("Nicht vier Stimmen gezählt");
if (erg[0].id !== C.you) throw new Error("Der Meistgewählte steht nicht oben");
if (!cem.krone) throw new Error("Der Meistgewählte hat keine Krone");
if (anna.krone) throw new Error("Krone auch an jemanden vergeben, der nicht führt");
console.log("ok  Stimmen richtig gezählt, sortiert und die Krone richtig vergeben");

// Wer für wen gestimmt hat, steht in der Auflösung – das ist der Gesprächsanlass.
if (!cem.waehler.includes("Anna") || !cem.waehler.includes("Ben") ||
  !cem.waehler.includes("Cem")) {
  throw new Error("Die Wählernamen stimmen nicht: " + JSON.stringify(cem.waehler));
}
console.log("ok  Auflösung nennt, wer für wen gestimmt hat:", cem.waehler.join(", "));

// Punkte im Raumzustand.
await bis(() => A.room.players.find((p) => p.id === C.you)?.punkte === 3, "Punkte gebucht");
console.log("ok  Stimmen sind als Punkte im Raumzustand angekommen");

// Nur der Host darf weiter.
B.send({ t: "weiter" });
await warte(150);
if (A.runde.schritt !== "aufloesung") throw new Error("Ein Gast konnte weiterschalten");
console.log("ok  nur der Host schaltet weiter");

A.send({ t: "weiter" });
await bis(() => A.runde.n === 2 && A.runde.schritt === "abstimmen", "Runde 2");

// --- Selbstwahl abschalten wirkt erst in der Lobby, nicht mitten im Spiel ----

A.send({ t: "settings", selbst: false });
await warte(150);
if (A.runde.selbstErlaubt !== true) {
  throw new Error("Die Einstellung ließ sich mitten in der Partie ändern");
}
console.log("ok  Einstellungen lassen sich während der Partie nicht verstellen");

// --- Andere Frage ------------------------------------------------------------

const vorher = A.runde.frage;
B.send({ t: "andere" });
await warte(150);
if (A.runde.frage !== vorher) throw new Error("Ein Gast konnte die Frage tauschen");
A.send({ t: "andere" });
await bis(() => A.runde.frage !== vorher, "Frage getauscht");
if (A.runde.stimmenAb !== 0) throw new Error("Die Stimmen wurden beim Tausch nicht geleert");
console.log("ok  der Host tauscht die Frage, dabei werden die Stimmen geleert");

// --- Weg und wieder da, mitten in der Runde ---------------------------------
//
// Der zweite gemeldete Fall: Bildschirm gesperrt, während die anderen reden.
// Der Platz muss stehen bleiben, und der Wiedereinstieg muss die laufende
// Runde mitbringen – sonst sitzt man vor einem leeren Bildschirm, bis der Host
// weiterschaltet.

const danaId = D.you, danaToken = D.token, danaRunde = A.runde.n;
D.ws.close();
await bis(
  () => A.room.players.find((p) => p.id === danaId)?.connected === false,
  "Dana gilt als abwesend",
);
if (A.room.players.length !== 4) {
  throw new Error("Danas Platz war mitten in der Runde sofort weg");
}

const D2 = client("Dana");
extra.push(D2);
await D2.offen;
D2.send({ t: "join", code, token: danaToken, name: "Dana" });
await bis(
  () => D2.you === danaId && D2.runde?.n === danaRunde,
  "Dana zurück in der laufenden Runde",
);
if (A.room.players.length !== 4) {
  throw new Error("Beim Wiedereinstieg ins Spiel entstand ein zweiter Platz");
}
if (!D2.runde.frage) throw new Error("Die laufende Frage kam beim Wiedereinstieg nicht mit");
console.log("ok  mitten in der Runde weg und zurück: derselbe Platz, dieselbe Frage");

// Ab hier spricht Dana über die neue Verbindung.
D.ws = D2.ws;
D.send = D2.send;

// --- Ein Wähler verschwindet: die Runde darf nicht hängen bleiben ------------

A.send({ t: "stimme", ziel: B.you });
B.send({ t: "stimme", ziel: A.you });
C.send({ t: "stimme", ziel: A.you });
await bis(() => A.runde.stimmenAb === 3, "drei von vier");
if (A.runde.schritt !== "abstimmen") throw new Error("Ohne Danas Stimme aufgelöst");
D.send({ t: "leave" });
await bis(() => A.runde.schritt === "aufloesung", "nach Danas Abgang aufgelöst");
if (A.runde.ergebnis.some((e) => e.id === D.you)) {
  throw new Error("Die abgemeldete Dana steht noch im Ergebnis");
}
console.log("ok  wer geht, blockiert die Auflösung nicht und fällt aus dem Ergebnis");

// --- Endstand ----------------------------------------------------------------

A.send({ t: "ende" });
await bis(() => A.final, "Endstand");
console.log(`\nEndstand nach ${A.final.runden} Runden:`);
for (const p of A.final.tabelle) {
  console.log(`  ${p.name.padEnd(6)} ${p.punkte} Stimmen, ${p.kronen}× angeführt`);
}
if (A.final.runden !== 2) throw new Error("Die angefangene Runde wurde mitgezählt");
const summe = A.final.tabelle.reduce((s, p) => s + p.punkte, 0);
if (summe !== 7) throw new Error("Erwartet: 4 + 3 Stimmen, gezählt: " + summe);
for (let i = 1; i < A.final.tabelle.length; i++) {
  if (A.final.tabelle[i - 1].punkte < A.final.tabelle[i].punkte) {
    throw new Error("Der Endstand ist nicht absteigend sortiert");
  }
}
console.log("ok  Endstand vollständig, sortiert, angefangene Runde nicht gezählt");

A.send({ t: "again" });
await bis(() => A.room.phase === "lobby", "zurück im Warteraum");
if (A.room.players.some((p) => p.punkte !== 0)) throw new Error("Punkte nicht zurückgesetzt");
console.log("ok  Nochmal setzt alles zurück");

const geprueft = [...alleC, ...extra];
if (geprueft.some((c) => c.fehler.length)) {
  throw new Error("Fehlermeldungen: " + JSON.stringify(geprueft.map((c) => c.fehler)));
}
console.log("\nALLES GRÜN");
Deno.exit(0);
