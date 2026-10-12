import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveRoomKeys, sealSignal, openSignal, encode64, decode64, secureRandom} from '../protocol.js';

test('base64url preserves a 256-bit invitation secret', () => {
  const raw = secureRandom(32), serialized = encode64(raw);
  assert.match(serialized, /^[a-zA-Z0-9_-]{43}$/);
  assert.deepEqual(decode64(serialized), raw);
});
test('both participants derive matching but different-room signaling keys', async () => {
  const secret=secureRandom(32);
  const a=await deriveRoomKeys(secret), b=await deriveRoomKeys(decode64(encode64(secret)));
  const different=await deriveRoomKeys(secureRandom(32));
  assert.equal(a.roomId,b.roomId);
  assert.notEqual(a.roomId,different.roomId);
  const msg={type:'description', description:{type:'offer',sdp:'example SDP test'},candidate:null};
  const envelope=await sealSignal(a.signalKey,a.roomId,msg);
  assert.equal(envelope.iv.length,16);
  assert.ok(!JSON.stringify(envelope).includes('example SDP test'));
  assert.deepEqual(await openSignal(b.signalKey,b.roomId,envelope),msg);
  await assert.rejects(openSignal(different.signalKey,different.roomId,envelope));
  await assert.rejects(openSignal(b.signalKey,different.roomId,envelope));
  const tampered = {...envelope, cipher: (envelope.cipher[0] === 'A' ? 'B' : 'A') + envelope.cipher.slice(1)};
  await assert.rejects(openSignal(b.signalKey,b.roomId,tampered));
});
test('invalid secrets and malformed envelopes are rejected', async () => {
  await assert.rejects(deriveRoomKeys(secureRandom(16)));
  const {roomId,signalKey}=await deriveRoomKeys(secureRandom(32));
  await assert.rejects(openSignal(signalKey,roomId,{iv:'bad',cipher:'broken'}));
});
