// WER AM EHESTEN – Deno-Server: statische Dateien + WebSocket + Rundenlogik.
// Keine Abhaengigkeiten, kein Build-Schritt. `deno task dev` oder direkt:
//   deno run --allow-net --allow-read --allow-env --allow-sys server.js
//
// Raum, Host, Bereit, Karenzzeit und Bremse stehen nicht mehr hier, sondern in
// raum.js und statisch.js – beides Kopien aus /var/www/html/gemeinsam/, die
// `node werkzeug/verteilen.mjs` hierher schreibt. Was hier steht, ist nur noch
// dieses Spiel: hier waehlt niemand ja oder nein, sondern eine *Person*.

import { MODI, stapelFuer } from "./fragen.js";
import { darfRaumOeffnen, raumVermerkt } from "./bremse.js";
import { cleanName, raumverwaltung, shuffle } from "./raum.js";
import { starte } from "./statisch.js";

const PORT = Number(Deno.env.get("PORT") ?? 8074);
const HOST = Deno.env.get("HOST") ?? "0.0.0.0";

const PUBLIC = new URL("./public/", import.meta.url);

// ---------------------------------------------------------------------------
// Spielkonstanten
// ---------------------------------------------------------------------------

// Zehn statt acht: hier tippt jeder nur auf einen Namen, es gibt keine Reihe,
// in der man wartet, bis man dran ist. Die Runde dauert zu zehnt genauso lang
// wie zu viert.
const MAX_PLAYERS = 10;
// Zu zweit ist das Spiel kaputt: man kann nur sich selbst oder den anderen
// waehlen, und beides sagt nichts.
const MIN_PLAYERS = 3;

const RUNDEN_OPTIONEN = [8, 12, 20, 0]; // 0 = ohne festes Ende

// ---------------------------------------------------------------------------
// Wie lange jemand weg sein darf
//
// Dieses Spiel ist das ruhigste im Haus: eine Frage, ein Tipp, danach wird
// geredet. Zwischen zwei Knopfdruecken liegen Minuten, in denen niemand etwas
// tut – und genau dann legen Leute das Handy weg, sperren den Bildschirm oder
// wechseln kurz in eine andere App. Auf dem Handy ist das jedes Mal eine
// gekappte Verbindung.
//
// Mit den Vorgaben aus raum.js (Warteraum: Platz sofort weg, Partie: eine
// Minute) hiess das: wer aus der Hosentasche zurueckkam, war ein neuer
// Spieler. Der alte Platz stand noch da, das Hostzeichen war weitergewandert,
// und wenn die Runde inzwischen lief, kam gar nichts mehr – „Die Runde laeuft
// schon". Das war der gemeldete Fehler, in der Lobby wie im Spiel.
//
// Die Zahlen sind deshalb dieselben wie in Imposter, wo genau das schon einmal
// gelöst wurde:
//
//   Warteraum   5 min – reicht fuer einen Anruf, blockiert aber keinen Platz
//                       ueber einen ganzen Abend
//   Partie     20 min – eine Zigarette, ein leerer Akku, ein Funkloch
//   Hostzeichen 45 s  – muss wandern, sonst kann niemand mehr starten, aber
//                       nicht bei jedem gesperrten Bildschirm
//   leerer Raum 30 min
//
// Endgueltig geht nur, wer selbst auf „Verlassen" tippt.
const ROOM_IDLE_MS = 30 * 60_000;
const SEAT_GRACE_MS = 20 * 60_000;
const LOBBY_GRACE_MS = 5 * 60_000;
// Ueber `HOST_MS` verkuerzbar – nicht fuer den Betrieb, sondern damit man den
// Wechsel von Hand nachstellen kann, ohne 45 Sekunden dazusitzen.
const HOST_GRACE_MS = (() => {
  const n = Number(Deno.env.get("HOST_MS"));
  return Number.isFinite(n) && n >= 200 ? n : 45_000;
})();

// ---------------------------------------------------------------------------
// Raeume
//
// Die Haken sind die ganze Anpassung: ein eigener Kartenstapel je Raum, eine
// Krone je Spieler, der Modus in der oeffentlichen Raumliste – und was
// passieren soll, wenn mitten in der Abstimmung jemand verschwindet.
// ---------------------------------------------------------------------------

