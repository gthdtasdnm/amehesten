// Client: Verbindung, Warteraum, Abstimmung, Balkenauflösung.

const $ = (id) => document.getElementById(id);

// Sitzplatz-Tierchen. Gleiche Liste und gleiche Ableitung wie in den anderen
// Spielen, damit dieselbe Person überall dasselbe Zeichen bekommt. Bei zehn
// Leuten doppelt sich einiges – der Name steht daneben.
const AVATARS = ["🦊", "🐙", "🦅", "🐺", "🦁", "🐉"];
const avatarFor = (id) =>
  AVATARS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];

const MODUS_TEXT = {
  harmlos: "Harmlos",
  gemischt: "Gemischt",
  frech: "Frech",
};

const state = {
  you: null,
  code: null,
  room: null,
  runde: null,
  pendingIntent: null,
  visibility: "public",
  modus: "gemischt",
};

// ---------------------------------------------------------------------------
// Verbindung
// ---------------------------------------------------------------------------

let sock = null;
let retryIn = 500;

function session() {
  try {
    return JSON.parse(sessionStorage.getItem("amehesten") ?? "null");
  } catch {
    return null;
  }
}

function saveSession(data) {
  try {
    sessionStorage.setItem("amehesten", JSON.stringify(data));
  } catch { /* Privatmodus – dann eben ohne Wiedereinstieg */ }
}

function send(msg) {
  if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
}

function connect() {
  // Muss aus dem Basispfad kommen: das Spiel läuft in Produktion unter
  // /amehesten/, ein festes "/ws" landet auf der Domainwurzel.
  const url = new URL("ws", document.baseURI);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  sock = new WebSocket(url);

  sock.onopen = () => {
    retryIn = 500;
    setStatus("");
    const s = session();
    if (state.pendingIntent) {
      send(state.pendingIntent);
      state.pendingIntent = null;
    } else if (s && s.code && s.token) {
      send({ t: "join", code: s.code, token: s.token, name: s.name });
    } else {
      send({ t: "browse" });
    }
  };

  sock.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    onMessage(msg);
  };

  sock.onclose = () => {
    setStatus("Verbindung weg – neuer Versuch …");
    setTimeout(connect, retryIn);
    retryIn = Math.min(retryIn * 1.8, 8000);
  };
}

// ---------------------------------------------------------------------------
// Bildschirme
// ---------------------------------------------------------------------------

function show(name) {
  for (const s of document.querySelectorAll(".screen")) {
    s.classList.toggle("active", s.id === `screen-${name}`);
  }
  if (name === "home") send({ t: "browse" });
}

function setStatus(text) {
  $("status").textContent = text;
  $("status").classList.toggle("show", !!text);
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast._id);
  toast._id = setTimeout(() => t.classList.remove("show"), 2600);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// ---------------------------------------------------------------------------
// Nachrichten vom Server
// ---------------------------------------------------------------------------

function onMessage(msg) {
  switch (msg.t) {
    case "rooms":
      renderRooms(msg.rooms);
      break;

    case "joined":
      state.you = msg.you;
      state.code = msg.code;
      saveSession({ code: msg.code, token: msg.token, name: $("name").value.trim() });
      location.hash = msg.code;
      break;

    case "room":
      state.room = msg;
      if (msg.phase !== "playing") state.runde = null;
      renderRoom();
      break;

    case "runde":
      state.runde = msg;
      renderRunde();
      break;

    case "final":
      renderFinal(msg);
      break;

    case "error":
      toast(msg.msg);
      show("home");
      break;
  }
}

// ---------------------------------------------------------------------------
// Offene Räume
// ---------------------------------------------------------------------------

function renderRooms(list) {
  const box = $("roomList");
  $("roomsCount").textContent = list.length ? `(${list.length})` : "";
  if (!list.length) {
    box.innerHTML = `<p class="rooms-empty">Gerade ist kein Raum offen.
      Eröffne einen – er erscheint dann bei den anderen in der Liste.</p>`;
    return;
  }
  box.innerHTML = list.map((r) => `
    <button class="roomrow" data-code="${escapeHtml(r.code)}">
      <span class="roomrow-name">${escapeHtml(r.host)}</span>
      <span class="roomrow-meta">${escapeHtml(MODUS_TEXT[r.modus] ?? r.modus)}</span>
      <span class="roomrow-count">${r.count}/${r.max}</span>
    </button>`).join("");

  for (const b of box.querySelectorAll(".roomrow")) {
    b.addEventListener("click", () => joinCode(b.dataset.code));
  }
}

// Gemeinsam mit den anderen Spielen: wer bei einem seinen Namen eintippt,
// findet ihn beim nächsten schon vor.
const NAME_KEY = "spiele_name";

function meinName() {
  return $("name").value.trim();
}

