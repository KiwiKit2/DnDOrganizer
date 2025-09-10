// Tiny WebSocket relay: broadcasts messages to clients in the same room.
// Usage: node server/relay.js 8787
const http = require('http');
const WebSocket = require('ws');

const port = parseInt(process.argv[2]||process.env.PORT||8787,10);
const server = http.createServer();
const wss = new WebSocket.Server({ server });

const rooms = new Map(); // room -> Set<WebSocket>

function joinRoom(ws, room){
  if(!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws._room = room;
}
function leaveRoom(ws){
  const r = ws._room; if(!r) return; const set = rooms.get(r); if(set){ set.delete(ws); if(!set.size) rooms.delete(r); }
  ws._room = null;
}

wss.on('connection', (ws)=>{
  ws.on('message', (data)=>{
    let msg; try{ msg = JSON.parse(data.toString()); }catch{ return; }
    if(msg.type==='join' && msg.room){ joinRoom(ws, msg.room); return; }
    const room = msg.room || ws._room; if(!room) return;
    const set = rooms.get(room); if(!set) return;
    // Broadcast to others in the room
    for(const client of set){ if(client!==ws && client.readyState===WebSocket.OPEN){ try{ client.send(JSON.stringify(msg)); }catch{} } }
  });
  ws.on('close', ()=> leaveRoom(ws));
});

server.listen(port, ()=> console.log('WS relay listening on ws://localhost:'+port));
