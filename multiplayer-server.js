const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 10000);
const MAX_PLAYERS = 100;
const rooms = new Map();

function safeName(value) {
  return String(value || "Player").replace(/[^\p{L}\p{N}_ -]/gu, "").trim().slice(0, 18) || "Player";
}
function roomName(value) {
  return String(value || "Lorencia").replace(/[^\w -]/g, "").trim().slice(0, 24) || "Lorencia";
}
function snapshot(room) {
  return [...room.values()].map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, map: p.map, joinedAt: p.joinedAt }));
}
function broadcast(room, payload, except) {
  const data = JSON.stringify(payload);
  for (const p of room.values()) {
    if (p.ws !== except && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}
function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, new Map());
  return rooms.get(name);
}
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.url === "/health" || req.url === "/") {
    const online = [...rooms.values()].reduce((n, room) => n + room.size, 0);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ status: "ok", service: "mu-online-multiplayer-gateway", online, rooms: rooms.size, gameplaySync: "gateway-ready; original WASM game engine is client-side solo" }));
  }
  res.writeHead(404); res.end("Not found");
});
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
wss.on("connection", (ws) => {
  if ([...rooms.values()].reduce((n, room) => n + room.size, 0) >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: "error", message: "Servidor cheio. Tente novamente mais tarde." }));
    return ws.close(1013, "Server full");
  }
  const player = { id: Math.random().toString(36).slice(2, 10), name: "Player", map: "Lorencia", x: 0, y: 0, joinedAt: Date.now(), ws, roomName: null };
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "join") {
      const nextRoomName = roomName(msg.room);
      const nextName = safeName(msg.name);
      if (player.roomName) {
        const oldRoom = rooms.get(player.roomName);
        if (oldRoom) { oldRoom.delete(player.id); broadcast(oldRoom, { type: "leave", id: player.id }); if (!oldRoom.size) rooms.delete(player.roomName); }
      }
      player.roomName = nextRoomName; player.name = nextName;
      const room = getRoom(nextRoomName);
      room.set(player.id, player);
      ws.send(JSON.stringify({ type: "welcome", id: player.id, room: nextRoomName, players: snapshot(room) }));
      broadcast(room, { type: "join", player: { id: player.id, name: player.name, x: player.x, y: player.y, map: player.map } }, ws);
      broadcast(room, { type: "system", text: player.name + " entrou na sala." });
      return;
    }
    if (!player.roomName) return;
    const room = rooms.get(player.roomName);
    if (!room) return;
    if (msg.type === "chat") {
      const text = String(msg.text || "").trim().slice(0, 240);
      if (text) broadcast(room, { type: "chat", id: player.id, name: player.name, text, at: Date.now() });
    } else if (msg.type === "move") {
      const x = Number(msg.x), y = Number(msg.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        player.x = Math.max(-100000, Math.min(100000, x));
        player.y = Math.max(-100000, Math.min(100000, y));
        player.map = roomName(msg.map || player.map);
        broadcast(room, { type: "move", id: player.id, x: player.x, y: player.y, map: player.map }, ws);
      }
    } else if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong", at: msg.at || Date.now() }));
  });
  ws.on("close", () => {
    if (!player.roomName) return;
    const room = rooms.get(player.roomName);
    if (room) { room.delete(player.id); broadcast(room, { type: "leave", id: player.id }); broadcast(room, { type: "system", text: player.name + " saiu da sala." }); if (!room.size) rooms.delete(player.roomName); }
  });
  ws.on("error", () => {});
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));
server.listen(PORT, "0.0.0.0", () => console.log("MU multiplayer gateway listening on " + PORT));