function joinCode(code) {
  try {
    localStorage.setItem(NAME_KEY, meinName());
  } catch { /* egal */ }
  state.pendingIntent = { t: "join", code, name: meinName() };
  if (sock?.readyState === WebSocket.OPEN) {
    send(state.pendingIntent);
    state.pendingIntent = null;
  }
}

function verlassen() {
  send({ t: "leave" });
  saveSession(null);
  state.room = null;
  state.runde = null;
  state.you = null;
  location.hash = "";
  show("home");
}

// ---------------------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------------------

function setModus(m) {
  state.modus = m;
  for (const b of document.querySelectorAll("[data-modus]")) {
    b.classList.toggle("sel", b.dataset.modus === m);
  }
}

for (const b of document.querySelectorAll("[data-modus]")) {
  b.addEventListener("click", () => setModus(b.dataset.modus));
}

for (const b of document.querySelectorAll("[data-vis]")) {
  b.addEventListener("click", () => {
    state.visibility = b.dataset.vis;
    for (const x of document.querySelectorAll("[data-vis]")) {
      x.classList.toggle("sel", x === b);
    }
  });
}

$("createBtn").addEventListener("click", () => {
  try {
    localStorage.setItem(NAME_KEY, meinName());
  } catch { /* egal */ }
  state.pendingIntent = {
    t: "create",
    name: meinName(),
    isPublic: state.visibility === "public",
    modus: state.modus,
  };
  if (sock?.readyState === WebSocket.OPEN) {
    send(state.pendingIntent);
    state.pendingIntent = null;
  }
});

$("joinBtn").addEventListener("click", () => {
  const code = $("codeInput").value.toUpperCase().trim();
  if (code.length < 3) return toast("Bitte den vierstelligen Code eingeben");
  joinCode(code);
});

$("codeInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("joinBtn").click();
});

$("helpBtn").addEventListener("click", () => { $("help").hidden = false; });
$("helpClose").addEventListener("click", () => { $("help").hidden = true; });

// ---------------------------------------------------------------------------
// Warteraum
// ---------------------------------------------------------------------------

function renderRoom() {
  const r = state.room;
  if (!r) return;

  if (r.phase === "final") return; // das Endbild steht schon
  if (r.phase === "playing") {
    renderPunktleiste();
    return;                        // den Spielbildschirm zeichnet renderRunde()
  }

  show("lobby");

  $("roomCode").textContent = r.code;
  const da = r.players.filter((p) => p.connected).length;
  $("lobbyCount").textContent = `${da}/${r.maxPlayers}`;
  $("roomVis").textContent =
    (r.isPublic ? "Öffentlich – steht in der Liste" : "Privat – nur mit Code") +
    " · " + MODUS_TEXT[r.settings.modus];

  const list = $("playerList");
  list.textContent = "";
  const plaetze = Math.max(r.players.length + 1, 4);
  for (let i = 0; i < Math.min(plaetze, r.maxPlayers); i++) {
    const p = r.players[i];
    const card = document.createElement("div");
    card.className = "seat" + (p ? "" : " empty") +
      (p?.ready ? " ready" : "") + (p && !p.connected ? " off" : "");
    if (!p) {
      card.innerHTML =
        `<div class="av">🪑</div><div class="nm">frei</div><div class="st">wartet</div>`;
    } else {
      card.innerHTML = `
        <div class="av">${avatarFor(p.id)}</div>
        <div class="nm">${escapeHtml(p.name)}${p.id === state.you ? " (du)" : ""}</div>
        <div class="st">${
        !p.connected ? "weg" : p.host ? "startet" : p.ready ? "✓ bereit" : "wartet"
      }</div>
        ${p.host ? '<div class="host">HOST</div>' : ""}`;
    }
    list.append(card);
  }

  const isHost = r.hostId === state.you;
  const me = r.players.find((p) => p.id === state.you);
  $("hostControls").hidden = !isHost;
  $("guestControls").hidden = isHost;

  for (const b of document.querySelectorAll("[data-lobbymodus]")) {
    b.classList.toggle("sel", b.dataset.lobbymodus === r.settings.modus);
  }
  for (const b of document.querySelectorAll("[data-selbst]")) {
    b.classList.toggle("sel", (b.dataset.selbst === "ja") === r.settings.selbst);
  }
  for (const b of document.querySelectorAll("[data-rounds]")) {
    b.classList.toggle("sel", Number(b.dataset.rounds) === r.settings.rounds);
  }
  for (const b of document.querySelectorAll("[data-lobbyvis]")) {
    b.classList.toggle("sel", (b.dataset.lobbyvis === "public") === r.isPublic);
  }

  // Wer gerade weg ist, zählt nicht mit – sonst blockiert er den Start.
  const here = r.players.filter((p) => p.connected);
  const others = here.filter((p) => p.id !== r.hostId);
  const allReady = others.every((p) => p.ready);
  $("startBtn").disabled = here.length < r.minPlayers || !allReady;
  $("startHint").textContent = here.length < r.minPlayers
    ? `Zu dritt geht es los – zu zweit kann man nur sich oder den anderen wählen.`
    : allReady
    ? "Alle bereit!"
    : "Warten auf die anderen …";

  $("readyBtn").textContent = me?.ready ? "Doch nicht bereit" : "Bereit!";
  $("readyBtn").classList.toggle("on", !!me?.ready);
}

