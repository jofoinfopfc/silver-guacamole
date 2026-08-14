import { $, log, parseRoom, download } from './utils.js';
import { config, saveConfig, resetConfig } from './config.js';
import { scanAll } from './discovery.js';
import { Broadcaster } from './broadcaster.js';
import { Viewer } from './viewer.js';
import { sendHelp } from './help.js';
import { Diagnostics } from './diagnostics.js';

const room = parseRoom();
let rows = [];
let selected = null;
const broadcaster = new Broadcaster();

broadcaster.onState = (state) => {
  $('broadcastStatus').textContent = state;
  $('startBroadcast').disabled = state === 'BROADCASTING';
  $('stopBroadcast').disabled = state !== 'BROADCASTING';
};

const viewer = new Viewer($('remoteVideo'),
  (state) => { $('viewerStatus').textContent = state; },
  (path) => { $('pathStatus').textContent = path ? `${path.type}: ${path.local || '?'} -> ${path.remote || '?'}` : 'P2P PATH COULD NOT BE VERIFIED'; }
);
const diagnostics = new Diagnostics();

function notify(message) { $('notice').textContent = message; }

function streamCard(item, index) {
  const stream = item.stream;
  const live = Boolean(stream && stream.broadcasting);
  const online = item.status === 'ONLINE';
  const cardClass = live ? 'live' : online ? 'idle' : 'offline';
  const name = stream?.deviceName || item.base;
  const roomText = stream?.room ? `Room ${stream.room}<br>` : '';
  const audioText = stream?.hasAudio ? ' - Audio: YES' : '';
  const button = live ? `<button data-watch="${index}">WATCH</button>` : '';
  return [
    `<div class="stream ${cardClass}">`,
    `<strong>${live ? '[LIVE]' : '[IDLE]'} ${name}</strong>`,
    `<p>${roomText}${item.base}<br><b>${live ? 'LIVE' : online ? 'IDLE' : item.status}</b>${audioText}</p>`,
    button,
    '</div>'
  ].join('');
}

function render() {
  const liveRows = rows.filter((item) => item.stream?.broadcasting);
  $('broadcastCount').textContent = `${liveRows.length} found`;
  const configuredRows = rows.filter((item) => item.base);
  $('streams').innerHTML = configuredRows.length ? configuredRows.map(streamCard).join('') : '<p class="muted">Configure endpoints to begin discovery.</p>';
  document.querySelectorAll('[data-watch]').forEach((button) => {
    button.onclick = () => watch(rows[Number(button.dataset.watch)]);
  });
}

async function scan() {
  try {
    rows = await scanAll(room);
    render();
    const online = rows.filter((item) => item.status === 'ONLINE').length;
    $('scanStatus').textContent = `${online}/10 endpoints reachable - last scan ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    $('scanStatus').textContent = `Scan failed: ${error.message}`;
    log(`Discovery failed: ${error.message}`, 'FAIL');
  }
}

function watch(item) {
  selected = item;
  viewer.watch(item).catch((error) => notify(`${error.code || 'SIG-001'}: ${error.message}`));
  $('stopWatching').disabled = false;
  $('reconnect').disabled = false;
}

function setup() {
  $('deviceName').value = localStorage.getItem('deviceName') || '';
  $('room').value = room || localStorage.getItem('room') || '';
  config.endpoints.forEach((endpoint, index) => {
    $('endpointInputs').insertAdjacentHTML('beforeend', `<label>#${index + 1}<input data-endpoint="${index}" value="${endpoint}" placeholder="https://LAN-helper"></label>`);
    $('endpointSelect').insertAdjacentHTML('beforeend', `<option value="${index}">${endpoint || `Endpoint ${index + 1} (not configured)`}</option>`);
  });
  $('interval').value = config.discoveryInterval;
  $('timeout').value = config.diagnosticTimeout;
  $('iceServers').value = JSON.stringify(config.rtc.iceServers);
  $('endpointSelect').onchange = () => {
    if ($('endpointSelect').value !== 'auto') {
      $('endpointSelect').value = 'auto';
      notify('AUTO discovery displays all configured endpoints. WATCH selects the matching helper.');
    }
  };
}

