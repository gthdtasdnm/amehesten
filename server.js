// WER AM EHESTEN – Deno-Server: statische Dateien + WebSocket + Rundenlogik.
// Keine Abhaengigkeiten, kein Build-Schritt. `deno task dev` oder direkt:
//   deno run --allow-net --allow-read --allow-env --allow-sys server.js
//
// Raum, Host, Bereit, Karenzzeit und Bremse sind Zeile fuer Zeile wie in „Ich
// hab noch nie". Eigen ist nur alles ab „Spielablauf": hier waehlt niemand ja
// oder nein, sondern eine *Person* – und das aendert die halbe Rundenlogik.

import { MODI, stapelFuer } from "./fragen.js";
import {
  absender,
  darfRaumOeffnen,
  darfVerbinden,
  raumVermerkt,
  verbindungAuf,
  verbindungZu,
} from "./bremse.js";

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

const ROOM_IDLE_MS = 5 * 60_000;
const SEAT_GRACE_MS = 60_000;

const RUNDEN_OPTIONEN = [8, 12, 20, 0]; // 0 = ohne festes Ende

// ---------------------------------------------------------------------------
// Raeume
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rooms = new Map();

const browsing = new Set();

function newCode() {
  for (let i = 0; i < 500; i++) {
    let c = "";
    for (let k = 0; k < 4; k++) {
      c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(c)) return c;
  }
  return "R" + Date.now().toString(36).slice(-3).toUpperCase();
}

const token = () => crypto.randomUUID();

function cleanName(raw) {
  // Steuerzeichen raus, sonst zerlegt ein Zeilenumbruch im Namen das Layout.
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s.slice(0, 12) || "Spieler";
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function createRoom(isPublic) {
  const room = {
    code: newCode(),
    isPublic: !!isPublic,
    phase: "lobby",
    hostId: null,
    players: new Map(),
    settings: { rounds: 12, modus: "gemischt", selbst: true },
    deck: [],
    rundeNr: 0,
    aktuell: null,
    timers: new Set(),
    idleTimer: null,
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function scheduleIdleClose(room) {
  if (room.idleTimer) clearTimeout(room.idleTimer);
  room.idleTimer = setTimeout(() => {
    if (room.players.size === 0) destroyRoom(room);
  }, ROOM_IDLE_MS);
}

function cancelIdleClose(room) {
  if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
}

function clearTimers(room) {
  for (const id of room.timers) clearTimeout(id);
  room.timers.clear();
}

function destroyRoom(room) {
  clearTimers(room);
  cancelIdleClose(room);
  for (const p of room.players.values()) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
  }
  rooms.delete(room.code);
  pushRoomList();
}

function ensureHost(room) {
  const current = room.players.get(room.hostId);
  if (current?.connected) return;
  const all = [...room.players.values()];
  const next = all.find((p) => p.connected) ?? all[0];
  room.hostId = next ? next.id : null;
}

const anwesende = (room) => [...room.players.values()].filter((p) => p.connected);

// ---------------------------------------------------------------------------
// Senden
// ---------------------------------------------------------------------------

function send(player, msg) {
  const ws = player.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* Verbindung stirbt gleich sowieso */ }
  }
}

function raw(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* egal */ }
  }
}

function broadcast(room, msg) {
  for (const p of room.players.values()) send(p, msg);
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    punkte: p.punkte,
    ready: p.ready,
    connected: p.connected,
    host: p.id === room.hostId,
  }));
}

function roomState(room) {
  return {
    t: "room",
    code: room.code,
    isPublic: room.isPublic,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    players: publicPlayers(room),
    rundeNr: room.rundeNr,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
  };
}

function pushState(room) {
  broadcast(room, roomState(room));
  if (room.isPublic) pushRoomList();
}

function roomList() {
  return [...rooms.values()]
    .map((r) => ({ room: r, count: anwesende(r).length }))
    .filter(({ room, count }) =>
      room.isPublic && room.phase === "lobby" &&
      count > 0 && room.players.size < MAX_PLAYERS
    )
    .map(({ room, count }) => ({
      code: room.code,
      host: room.players.get(room.hostId)?.name ?? "?",
      count,
      max: MAX_PLAYERS,
      modus: room.settings.modus,
    }))
    .sort((a, b) => b.count - a.count);
}

