# LAN Screen Broadcast

Static GitHub Pages frontend for direct LAN screen sharing. GitHub Pages hosts only HTML, CSS, and JavaScript. A selected LAN helper provides discovery, signaling, help, and diagnostics; it must never proxy media. Screen and audio use native WebRTC directly between broadcaster and viewers.

## Deploy and configure

1. Edit `config.js` with exactly ten helper URLs. Empty strings are allowed until configured; `config.example.js` shows sample addresses only.
2. Commit and enable GitHub Pages for the branch/folder containing `index.html`.
3. Serve the page over HTTPS. Screen capture requires a secure context.
4. Configure helper CORS for the exact GitHub Pages origin and use HTTPS helpers from an HTTPS page.

Settings can override URLs, polling interval, timeout, and ICE servers in browser localStorage. The browser stores a persistent random peer ID, never an IP address.

## Required helper API

* `GET /api/health` -> HTTP 200 JSON, preferably `{success:true,version:"1.0.0"}`.
* `GET /api/stream[?room=A101]` -> `{success,online,broadcasting,deviceName,peerId,room,hasAudio}`. `success`, `online`, and `broadcasting` are required; active broadcasts need `peerId`.
* `POST /api/help` -> `{peerId,deviceName,room,reason,message}` and a status (`pending`, `acknowledged`, `resolved`, or `cancelled`).
* `POST /api/help/test` -> `{test:true}` and returns `{success:true,test:true}` without creating a request.
* `WSS /ws` -> JSON signaling only: `join`, `broadcast`, `viewer-join`, `offer`, `answer`, `ice`, and `broadcast-stop`. Route by `peerId`, `to`, and `room`; reject media payloads.

The helper must support CORS and OPTIONS for these routes and determine client IP itself. It is not included in this repository.

## Architecture and operation

The frontend polls all ten endpoints concurrently every five seconds with individual timeouts and `Promise.allSettled()`. Live cards retain their helper association; WATCH uses that helper's signaling endpoint. The broadcaster calls `getDisplayMedia({video:true,audio:true})`, creates one `RTCPeerConnection` per viewer, and cleans tracks/connections on stop or capture end. The viewer queues ICE candidates until the remote description is set. Candidate-pair stats are displayed only when actually exposed by the browser.

The helper exchanges SDP and ICE only. GitHub Pages and the helper carry no screen or audio. A configured TURN server may relay WebRTC media as required by WebRTC networking, but it is not GitHub Pages or the discovery helper.

## Diagnostics and limitations

Quick/full diagnostics, endpoint testing, temporary WebRTC/DataChannel testing, explicit screen-capture testing, Raise Help testing, in-page logs, copy, and local report download are included. Reports exclude media, credentials, cookies, tokens, screen, and audio. Production broadcast connections are not used by diagnostics.

Target current desktop Chrome/Chromium. `iceServers: []` suits many same-LAN deployments but not routed, firewalled, or isolated networks. Wi-Fi client isolation, VLAN ACLs, Windows Firewall, certificates, CORS, and mixed content can prevent operation. Test with two browsers on the real LAN: run endpoint/quick tests, capture test, start broadcast, WATCH from another browser, verify video/audio and ICE path, test multiple viewers, stop, server switching, help, and reports.

Helper compatibility, certificates, actual signaling, screen/audio delivery, and direct LAN ICE are **Requires LAN environment test** from this repository-only environment. The frontend does not fake those PASS results.