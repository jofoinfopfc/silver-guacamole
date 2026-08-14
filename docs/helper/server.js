'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const HELPER_VERSION = process.env.HELPER_VERSION || '1.0.0';
const STALE_AFTER_MS = Number(process.env.STALE_AFTER_MS || 20000);
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'http://localhost:5500')
  .split(',').map((value) => value.trim()).filter(Boolean));

const peers = new Map();
const broadcasts = new Map();
const helpRequests = [];
const routes = new Map();

function originAllowed(origin) {
  return !origin || allowedOrigins.has(origin);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (originAllowed(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin || '*');
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');
  }
}

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function body(request, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) reject(new Error('Request body too large'));
    });
    request.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function publicStream(room) {
  const active = [...broadcasts.values()].filter((item) => !room || item.room === room);
  const item = active[0];
  return item ? {
    success: true, online: true, broadcasting: true,
    deviceName: item.deviceName, peerId: item.peerId,
    room: item.room, hasAudio: item.hasAudio
  } : { success: true, online: true, broadcasting: false, deviceName: process.env.DEVICE_NAME || 'LAN Helper' };
}

function sendPeer(peerId, message) {
  const peer = peers.get(peerId);
  if (!peer || peer.socket.readyState !== WebSocket.OPEN) return false;
  peer.socket.send(JSON.stringify(message));
  return true;
}

function signalMessage(sender, message) {
  if (!message || typeof message.type !== 'string') return;
  const allowed = new Set(['join', 'broadcast', 'viewer-join', 'offer', 'answer', 'ice', 'broadcast-stop']);
  if (!allowed.has(message.type)) return;

  if (message.type === 'join') {
    if (typeof message.peerId !== 'string' || message.peerId.length < 3 || message.peerId.length > 100) return;
    sender.peerId = message.peerId;
    sender.room = typeof message.room === 'string' ? message.room.slice(0, 100) : '';
    peers.set(sender.peerId, sender);
    return;
  }
  if (!sender.peerId) return;

  if (message.type === 'broadcast') {
    const room = typeof message.room === 'string' ? message.room.slice(0, 100) : '';
    broadcasts.set(sender.peerId, { peerId: sender.peerId, room, deviceName: String(message.deviceName || 'Unnamed device').slice(0, 100), hasAudio: Boolean(message.hasAudio), updatedAt: Date.now() });
    sender.room = room;
    return;
  }
  if (message.type === 'broadcast-stop') {
    broadcasts.delete(sender.peerId);
    for (const [key, route] of routes) if (route.broadcasterId === sender.peerId) routes.delete(key);
    return;
  }

  const targetId = typeof message.to === 'string' ? message.to : routes.get(sender.peerId)?.broadcasterId;
  if (message.type === 'viewer-join') {
    if (!targetId || !peers.has(targetId)) return;
    routes.set(sender.peerId, { broadcasterId: targetId, room: message.room || '' });
    sendPeer(targetId, { ...message, peerId: sender.peerId });
    return;
  }

  if (!targetId) return;
  const targetMessage = { ...message, peerId: sender.peerId };
  sendPeer(targetId, targetMessage);
}

function handleDisconnect(peer) {
  if (peer.peerId) {
    peers.delete(peer.peerId);
    broadcasts.delete(peer.peerId);
    routes.delete(peer.peerId);
    for (const [key, route] of routes) if (route.broadcasterId === peer.peerId) { sendPeer(key, { type: 'close' }); routes.delete(key); }
  }
}

function requestHandler(request, response) {
  applyCors(request, response);
  if (!originAllowed(request.headers.origin)) return json(response, 403, { success: false, error: 'Origin not allowed' });
  if (request.method === 'OPTIONS') { response.statusCode = 204; return response.end(); }
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { success: true, online: true, version: HELPER_VERSION });
  if (request.method === 'GET' && url.pathname === '/api/stream') return json(response, 200, publicStream(url.searchParams.get('room') || ''));
  if (request.method === 'POST' && (url.pathname === '/api/help/test' || url.pathname === '/api/help')) {
    return body(request).then((data) => {
      if (url.pathname.endsWith('/test') || data.test === true) return json(response, 200, { success: true, test: true });
      const requestItem = { id: `help-${Date.now()}-${Math.random().toString(16).slice(2)}`, peerId: String(data.peerId || '').slice(0, 100), deviceName: String(data.deviceName || '').slice(0, 100), room: String(data.room || '').slice(0, 100), reason: String(data.reason || 'computer-problem').slice(0, 100), message: String(data.message || '').slice(0, 1000), status: 'pending', createdAt: new Date().toISOString() };
      helpRequests.push(requestItem);
      return json(response, 202, { success: true, ...requestItem });
    }).catch((error) => json(response, error.status || 400, { success: false, error: error.message }));
  }
  return json(response, 404, { success: false, error: 'Not found' });
}

const tlsEnabled = process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE;
const server = tlsEnabled
  ? https.createServer({ cert: fs.readFileSync(path.resolve(process.env.TLS_CERT_FILE)), key: fs.readFileSync(path.resolve(process.env.TLS_KEY_FILE)) }, requestHandler)
  : http.createServer(requestHandler);
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
server.on('upgrade', (request, socket, head) => {
  if (!originAllowed(request.headers.origin) || new URL(request.url, `${tlsEnabled ? 'https' : 'http'}://${request.headers.host}`).pathname !== '/ws') return socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});
wss.on('connection', (socket) => {
  const peer = { socket, peerId: '', room: '', connectedAt: Date.now() };
  socket.on('message', (data) => { try { signalMessage(peer, JSON.parse(data.toString())); } catch { socket.close(1003, 'Invalid JSON'); } });
  socket.on('close', () => handleDisconnect(peer));
  socket.on('error', () => handleDisconnect(peer));
});

setInterval(() => {
  const cutoff = Date.now() - STALE_AFTER_MS;
  for (const [id, item] of broadcasts) if (item.updatedAt < cutoff && !peers.has(id)) broadcasts.delete(id);
}, Math.max(5000, STALE_AFTER_MS)).unref();

server.listen(tlsEnabled ? Number(process.env.HTTPS_PORT || 8443) : PORT, HOST, () => {
  const protocol = tlsEnabled ? 'https' : 'http';
  console.log(`LAN helper listening on ${protocol}://${HOST}:${tlsEnabled ? process.env.HTTPS_PORT || 8443 : PORT}`);
  console.log(`Allowed browser origins: ${[...allowedOrigins].join(', ')}`);
  console.log('Media relay: NONE (signaling JSON only)');
});