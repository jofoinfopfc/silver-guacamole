window.APP_CONFIG = {
  version: '1.0.0',
  helperVersion: '1.0.0',
  discoveryInterval: 5000,
  diagnosticTimeout: 3000,
  endpoints: ['', '', '', '', '', '', '', '', '', ''],
  rtc: { iceServers: [] },
  api: { health: '/api/health', stream: '/api/stream', help: '/api/help', helpTest: '/api/help/test', signaling: '/ws' }
};