const {
  rooms, browsing,
  createRoom, clearTimers, anwesende,
  send, raw, broadcast,
  roomList, pushState, pushRoomList,
  makePlayer, attach, dropPlayer, releaseSeat,
} = raumverwaltung({
  maxPlayers: MAX_PLAYERS,
  minPlayers: MIN_PLAYERS,
  roomIdleMs: ROOM_IDLE_MS,
  seatGraceMs: SEAT_GRACE_MS,
  lobbyGraceMs: LOBBY_GRACE_MS,
  hostGraceMs: HOST_GRACE_MS,
  einstellungen: { rounds: 12, modus: "gemischt", selbst: true },
  raumfelder: () => ({ deck: [] }),
  spielerfelder: () => ({ kronen: 0 }),
  listeneintrag: (room) => ({ modus: room.settings.modus }),

  beimBeitritt: (room) => {
    if (room.phase === "playing" && room.aktuell) pushRunde(room);
  },

  // Seine Stimme zaehlt nicht mehr mit, sonst wartet die Runde ewig auf ihn.
  beimVerlassen: (room, player) => {
    room.aktuell?.stimmen.delete(player.id);
  },
  nachVerlassen: (room) => {
    pruefeStimmen(room);
    if (room.aktuell) pushRunde(room);
  },

  beimPlatzfrei: (room, id) => {
    const cur = room.aktuell;
    if (cur && cur.schritt === "abstimmen") {
      // Stimmen *fuer* die Person ebenso einsammeln wie ihre eigene – beides
      // zeigt sonst auf jemanden, den es nicht mehr gibt.
      cur.stimmen.delete(id);
      for (const [waehlerId, zielId] of [...cur.stimmen]) {
        if (zielId === id) cur.stimmen.delete(waehlerId);
      }
      pruefeStimmen(room);
    }
    if (room.aktuell) pushRunde(room);
  },

  zurueckZurLobby: (room) => backToLobby(room),
});

// ---------------------------------------------------------------------------
// Fragenstapel
// ---------------------------------------------------------------------------

/**
 * Zieht eine Frage. Innerhalb einer Partie wiederholt sich keine, bis der
 * Stapel durch ist – das ist der Grund, warum der Server zieht und nicht jeder
 * Client fuer sich.
 */
function zieheFrage(room) {
  if (!room.deck.length) room.deck = shuffle(stapelFuer(room.settings.modus));
  return room.deck.pop() ?? null;
}

// ---------------------------------------------------------------------------
// Spielablauf
// ---------------------------------------------------------------------------

function startGame(room) {
  clearTimers(room);
  // Wer beim Start gerade nicht verbunden ist, sass bis eben unter der kurzen
  // Warteraum-Karenz. Ab jetzt laeuft eine Partie – dann gilt fuer ihn auch die
  // lange, sonst verliert genau der seinen Platz, der beim Warten das Handy
  // weggelegt hat.
  for (const p of room.players.values()) {
    if (p.connected || !p.dropTimer) continue;
    clearTimeout(p.dropTimer);
    p.dropTimer = setTimeout(() => releaseSeat(room, p.id), SEAT_GRACE_MS);
  }
  room.phase = "playing";
  room.rundeNr = 0;
  room.deck = shuffle(stapelFuer(room.settings.modus));
  for (const p of room.players.values()) {
    p.punkte = 0;
    p.kronen = 0;
    p.ready = false;
  }
  pushState(room);
  naechsteRunde(room);
  pushRoomList();
}

function naechsteRunde(room) {
  clearTimers(room);
  const rounds = room.settings.rounds;
  if (rounds > 0 && room.rundeNr >= rounds) return finishGame(room);
  if (anwesende(room).length < MIN_PLAYERS) {
    // Zu wenige da – die Runde wuerde nichts hergeben. Warten, bis jemand
    // zurueckkommt; der Raumzustand bleibt stehen.
    room.aktuell = null;
    pushState(room);
    return;
  }

  room.rundeNr++;
  room.aktuell = {
    frage: zieheFrage(room),
    stimmen: new Map(),   // Waehler-Id -> Gewaehlte-Id
    schritt: "abstimmen",
    ergebnis: null,
  };
  pushRunde(room);
}

