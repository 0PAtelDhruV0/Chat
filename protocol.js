// Security primitives used by Veil browser client. Uses native Web Crypto only.
export const utf8 = new TextEncoder();
export const decoder = new TextDecoder();
export function encode64(bytes) {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function decode64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw Error('Bad base64url');
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-s.length%4)%4)), c => c.charCodeAt(0));
}
export const secureRandom = n => crypto.getRandomValues(new Uint8Array(n));
export const sha256 = bytes => crypto.subtle.digest('SHA-256', bytes);
export const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');

export async function deriveRoomKeys(secretBytes) {
  if (!(secretBytes instanceof Uint8Array) || secretBytes.length !== 32) throw Error('32-byte room secret required');
  const roomId = hex(await sha256(new Uint8Array([...utf8.encode('veil-room-v1:'), ...secretBytes])));
  const master = await crypto.subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveKey']);
  const signalKey = await crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256',
    salt: utf8.encode('veil-hkdf-salt-v1'), info: utf8.encode('veil-signaling-v1')
  }, master, {name: 'AES-GCM', length: 256}, false, ['encrypt','decrypt']);
  return {roomId, signalKey};
}
export async function sealSignal(signalKey, roomId, payload) {
  const iv = secureRandom(12);
  const cipher = await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:utf8.encode(`veil-v1:${roomId}`)
  }, signalKey, utf8.encode(JSON.stringify(payload)));
  return {iv: encode64(iv), cipher: encode64(new Uint8Array(cipher))};
}
export async function openSignal(signalKey, roomId, envelope) {
  if (typeof envelope?.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(envelope.iv) ||
      typeof envelope?.cipher !== 'string' || envelope.cipher.length > 60000) throw Error('Bad envelope');
  const plaintext = await crypto.subtle.decrypt({
    name:'AES-GCM',iv:decode64(envelope.iv),additionalData:utf8.encode(`veil-v1:${roomId}`)
  }, signalKey, decode64(envelope.cipher));
  return JSON.parse(decoder.decode(plaintext));
}