function diagnosticView(results) {
  const checks = { secure: 'Secure Context', webrtc: 'WebRTC API', capture: 'Screen Capture API', dataChannel: 'DataChannel', signaling: 'Signaling' };
  $('diagnosticGrid').innerHTML = Object.entries(checks).map(([key, name]) => {
    const passed = Boolean(results[key]);
    return `<div class="diag ${passed ? 'pass' : 'fail'}">${passed ? '[PASS]' : '[FAIL]'} ${name}: ${passed ? 'PASS' : 'FAIL'}</div>`;
  }).join('');
  const reachable = results.endpoints?.filter((item) => item.status === 'ONLINE').length || 0;
  $('overallStatus').textContent = results.secure && results.webrtc && reachable > 0 ? 'SYSTEM READY' : 'CHECK RESULTS';
  $('diagnosis').textContent = ['Diagnosis:', results.secure ? '[PASS] Secure context is available.' : '[FAIL] Screen sharing requires HTTPS or an allowed secure context.', `${reachable}/10 LAN endpoints reachable.`, results.dataChannel ? '[PASS] Temporary WebRTC/DataChannel test passed.' : '[WARN] WebRTC diagnostic did not complete.'].join('\n');
}

setup();
$('secureBadge').textContent = window.isSecureContext ? 'Secure context' : 'Not secure';
$('startBroadcast').onclick = async () => {
  try { await broadcaster.start(config.endpoints.find(Boolean), { deviceName: $('deviceName').value || 'Unnamed device', room: $('room').value }); }
  catch (error) { notify(`${error.code || 'MEDIA-001'}: ${error.message}`); }
};
$('stopBroadcast').onclick = () => broadcaster.stop();
$('stopWatching').onclick = () => { viewer.stop(); $('stopWatching').disabled = true; };
$('reconnect').onclick = () => { if (selected) watch(selected); };
$('fullscreen').onclick = () => $('remoteVideo').requestFullscreen?.();
$('mute').onclick = () => { $('remoteVideo').muted = !$('remoteVideo').muted; };
$('scanNow').onclick = scan;
$('quickTest').onclick = async () => diagnosticView(await diagnostics.quick(room));
$('fullDiagnostic').onclick = async () => diagnosticView(await diagnostics.full(room));
$('testWebrtc').onclick = async () => { try { await diagnostics.full(room); notify('Temporary WebRTC diagnostic completed.'); } catch (error) { notify(error.message); } };
$('testCapture').onclick = async () => { try { notify(JSON.stringify(await diagnostics.capture())); } catch (error) { notify(`${error.code || 'CAP-002'}: ${error.message}`); } };
$('testAll').onclick = async () => diagnosticView(await diagnostics.quick(room));
$('testSelected').onclick = async () => notify(JSON.stringify(await scanAll(room)));
$('testHelp').onclick = async () => { try { await sendHelp(config.endpoints.find(Boolean), null, true); $('helpStatus').textContent = 'Raise Help API PASS'; } catch { $('helpStatus').textContent = 'HELP-001 Help API unavailable'; } };
$('raiseHelp').onclick = async () => { if (!$('helpMessage').value.trim() && !confirm('Send a help request without a message?')) return; try { $('helpStatus').textContent = 'HELP REQUESTED'; const response = await sendHelp(config.endpoints.find(Boolean), { peerId: config.peerId, deviceName: $('deviceName').value, room: $('room').value, reason: 'computer-problem', message: $('helpMessage').value }); $('helpStatus').textContent = `HELP ${String(response.status || 'ACKNOWLEDGED').toUpperCase()}`; } catch { $('helpStatus').textContent = 'HELP-001 Help API unavailable'; } };
$('copyReport').onclick = () => navigator.clipboard?.writeText(JSON.stringify(diagnostics.report(), null, 2));
$('downloadReport').onclick = () => download('lan-diagnostic-report.json', JSON.stringify(diagnostics.report(), null, 2));
$('clearLog').onclick = () => { $('diagnosticLog').textContent = ''; };
$('saveSettings').onclick = () => { config.endpoints = [...document.querySelectorAll('[data-endpoint]')].map((input) => input.value.trim()).slice(0, 10); config.discoveryInterval = Number($('interval').value); config.diagnosticTimeout = Number($('timeout').value); try { config.rtc.iceServers = JSON.parse($('iceServers').value || '[]'); } catch { notify('Invalid STUN/TURN JSON'); return; } saveConfig(); notify('Settings saved.'); location.reload(); };
$('resetSettings').onclick = resetConfig;
scan();
setInterval(() => { if (!document.hidden) scan(); }, config.discoveryInterval);