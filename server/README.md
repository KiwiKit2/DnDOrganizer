# DnDex Relay Server

A tiny WebSocket relay that lets browsers in the same room sync boards in real time.

- Node.js server with `ws`
- Room-based broadcast
- Health check at `/`
- Deploy on Render/Railway/Fly/Heroku, or run locally

## Run locally

```bash
npm install
npm start
```

By default it listens on `http://localhost:8787` (WebSocket `ws://localhost:8787`).

## Deploy

- Render: Create a Web Service, repo path `server/`, Build `npm install`, Start `npm start`.
- Railway: Create a service from this folder.
- Fly.io/Heroku: Standard Node deployment.

Use the public `wss://` URL in DnDex under Server URL.