/** Der Rundenzustand geht an jeden einzeln – „meine Stimme" ist pro Spieler. */
function pushRunde(room) {
  const cur = room.aktuell;
  if (!cur) return;
  const waehler = anwesende(room);

  for (const p of room.players.values()) {
    send(p, {
      t: "runde",
      n: room.rundeNr,
      total: room.settings.rounds,
      frage: cur.frage,
      schritt: cur.schritt,
      stimmenAb: cur.stimmen.size,
      stimmenGesamt: waehler.length,
      // Wer schon gewaehlt hat, sieht die eigene Wahl – sonst weiss man nach
      // dem Tippen nicht mehr, was man getroffen hat.
      meineStimme: cur.stimmen.get(p.id) ?? null,
      // Waehlbar ist nur, wer auch da ist. Sonst gewinnt am Ende jemand, der
      // seit vier Runden nicht mehr im Raum sitzt.
      waehlbar: waehler.map((w) => ({ id: w.id, name: w.name })),
      selbstErlaubt: room.settings.selbst,
      ergebnis: cur.ergebnis,
    });
  }
}

/** Alle Anwesenden haben gewaehlt? Dann sofort aufloesen. */
function pruefeStimmen(room) {
  const cur = room.aktuell;
  if (!cur || cur.schritt !== "abstimmen") return;
  const waehler = anwesende(room);
  if (waehler.length && waehler.every((p) => cur.stimmen.has(p.id))) {
    aufloesen(room);
  } else {
    pushRunde(room);
  }
}

function aufloesen(room) {
  const cur = room.aktuell;
  if (!cur || cur.schritt === "aufloesung") return;
  clearTimers(room);

  // Stimmen einsammeln. Gezaehlt wird nach Gewaehlten, nicht nach Waehlern –
  // deshalb erst eine leere Zeile fuer jeden Anwesenden, damit auch die mit
  // null Stimmen im Ergebnis auftauchen.
  const zaehler = new Map();
  for (const p of anwesende(room)) {
    zaehler.set(p.id, { id: p.id, name: p.name, stimmen: 0, waehler: [] });
  }
  for (const [waehlerId, zielId] of cur.stimmen) {
    const eintrag = zaehler.get(zielId);
    if (!eintrag) continue; // gewaehlte Person hat den Raum inzwischen verlassen
    eintrag.stimmen++;
    const w = room.players.get(waehlerId);
    if (w) eintrag.waehler.push(w.name);
  }

  const ergebnis = [...zaehler.values()].sort((a, b) =>
    b.stimmen - a.stimmen || a.name.localeCompare(b.name, "de")
  );

  // Punkte: jede erhaltene Stimme zaehlt. Die Krone gibt es fuer den ersten
  // Platz – bei Gleichstand bekommen ihn alle, die oben stehen.
  const hoechst = ergebnis[0]?.stimmen ?? 0;
  for (const e of ergebnis) {
    const p = room.players.get(e.id);
    if (!p) continue;
    p.punkte += e.stimmen;
    if (hoechst > 0 && e.stimmen === hoechst) {
      p.kronen++;
      e.krone = true;
    }
  }

  cur.ergebnis = ergebnis;
  cur.schritt = "aufloesung";
  pushRunde(room);
  pushState(room);
}

function finishGame(room) {
  clearTimers(room);
  room.phase = "final";
  // Beendet der Host mitten in einer Runde, ist die angefangene noch nicht
  // ausgewertet – sonst steht im Endstand eine Runde mehr, als es Auflösungen
  // gab.
  const gespielt = room.aktuell && room.aktuell.schritt !== "aufloesung"
    ? room.rundeNr - 1
    : room.rundeNr;
  room.aktuell = null;
  const tabelle = [...room.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      punkte: p.punkte,
      kronen: p.kronen,
    }))
    .sort((a, b) => b.punkte - a.punkte || b.kronen - a.kronen);
  for (const p of room.players.values()) p.ready = false;
  broadcast(room, { t: "final", tabelle, runden: Math.max(gespielt, 0) });
  pushState(room);
  pushRoomList();
}

function backToLobby(room) {
  clearTimers(room);
  room.phase = "lobby";
  room.aktuell = null;
  room.rundeNr = 0;
  for (const p of room.players.values()) {
    p.ready = false;
    p.punkte = 0;
    p.kronen = 0;
  }
  pushState(room);
}

// ---------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------

