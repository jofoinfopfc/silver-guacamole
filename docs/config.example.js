window.APP_CONFIG = {
  version: '1.0.0', helperVersion: '1.0.0', discoveryInterval: 5000, diagnosticTimeout: 3000,
  endpoints: ['https://192.168.10.101','https://192.168.10.102','https://192.168.10.103','https://192.168.10.104','https://192.168.10.105','https://192.168.10.106','https://192.168.10.107','https://192.168.10.108','https://192.168.10.109','https://192.168.10.110'],
  rtc: { iceServers: [] },
  api: { health: '/api/health', stream: '/api/stream', help: '/api/help', helpTest: '/api/help/test', signaling: '/ws' }
};