$("readyBtn").addEventListener("click", () => {
  const me = state.room?.players.find((p) => p.id === state.you);
  send({ t: "ready", value: !me?.ready });
});

$("startBtn").addEventListener("click", () => send({ t: "start" }));
$("leaveBtn").addEventListener("click", verlassen);

for (const b of document.querySelectorAll("[data-lobbymodus]")) {
  b.addEventListener("click", () => send({ t: "settings", modus: b.dataset.lobbymodus }));
}
for (const b of document.querySelectorAll("[data-selbst]")) {
  b.addEventListener("click", () => send({ t: "settings", selbst: b.dataset.selbst === "ja" }));
}
for (const b of document.querySelectorAll("[data-rounds]")) {
  b.addEventListener("click", () => send({ t: "settings", rounds: Number(b.dataset.rounds) }));
}
for (const b of document.querySelectorAll("[data-lobbyvis]")) {
  b.addEventListener("click", () =>
    send({ t: "settings", isPublic: b.dataset.lobbyvis === "public" })
  );
}

$("copyBtn").addEventListener("click", async () => {
  const link = location.origin + location.pathname + "#" + (state.code ?? "");
  try {
    await navigator.clipboard.writeText(link);
    toast("Link kopiert");
  } catch {
    // Ohne Zwischenablage (http, altes Handy) bleibt nur Vorlesen.
    toast(link);
  }
});

// ---------------------------------------------------------------------------
// Spielbildschirm
// ---------------------------------------------------------------------------