function handle(ws, msg) {
  const room = ws._room;
  const player = ws._player;

  if (msg.t === "ping") {
    raw(ws, { t: "pong", c: msg.c, s: Date.now() });
    return;
  }

  if (msg.t === "browse") {
    if (!ws._room) {
      browsing.add(ws);
      raw(ws, { t: "rooms", rooms: roomList() });
    }
    return;
  }

  if (msg.t === "create") {
    if (room) return;
    if (!darfRaumOeffnen(ws._ip)) {
      return raw(ws, { t: "error", msg: "Zu viele Räume in kurzer Zeit. Warte kurz." });
    }
    raumVermerkt(ws._ip);
    const r = createRoom(msg.isPublic);
    if (MODI.includes(msg.modus)) r.settings.modus = msg.modus;
    const p = makePlayer(msg.name, true);
    r.hostId = p.id;
    r.players.set(p.id, p);
    attach(ws, r, p);
    pushState(r);
    pushRoomList();
    return;
  }

  if (msg.t === "join") {
    if (room) return;
    const r = rooms.get(String(msg.code ?? "").toUpperCase().trim());
    if (!r) return raw(ws, { t: "error", msg: "Diesen Raum gibt es nicht" });

    if (msg.token) {
      const back = [...r.players.values()].find((p) => p.token === msg.token);
      if (back) {
        if (back.ws && back.ws !== ws && back.ws.readyState === WebSocket.OPEN) {
          try { back.ws.close(4001, "woanders geöffnet"); } catch { /* egal */ }
        }
        attach(ws, r, back);
        pushState(r);
        return;
      }
    }

    if (r.players.size >= MAX_PLAYERS) {
      return raw(ws, { t: "error", msg: `Der Raum ist voll (${MAX_PLAYERS} Spieler)` });
    }
    if (r.phase !== "lobby") {
      return raw(ws, { t: "error", msg: "Die Runde läuft schon" });
    }
    const p = makePlayer(msg.name, false);
    r.players.set(p.id, p);
    attach(ws, r, p);
    pushState(r);
    return;
  }

  if (!room || !player) return;
  room.lastActivity = Date.now();

  switch (msg.t) {
    case "name":
      player.name = cleanName(msg.name);
      pushState(room);
      if (room.aktuell) pushRunde(room);
      break;

    case "ready":
      player.ready = !!msg.value;
      pushState(room);
      break;

    case "settings": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      if (RUNDEN_OPTIONEN.includes(msg.rounds)) room.settings.rounds = msg.rounds;
      if (MODI.includes(msg.modus)) room.settings.modus = msg.modus;
      if (typeof msg.selbst === "boolean") room.settings.selbst = msg.selbst;
      if (typeof msg.isPublic === "boolean") room.isPublic = msg.isPublic;
      pushState(room);
      pushRoomList();
      break;
    }

    case "start": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      const da = anwesende(room);
      if (da.length < MIN_PLAYERS) break;
      if (!da.every((p) => p.ready || p.id === room.hostId)) break;
      startGame(room);
      break;
    }

    case "stimme": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "abstimmen") break;
      const ziel = room.players.get(String(msg.ziel ?? ""));
      if (!ziel || !ziel.connected) break;
      if (!room.settings.selbst && ziel.id === player.id) break;
      cur.stimmen.set(player.id, ziel.id);
      pruefeStimmen(room);
      break;
    }

    // Aufloesen, ohne auf die Letzten zu warten.
    case "aufloesen": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "abstimmen") break;
      if (player.id !== room.hostId) break;
      aufloesen(room);
      break;
    }

    // Frage taugt nicht – neue ziehen, ohne dass die Runde zaehlt.
    case "andere": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "abstimmen") break;
      if (player.id !== room.hostId) break;
      cur.frage = zieheFrage(room);
      cur.stimmen.clear();
      pushRunde(room);
      break;
    }

    case "weiter": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "aufloesung") break;
      if (player.id !== room.hostId) break;
      naechsteRunde(room);
      break;
    }

    case "ende":
      if (player.id !== room.hostId || room.phase !== "playing") break;
      finishGame(room);
      break;

    case "again":
      if (player.id !== room.hostId || room.phase !== "final") break;
      backToLobby(room);
      break;

    case "leave":
      dropPlayer(ws, { immediate: true });
      break;
  }
}

starte({
  port: PORT,
  host: HOST,
  publicDir: PUBLIC,
  titel: "WER AM EHESTEN",
  handle,
  dropPlayer,
});
