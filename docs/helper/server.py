"""Standalone LAN helper for the static WebRTC frontend.

Standard library only. This service exchanges JSON signaling messages and
status metadata; it never receives or relays screen/audio media.
"""
import base64
import hashlib
import json
import os
import socket
import socketserver
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8765"))
HELPER_VERSION = os.getenv("HELPER_VERSION", "1.0.0")
STALE_AFTER = int(os.getenv("STALE_AFTER_MS", "20000")) / 1000
ALLOWED_ORIGINS = {x.strip() for x in os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:5500"
).split(",") if x.strip()}

LOCK = threading.RLock()
PEERS = {}
BROADCASTS = {}
HELP_REQUESTS = []


def origin_allowed(origin):
    return not origin or origin in ALLOWED_ORIGINS


def json_bytes(value):
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


def send_json(handler, status, value):
    data = json_bytes(value)
    handler.send_response(status)
    handler.cors()
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def public_stream(room):
    with LOCK:
        items = [x for x in BROADCASTS.values() if not room or x["room"] == room]
        item = items[0] if items else None
    if not item:
        return {"success": True, "online": True, "broadcasting": False,
                "deviceName": os.getenv("DEVICE_NAME", "LAN Helper")}
    return {"success": True, "online": True, "broadcasting": True,
            "deviceName": item["deviceName"], "peerId": item["peerId"],
            "room": item["room"], "hasAudio": item["hasAudio"]}


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "LANHelper/1.0"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin or "*")
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type,Accept")

    def do_OPTIONS(self):
        if not origin_allowed(self.headers.get("Origin", "")):
            send_json(self, 403, {"success": False, "error": "Origin not allowed"})
            return
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if not origin_allowed(self.headers.get("Origin", "")):
            send_json(self, 403, {"success": False, "error": "Origin not allowed"})
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_response(200)
            self.cors()
            data = json_bytes({"success": True, "online": True, "version": HELPER_VERSION})
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/api/stream":
            send_json(self, 200, public_stream(parse_qs(parsed.query).get("room", [""])[0]))
            return
        send_json(self, 404, {"success": False, "error": "Not found"})

    def do_POST(self):
        if not origin_allowed(self.headers.get("Origin", "")):
            send_json(self, 403, {"success": False, "error": "Origin not allowed"})
            return
        parsed = urlparse(self.path)
        if parsed.path not in ("/api/help", "/api/help/test"):
            send_json(self, 404, {"success": False, "error": "Not found"})
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 131072)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            send_json(self, 400, {"success": False, "error": "Invalid JSON"})
            return
        if parsed.path.endswith("/test") or data.get("test") is True:
            send_json(self, 200, {"success": True, "test": True})
            return
        request_item = {
            "id": f"help-{int(time.time() * 1000)}",
            "peerId": str(data.get("peerId", ""))[:100],
            "deviceName": str(data.get("deviceName", ""))[:100],
            "room": str(data.get("room", ""))[:100],
            "reason": str(data.get("reason", "computer-problem"))[:100],
            "message": str(data.get("message", ""))[:1000],
            "status": "pending",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        with LOCK:
            HELP_REQUESTS.append(request_item)
        send_json(self, 202, {"success": True, **request_item})


def ws_frame(payload):
    payload = payload.encode("utf-8")
    length = len(payload)
    if length < 126:
        header = bytes([0x81, length])
    elif length < 65536:
        header = bytes([0x81, 126]) + struct.pack(">H", length)
    else:
        header = bytes([0x81, 127]) + struct.pack(">Q", length)
    return header + payload


def read_ws_frame(connection):
    header = connection.recv(2)
    if len(header) < 2:
        return None
    _fin_opcode, length_byte = header
    masked = bool(length_byte & 0x80)
    length = length_byte & 0x7F
    if length == 126:
        length = struct.unpack(">H", connection.recv(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", connection.recv(8))[0]
    if length > 131072 or not masked:
        return None
    mask = connection.recv(4)
    payload = bytearray(connection.recv(length))
    for index in range(len(payload)):
        payload[index] ^= mask[index % 4]
    return bytes(payload).decode("utf-8")


class WebSocketHandler(socketserver.BaseRequestHandler):
    def setup(self):
        self.peer_id = ""
        self.room = ""
        self.request.settimeout(60)

    def send(self, message):
        try:
            self.request.sendall(ws_frame(json.dumps(message, separators=(",", ":"))))
        except OSError:
            pass

    def route(self, message):
        kind = message.get("type")
        if kind == "join":
            peer_id = str(message.get("peerId", ""))
            if not 3 <= len(peer_id) <= 100:
                return
            self.peer_id = peer_id
            self.room = str(message.get("room", ""))[:100]
            with LOCK:
                PEERS[peer_id] = self
            return
        if not self.peer_id:
            return
        if kind == "broadcast":
            with LOCK:
                BROADCASTS[self.peer_id] = {
                    "peerId": self.peer_id,
                    "room": str(message.get("room", ""))[:100],
                    "deviceName": str(message.get("deviceName", "Unnamed device"))[:100],
                    "hasAudio": bool(message.get("hasAudio")),
                    "updated": time.time(),
                }
            return
        if kind == "broadcast-stop":
            with LOCK:
                BROADCASTS.pop(self.peer_id, None)
            return
        target_id = message.get("to")
        if kind == "viewer-join":
            target_id = str(target_id or "")
        if not target_id:
            return
        with LOCK:
            target = PEERS.get(target_id)
        if target:
            forwarded = dict(message)
            forwarded["peerId"] = self.peer_id
            target.send(forwarded)

    def handle(self):
        try:
            request = self.request.recv(4096)
            headers = request.decode("latin1", "ignore").split("\r\n")
            values = dict(line.split(": ", 1) for line in headers[1:] if ": " in line)
            if values.get("Origin") and not origin_allowed(values["Origin"]):
                self.request.close()
                return
            key = values.get("Sec-WebSocket-Key")
            if not key or " /ws " not in headers[0]:
                self.request.close()
                return
            accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"
            self.request.sendall(response.encode("ascii"))
            while True:
                frame = read_ws_frame(self.request)
                if frame is None:
                    break
                try:
                    self.route(json.loads(frame))
                except (ValueError, TypeError):
                    break
        except (OSError, socket.timeout):
            pass
        finally:
            with LOCK:
                if self.peer_id:
                    PEERS.pop(self.peer_id, None)
                    BROADCASTS.pop(self.peer_id, None)


class ThreadingWebSocketServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def cleanup():
    while True:
        time.sleep(max(5, STALE_AFTER))
        with LOCK:
            now = time.time()
            for peer_id, item in list(BROADCASTS.items()):
                if peer_id not in PEERS and now - item["updated"] > STALE_AFTER:
                    BROADCASTS.pop(peer_id, None)


if __name__ == "__main__":
    threading.Thread(target=cleanup, daemon=True).start()
    http_server = ThreadingHTTPServer((HOST, PORT), ApiHandler)
    ws_server = ThreadingWebSocketServer((HOST, PORT + 1), WebSocketHandler)
    threading.Thread(target=http_server.serve_forever, daemon=True).start()
    print(f"HTTP helper: http://{HOST}:{PORT}")
    print(f"WebSocket signaling: ws://{HOST}:{PORT + 1}/ws")
    print(f"Allowed origins: {', '.join(sorted(ALLOWED_ORIGINS))}")
    print("Media relay: NONE")
    try:
        ws_server.serve_forever()
    except KeyboardInterrupt:
        http_server.shutdown()
        ws_server.shutdown()