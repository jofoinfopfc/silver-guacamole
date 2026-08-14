export const $ = id => document.getElementById(id);
export const now = () => new Date().toLocaleTimeString();
export function log(message, level='INFO'){ const el=$('diagnosticLog'); if(el) el.textContent += `${now()} [${level}] ${message}\n`; }
export function timeout(ms, label='Operation timed out'){ return new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error(label),{code:'NET-002'})),ms)); }
export async function withTimeout(promise, ms, label){ return Promise.race([promise, timeout(ms,label)]); }
export function peerId(){ let id=localStorage.getItem('lanPeerId'); if(!id){id=`peer-${crypto.randomUUID().slice(0,8)}`;localStorage.setItem('lanPeerId',id)} return id; }
export function classifyFetch(error, url){ const text=String(error?.message||error).toLowerCase(); if(location.protocol==='https:'&&url.startsWith('http:')) return {code:'NET-004',label:'MIXED CONTENT BLOCKED'}; if(error?.code==='NET-002'||text.includes('timeout')) return {code:'NET-002',label:'TIMEOUT'}; if(text.includes('cors')||text.includes('failed to fetch')) return {code:'NET-003',label:'CORS BLOCKED / NETWORK ERROR'}; if(text.includes('certificate')||text.includes('tls')) return {code:'TLS-001',label:'TLS/CERTIFICATE ERROR'}; return {code:'NET-001',label:'ENDPOINT UNREACHABLE'}; }
export function endpointUrl(base,path){ return `${base.replace(/\/$/,'')}${path}`; }
export function parseRoom(){ return new URLSearchParams(location.search).get('room')||''; }
export function download(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}