import { peerId } from './utils.js';
const defaults=structuredClone(window.APP_CONFIG||{}); const saved=JSON.parse(localStorage.getItem('lanAppConfig')||'null');
export const config=Object.assign({},defaults,saved||{}); config.endpoints=(saved?.endpoints||defaults.endpoints||[]).slice(0,10); while(config.endpoints.length<10) config.endpoints.push(''); config.peerId=peerId();
export function saveConfig(){ localStorage.setItem('lanAppConfig',JSON.stringify({discoveryInterval:config.discoveryInterval,diagnosticTimeout:config.diagnosticTimeout,endpoints:config.endpoints,rtc:config.rtc})); }
export function resetConfig(){localStorage.removeItem('lanAppConfig');location.reload()}
export { defaults };