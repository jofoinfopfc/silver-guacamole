import { peerId } from './utils.js';
const source=window.APP_CONFIG||{}; const defaults=typeof structuredClone==='function'?structuredClone(source):JSON.parse(JSON.stringify(source)); let saved=null; try{saved=JSON.parse(localStorage.getItem('lanAppConfig')||'null')}catch{localStorage.removeItem('lanAppConfig')}
export const config=Object.assign({},defaults,saved||{}); config.endpoints=(saved?.endpoints||defaults.endpoints||[]).slice(0,10); while(config.endpoints.length<10) config.endpoints.push(''); config.peerId=peerId();
export function saveConfig(){ localStorage.setItem('lanAppConfig',JSON.stringify({discoveryInterval:config.discoveryInterval,diagnosticTimeout:config.diagnosticTimeout,endpoints:config.endpoints,rtc:config.rtc})); }
export function resetConfig(){localStorage.removeItem('lanAppConfig');location.reload()}
export { defaults };