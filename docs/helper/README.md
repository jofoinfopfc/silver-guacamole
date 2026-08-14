# LAN Helper Server

This is the separate LAN service required by the static GitHub Pages frontend. It provides discovery, JSON signaling, Raise Help, and health checks. It never receives, stores, forwards, decodes, or relays screen video/audio. WebRTC media remains between browsers; a configured TURN server is a separate WebRTC component.

## Install and run

Requirements: Node.js 18+ on the LAN machine.

```powershell
cd helper
npm install
$env:ALLOWED_ORIGINS='https://jofoinfopfc.github.io'
$env:PORT='8080'
npm start
```

The standalone `server.py` uses two adjacent non-standard ports: HTTP APIs on `8765` and WebSocket signaling on `8766`. The frontend configuration includes `api.signalingPortOffset: 1` for this Python helper. The Node helper uses one port for both protocols; set `signalingPortOffset: 0` in the frontend configuration when using Node.

Run the standalone Python helper without installing packages:

```powershell
$env:PORT='8765'
$env:ALLOWED_ORIGINS='https://jofoinfopfc.github.io'
py server.py
```

For GitHub Pages HTTPS, an HTTPS Python helper requires a TLS-capable wrapper or reverse proxy for both ports to avoid mixed-content blocking. The current Python file is HTTP/WS for controlled LAN testing. A self-signed certificate must be trusted in every browser; otherwise the browser will report a TLS/certificate failure.

## API

* `GET /api/health` returns helper/version status.
* `GET /api/stream?room=A101` returns the current in-memory broadcast status.
* `POST /api/help` stores a bounded in-memory pending request and returns its ID/status. It does not persist requests.
* `POST /api/help/test` returns `{success:true,test:true}` and creates nothing.
* `WSS /ws` accepts JSON `join`, `broadcast`, `viewer-join`, `offer`, `answer`, `ice`, and `broadcast-stop` messages and routes them by peer ID.

The current helper is intentionally a single-process, in-memory LAN helper. Restarting it clears status/help requests. Put it behind a controlled LAN firewall and do not expose it to the public Internet. Add authentication and durable help storage before production-wide deployment.

## Frontend configuration

Configure all ten helper URLs in the static site's Settings UI or `config.js`. For HTTP-only local testing, use `http://LAN-IP:8080` while serving the frontend from an allowed local origin. For the deployed GitHub Pages site, use HTTPS helper URLs and include `https://jofoinfopfc.github.io` in `ALLOWED_ORIGINS`.

## Test

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/health
Invoke-RestMethod http://127.0.0.1:8080/api/stream
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{"test":true}' http://127.0.0.1:8080/api/help/test
```

Actual two-browser screen capture, signaling, ICE, audio, CORS, certificate, firewall, and LAN routing tests remain required in the target environment.