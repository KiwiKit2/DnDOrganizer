// Minimal WebSocket relay for DnDex (rooms + broadcast)
// Deploy on Render/Railway/Fly/Heroku or run locally.

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8787;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end('DnDex Relay: OK');
});

const wss = new WebSocket.Server({ server });

// room => Set<ws>
const rooms = new Map();

function joinRoom(ws, room) {
  ws._room = room;
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
}

function leaveRoom(ws) {
  const room = ws._room;
  if (!room) return;
  const set = rooms.get(room);
  if (set) {
    set.delete(ws);
    if (set.size === 0) rooms.delete(room);
  }
}

function broadcastToRoom(room, data, except) {
  const set = rooms.get(room);
  if (!set) return;
  for (const client of set) {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Heartbeat to clean dead sockets
function heartbeat() { this.isAlive = true; }
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg && msg.type === 'join' && msg.room) {
      leaveRoom(ws); // in case
      joinRoom(ws, String(msg.room));
      ws._name = msg.name || '';
      ws._role = msg.role || 'player';
      // ack
      try { ws.send(JSON.stringify({ type: 'joined', room: ws._room })); } catch {}
      return;
    }
    // For other messages, broadcast to the joined room
    const room = ws._room || msg?.room; // prefer joined room
    if (!room) return;
    // Ensure room tag is correct
    try { msg.room = room; } catch {}
    broadcastToRoom(room, JSON.stringify(msg), ws);
  });

  ws.on('close', () => { leaveRoom(ws); });
  ws.on('error', () => { leaveRoom(ws); });
});

// Ping interval
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

wss.on('close', () => { clearInterval(interval); });

server.listen(PORT, () => {
  console.log(`DnDex Relay listening on :${PORT}`);
});