function knopf(label, cls, fn) {
  const b = document.createElement("button");
  b.className = "btn " + cls;
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

function renderRunde() {
  const r = state.runde;
  if (!r || state.room?.phase !== "playing") return;
  show("game");

  const isHost = state.room.hostId === state.you;

  $("rundeNo").textContent = String(r.n);
  $("rundeTotal").textContent = r.total ? ` / ${r.total}` : "";
  $("modusTag").textContent = MODUS_TEXT[state.room.settings.modus];
  $("endeBtn").hidden = !isHost;

  $("frageText").textContent = r.frage ?? "";

  // --- Abstimmung ----------------------------------------------------------
  const gitter = $("wahlGitter");
  const liste = $("ergebnisListe");
  gitter.hidden = r.schritt !== "abstimmen";
  liste.hidden = r.schritt !== "aufloesung";

  if (r.schritt === "abstimmen") {
    gitter.textContent = "";
    for (const w of r.waehlbar) {
      const selbst = w.id === state.you;
      if (selbst && !r.selbstErlaubt) continue;
      const b = document.createElement("button");
      b.className = "wahl" + (r.meineStimme === w.id ? " gewaehlt" : "") +
        (selbst ? " ich" : "");
      b.innerHTML = `<span class="wahl-av">${avatarFor(w.id)}</span>
        <span class="wahl-name">${escapeHtml(w.name)}${selbst ? " (du)" : ""}</span>`;
      b.addEventListener("click", () => send({ t: "stimme", ziel: w.id }));
      gitter.append(b);
    }
  }

  const zahl = $("stimmenZahl");
  zahl.textContent = r.schritt === "abstimmen"
    ? `${r.stimmenAb} von ${r.stimmenGesamt} haben gewählt`
    : "";

  // --- Auflösung -----------------------------------------------------------
  if (r.schritt === "aufloesung" && r.ergebnis) {
    liste.textContent = "";
    const hoechst = r.ergebnis[0]?.stimmen ?? 0;
    const gesamt = r.ergebnis.reduce((s, e) => s + e.stimmen, 0) || 1;

    const kopf = document.createElement("li");
    kopf.className = "erg-kopf";
    const spitze = r.ergebnis.filter((e) => e.krone);
    kopf.textContent = hoechst === 0
      ? "Keine Stimme vergeben."
      : spitze.length === 1
      ? `${spitze[0].name} – mit ${hoechst} Stimme${hoechst === 1 ? "" : "n"}.`
      : `Gleichstand: ${spitze.map((e) => e.name).join(" und ")}.`;
    liste.append(kopf);

    for (const e of r.ergebnis) {
      const li = document.createElement("li");
      li.className = "erg" + (e.krone ? " krone" : "") +
        (e.stimmen === 0 ? " null" : "") + (e.id === state.you ? " ich" : "");
      // Der Balken ist ein Hintergrund-Verlauf, keine eigene Box: so bleibt der
      // Text lesbar, egal wie lang der Balken wird.
      li.style.setProperty("--anteil", `${(e.stimmen / gesamt) * 100}%`);
      li.innerHTML = `
        <span class="erg-av">${avatarFor(e.id)}</span>
        <span class="erg-body">
          <span class="erg-name">${escapeHtml(e.name)}${e.krone ? " 👑" : ""}</span>
          <span class="erg-waehler">${
        e.waehler.length ? escapeHtml(e.waehler.join(", ")) : "—"
      }</span>
        </span>
        <span class="erg-zahl">${e.stimmen}</span>`;
      liste.append(li);
    }
  }

  // --- Knöpfe --------------------------------------------------------------
  const box = $("aktionen");
  box.textContent = "";
  let hint = "";

  if (r.schritt === "abstimmen") {
    if (r.meineStimme == null) {
      hint = "Aufgedeckt wird erst, wenn alle gewählt haben.";
    } else {
      hint = "Gewählt. Du kannst noch umentscheiden, solange nicht alle durch sind.";
    }
    if (isHost) {
      box.append(knopf("Andere Frage", "ghost sm", () => send({ t: "andere" })));
      box.append(knopf("Trotzdem auflösen", "ghost sm", () => send({ t: "aufloesen" })));
    }
  } else if (r.schritt === "aufloesung") {
    if (isHost) {
      box.append(knopf("Weiter", "primary big", () => send({ t: "weiter" })));
      hint = r.total && r.n >= r.total ? "Das war die letzte Runde." : "";
    } else {
      hint = "Weiter geht’s, sobald der Host drückt.";
    }
  }

  $("rundenHint").textContent = hint;
  renderPunktleiste();
}

function renderPunktleiste() {
  const r = state.room;
  if (!r) return;
  const bar = $("punktleiste");
  bar.textContent = "";
  const sorted = r.players.slice().sort((a, b) => b.punkte - a.punkte);
  for (const p of sorted) {
    const chip = document.createElement("div");
    chip.className = "chip" + (p.id === state.you ? " me" : "") +
      (p.connected ? "" : " gone");
    chip.innerHTML = `
      <span class="chip-av">${avatarFor(p.id)}</span>
      <span class="chip-name">${escapeHtml(p.name)}</span>
      <span class="chip-zahl">${p.punkte}</span>`;
    bar.append(chip);
  }
}

$("endeBtn").addEventListener("click", () => send({ t: "ende" }));

// ---------------------------------------------------------------------------
// Endstand
// ---------------------------------------------------------------------------

function renderFinal(msg) {
  show("final");
  const t = msg.tabelle;
  $("finalSub").textContent = `${msg.runden} Runde${msg.runden === 1 ? "" : "n"} gespielt`;

  const ol = $("podium");
  ol.textContent = "";
  const maxPunkte = Math.max(...t.map((p) => p.punkte), 0);
  for (const p of t) {
    const li = document.createElement("li");
    li.className = "podest" + (p.id === state.you ? " me" : "") +
      (maxPunkte > 0 && p.punkte === maxPunkte ? " sieg" : "");
    const titel = maxPunkte > 0 && p.punkte === maxPunkte
      ? "der Dauerbrenner"
      : p.punkte === 0
      ? "kein einziges Mal gemeint"
      : p.kronen
      ? `${p.kronen}× eine Runde angeführt`
      : "";
    li.innerHTML = `
      <span class="podest-av">${avatarFor(p.id)}</span>
      <span class="podest-name">${escapeHtml(p.name)}
        ${titel ? `<small>${escapeHtml(titel)}</small>` : ""}</span>
      <span class="podest-zahl">${p.punkte}<small>Stimmen</small></span>`;
    ol.append(li);
  }

  const isHost = state.room?.hostId === state.you;
  $("againBtn").hidden = !isHost;
  $("againHint").textContent = isHost
    ? "Zurück in den Warteraum – dort könnt ihr die Fragen umstellen."
    : "Der Host holt alle zurück in den Warteraum.";
}

$("againBtn").addEventListener("click", () => send({ t: "again" }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

try {
  const gemerkt = localStorage.getItem(NAME_KEY);
  if (gemerkt) $("name").value = gemerkt;
} catch { /* egal */ }

// Geteilter Link mit #CODE: Code eintragen und – wenn der Name schon feststeht –
// direkt beitreten.
const hash = location.hash.replace("#", "").toUpperCase().trim();
if (hash.length >= 3 && hash.length <= 5) {
  $("codeInput").value = hash;
  if (!session()?.token && $("name").value.trim()) {
    state.pendingIntent = { t: "join", code: hash, name: meinName() };
  }
}

setModus("gemischt");
connect();