function pushRoomList() {
  const msg = { t: "rooms", rooms: roomList() };
  for (const ws of browsing) raw(ws, msg);
}

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

function attach(ws, room, player) {
  browsing.delete(ws);
  cancelIdleClose(room);
  if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
  ws._room = room;
  ws._player = player;
  player.ws = ws;
  player.connected = true;
  ensureHost(room);
  send(player, {
    t: "joined",
    you: player.id,
    token: player.token,
    code: room.code,
  });
  send(player, roomState(room));
  if (room.phase === "playing" && room.aktuell) pushRunde(room);
}

function makePlayer(name, ready) {
  return {
    id: token(),
    token: token(),
    name: cleanName(name),
    ws: null,
    dropTimer: null,
    punkte: 0,
    kronen: 0,
    ready,
    connected: true,
  };
}

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

function dropPlayer(ws, { immediate = false } = {}) {
  const room = ws._room;
  const player = ws._player;
  browsing.delete(ws);
  if (!room || !player) return;
  ws._room = null;
  ws._player = null;

  player.connected = false;
  player.ws = null;
  player.ready = false;

  if (immediate || room.phase === "lobby") {
    releaseSeat(room, player.id);
    return;
  }

  if (player.dropTimer) clearTimeout(player.dropTimer);
  player.dropTimer = setTimeout(() => releaseSeat(room, player.id), SEAT_GRACE_MS);

  ensureHost(room);
  // Seine Stimme zaehlt nicht mehr mit, sonst wartet die Runde ewig auf ihn.
  room.aktuell?.stimmen.delete(player.id);
  pushState(room);
  pruefeStimmen(room);
  if (room.aktuell) pushRunde(room);
  pushRoomList();
}

function releaseSeat(room, id) {
  const player = room.players.get(id);
  if (!player) return;
  if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
  room.players.delete(id);
  ensureHost(room);

  if (room.players.size === 0) {
    backToLobby(room);
    scheduleIdleClose(room);
    pushRoomList();
    return;
  }

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

  pushState(room);
  pushRoomList();
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel.split("/").some((seg) => seg === "..")) {
    return new Response("Nope", { status: 400 });
  }
  const url = new URL(rel, PUBLIC);
  if (!url.href.startsWith(PUBLIC.href)) {
    return new Response("Nope", { status: 400 });
  }
  try {
    const body = await Deno.readFile(url);
    const ext = rel.slice(rel.lastIndexOf("."));
    return new Response(body, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": "no-cache",
      },
    });
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
}

Deno.serve({ port: PORT, hostname: HOST }, (req, info) => {
  const url = new URL(req.url);

  if (url.pathname === "/ws" || url.pathname.endsWith("/ws")) {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket erwartet", { status: 400 });
    }
    const ip = absender(req, info);
    if (!darfVerbinden(ip)) {
      return new Response("Zu viele Verbindungen", { status: 429 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket._ip = ip;
    let gezaehlt = false;
    const abmelden = () => {
      if (!gezaehlt) return;
      gezaehlt = false;
      verbindungZu(ip);
    };
    socket.onopen = () => { gezaehlt = true; verbindungAuf(ip); };
    socket.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg && typeof msg.t === "string") {
        try {
          handle(socket, msg);
        } catch (err) {
          console.error("Fehler beim Verarbeiten:", err);
        }
      }
    };
    socket.onclose = () => { abmelden(); dropPlayer(socket); };
    socket.onerror = () => { abmelden(); dropPlayer(socket); };
    return response;
  }

  return serveStatic(url.pathname);
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!anwesende(room).length && now - room.lastActivity > 10 * 60_000) {
      destroyRoom(room);
    }
  }
}, 60_000);

console.log(`WER AM EHESTEN läuft auf http://${HOST}:${PORT}/`);
