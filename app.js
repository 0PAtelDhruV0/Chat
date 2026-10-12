// Veil: ephemeral private rooms. All crypto and WebRTC run in users' browsers.
// No password or room secret is sent to the signaling server.
import {configured, connectSignaling} from './firebase-signal.js';
import {iceServers} from './ice-config.js';
import {utf8, decoder, encode64 as encoder, decode64 as unbase64, secureRandom as random,
  sha256 as hash, hex, deriveRoomKeys, sealSignal, openSignal} from './protocol.js';
const $ = id => document.getElementById(id);

let roomId, signalKey, signaling, role = 'host';
let pc, dataChannel, peerJoined = false, localIdentity, localPub;
let ownNonce, peerPub, peerRaw, identityOK = false, safetyCode = '';
let localVerified = false, otherVerified = false, connected = false;
let makingOffer = false, ignoreOffer = false, isSettingRemoteAnswerPending = false;
let pendingCandidates = [], queuedSend = Promise.resolve();
let callState = 'idle', localMedia, remoteMedia, mediaSenders = [];
let seenIV = new Set(), recentIV = [], incomingSignals = Promise.resolve();
let peerMessages = Promise.resolve(), peerEpoch = 0;
let signalReadyResolve;
const signalReady = new Promise(resolve => { signalReadyResolve = resolve; });
let toastTimer;

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 3800);
}
function ready() {
  return connected && identityOK && !!safetyCode && localVerified && otherVerified && dataChannel?.readyState === 'open';
}
function updateUI() {
  const joined = connected && peerJoined;
  $('peerStatus').textContent = !peerJoined ? 'Waiting for someone to join' :
    !connected ? 'Establishing encrypted connection…' : ready() ? 'Verified · Connected' : 'Connected · Verification required';
  $('securityPill').textContent = ready() ? '✓ Verified' : '◇ Encrypted';
  $('securityPill').style.color = ready() ? '#9fd4bb' : '';
  const verified = ready();
  $('messageInput').disabled = !verified;
  $('sendBtn').disabled = !verified;
  $('callBtn').disabled = !verified || callState !== 'idle';
  $('messageInput').placeholder = verified ? 'Send an encrypted message…' : 'Verify both identities to message…';
  $('safetyNumber').textContent = safetyCode || (peerJoined ? 'CONNECTING…' : 'WAITING FOR PEER');
  $('verifyBtn').disabled = !identityOK || localVerified;
  $('verifyBtn').innerHTML = localVerified ? 'Your identity check is confirmed <span>✓</span>' : 'I compared the number <span>✓</span>';
  $('verifyState').textContent = !identityOK ? '● Waiting for verified key exchange' :
    ready() ? '● Both people confirmed the number' :
    localVerified ? '● You confirmed · Waiting for the other person' :
    otherVerified ? '● Other person confirmed · Your turn' : '● Compare the number before confirming';
  $('verifyState').style.color = ready() ? '#9fd4bb' : '';
}
function addSystem(text) {
  $('emptyChat')?.remove();
  const el = document.createElement('div'); el.className = 'system-message'; el.textContent = text;
  $('messageList').append(el); $('messageList').scrollTop = $('messageList').scrollHeight;
}
function addChat(text, own) {
  $('emptyChat')?.remove();
  const row = document.createElement('div'); row.className = 'bubble-row' + (own ? ' own' : '');
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text;
  const time = document.createElement('div'); time.className = 'bubble-time';
  time.textContent = `${own ? 'You' : 'Peer'} · ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
  row.append(bubble, time); $('messageList').append(row); $('messageList').scrollTop = $('messageList').scrollHeight;
}
async function deriveSecret(secretBytes) {
  ({roomId, signalKey} = await deriveRoomKeys(secretBytes));
}
async function seal(data) {
  return sealSignal(signalKey, roomId, data);
}
async function open(envelope) {
  // Reject duplicate IVs in the current tab (not durable across page reloads).
  if (seenIV.has(envelope.iv)) throw Error('Duplicate envelope');
  const message = await openSignal(signalKey, roomId, envelope);
  seenIV.add(envelope.iv); recentIV.push(envelope.iv);
  if (recentIV.length > 4096) seenIV.delete(recentIV.shift());
  return message;
}

function sendSignal(data) {
  queuedSend = queuedSend.catch(() => {}).then(async () => {
    if (!peerJoined) return;
    const payload = await seal(data);
    // Firebase can emit the membership event before connectSignaling resolves.
    // Waiting here avoids silently discarding the first SDP offer.
    const active = signaling || await signalReady;
    if (active && peerJoined) await active.send(payload);
  });
  queuedSend.catch(err => {console.warn('Signaling failed', err); toast('Signaling network error. Check Firebase access and connection.');});
  return queuedSend;
}

function resetTrust() {
  ownNonce = null; peerPub = null; peerRaw = null; identityOK = false; safetyCode = '';
  localVerified = false; otherVerified = false; connected = false;
}
function resetPeer() {
  peerEpoch++; // Ignore any late messages from a replaced encrypted channel.
  peerMessages = Promise.resolve();
  stopLocalMedia();
  hideCall();
  callState = 'idle';
  if (dataChannel) {try {dataChannel.close();} catch { /* already closed */ }}
  dataChannel = null;
  if (pc) {pc.onnegotiationneeded = null; pc.onconnectionstatechange = null; pc.onicecandidate = null; pc.close();}
  pc = null; pendingCandidates = []; makingOffer = false; ignoreOffer = false;
  isSettingRemoteAnswerPending = false;
  resetTrust(); updateUI();
}
function onPeerLeft() {
  peerJoined = false; resetPeer(); addSystem('The other person disconnected. This room is waiting for a new connection.');
}
function initPeer() {
  if (pc) return;
  pc = new RTCPeerConnection({iceServers});
  const current = pc;
  current.onicecandidate = ({candidate}) => {
    if (candidate) void sendSignal({type: 'ice', candidate: candidate.toJSON()});
  };
  current.onconnectionstatechange = () => {
    if (current !== pc) return;
    if (current.connectionState === 'failed') { toast('Peer connection failed. Try leaving and rejoining the room.'); }
  };
  current.ondatachannel = ev => attachChannel(ev.channel);
  current.ontrack = ({track, streams}) => {
    if (!remoteMedia) remoteMedia = new MediaStream();
    if (!remoteMedia.getTracks().some(t => t.id === track.id)) remoteMedia.addTrack(track);
    $('remoteVideo').srcObject = remoteMedia;
    track.onunmute = () => $('callPlaceholder').classList.add('hidden');
    track.onended = () => {
      remoteMedia?.removeTrack(track);
      if (!remoteMedia?.getVideoTracks().length) $('callPlaceholder').classList.remove('hidden');
    };
    if (streams?.[0] && track.kind === 'video' && !track.muted) $('callPlaceholder').classList.add('hidden');
  };
  current.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await current.setLocalDescription();
      if (current === pc) await sendSignal({type: 'description', description: current.localDescription.toJSON()});
    } catch (err) { console.error('Negotiation failed', err); toast('Could not negotiate peer connection.'); }
    finally { makingOffer = false; }
  };
  if (role === 'host') {
    attachChannel(current.createDataChannel('private-chat', {ordered: true}));
  }
}
async function handleEncryptedSignal(payload) {
  try {
    const msg = await open(payload);
    if (!msg || typeof msg !== 'object' || !peerJoined) return;
    if (msg.type === 'description' && msg.description &&
        ['offer','answer'].includes(msg.description.type) && typeof msg.description.sdp === 'string' &&
        msg.description.sdp.length < 60000) {
      initPeer();
      const d = msg.description;
      const readyForOffer = !makingOffer && (pc.signalingState === 'stable' || isSettingRemoteAnswerPending);
      const collision = d.type === 'offer' && !readyForOffer;
      ignoreOffer = role !== 'guest' && collision;
      if (ignoreOffer) return;
      isSettingRemoteAnswerPending = d.type === 'answer';
      try {await pc.setRemoteDescription(d);}
      finally {isSettingRemoteAnswerPending = false;}
      const buffered = pendingCandidates.splice(0);
      for (const c of buffered) {
        try {await pc.addIceCandidate(c);} catch (e) {if (!ignoreOffer) console.warn('ICE candidate ignored', e);}
      }
      if (d.type === 'offer') {
        await pc.setLocalDescription();
        await sendSignal({type: 'description', description: pc.localDescription.toJSON()});
      }
    } else if (msg.type === 'ice' && msg.candidate && typeof msg.candidate.candidate === 'string' && msg.candidate.candidate.length < 4096) {
      initPeer();
      if (!pc.remoteDescription) pendingCandidates.push(msg.candidate);
      else try {await pc.addIceCandidate(msg.candidate);} catch (e) {if (!ignoreOffer) console.warn('ICE candidate failed', e);}
    }
  } catch (e) { console.warn('Rejected signaling message', e); }
}
function attachChannel(channel) {
  dataChannel = channel;
  const channelEpoch = peerEpoch;
  channel.onopen = async () => {
    if (channel !== dataChannel) return;
    connected = true;
    addSystem('Encrypted peer-to-peer channel established. Check the safety number.');
    ownNonce = encoder(random(24));
    sendPeer({type: 'identity-hello', publicKey: encoder(localPub), nonce: ownNonce});
    updateUI();
  };
  channel.onclose = () => {if (channel === dataChannel) {connected = false; updateUI();}};
  channel.onerror = () => toast('The encrypted message channel encountered an error.');
  channel.onmessage = ({data}) => {
    if (channel !== dataChannel || channelEpoch !== peerEpoch) return;
    if (typeof data !== 'string' || data.length > 12000) return;
    let msg;
    try {msg = JSON.parse(data);} catch {return;}
    if (typeof msg !== 'object' || msg === null) return;
    // Message handlers do async key import/signature verification; preserve
    // WebRTC data-channel message order across those async operations.
    peerMessages = peerMessages.catch(() => {}).then(() => {
      if (channel === dataChannel && channelEpoch === peerEpoch) return handlePeerMessage(msg);
    });
    peerMessages.catch(err => console.warn('Bad peer message', err));
  };
}
function sendPeer(msg) {
  if (dataChannel?.readyState !== 'open') return false;
  dataChannel.send(JSON.stringify(msg)); return true;
}
function proofData(nonce) {return utf8.encode(`veil-identity-proof-v1:${roomId}:${nonce}`);}
async function setSafetyNumber() {
  if (!peerRaw || !identityOK) return;
  const [a,b] = [encoder(localPub), encoder(peerRaw)].sort();
  const digest = new Uint8Array(await hash(utf8.encode(`veil-safety-v1:${a}:${b}`)));
  const code = hex(digest.slice(0, 16)).toUpperCase();
  safetyCode = code.match(/.{1,4}/g).join(' ');
  updateUI();
}
async function handlePeerMessage(msg) {
  if (msg.type === 'identity-hello' && typeof msg.publicKey === 'string' && typeof msg.nonce === 'string') {
    if (msg.publicKey.length > 120 || msg.nonce.length > 80 || !/^[\w-]+$/.test(msg.publicKey) || !/^[\w-]+$/.test(msg.nonce)) return;
    const raw = unbase64(msg.publicKey);
    if (raw.length !== 65 || unbase64(msg.nonce).length !== 24) return;
    peerRaw = raw;
    peerPub = await crypto.subtle.importKey('raw', raw, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    const signed = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, localIdentity.privateKey, proofData(msg.nonce));
    sendPeer({type: 'identity-proof', signature: encoder(new Uint8Array(signed))});
  } else if (msg.type === 'identity-proof' && typeof msg.signature === 'string' && msg.signature.length < 200 && peerPub && ownNonce) {
    const verified = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, peerPub, unbase64(msg.signature), proofData(ownNonce));
    if (!verified) {toast('Identity proof failed — do not trust this connection.'); return;}
    identityOK = true; await setSafetyNumber();
  } else if (msg.type === 'verified') {
    // Verification can arrive before the async local signature check completes.
    // It is still delivered on the browser-to-browser encrypted data channel.
    otherVerified = true; updateUI();
    if (ready()) addSystem('Both identity checks complete. Private messages and calls are enabled.');
  } else if (msg.type === 'chat' && ready() && typeof msg.text === 'string' && msg.text.length <= 4000) {
    addChat(msg.text, false);
  } else if (msg.type === 'call-request' && ready()) {
    if (callState !== 'idle') {sendPeer({type:'call-busy'}); return;}
    callState = 'incoming'; $('incomingDialog').classList.remove('hidden'); updateUI();
  } else if (msg.type === 'call-accept' && callState === 'outgoing') {
    callState = 'active'; $('callStatus').textContent = 'Connecting live video…';
    try {await startLocalMedia();} catch {sendPeer({type:'call-end'}); endCall(false);}
  } else if ((msg.type === 'call-decline' || msg.type === 'call-busy') && callState === 'outgoing') {
    endCall(false); toast(msg.type === 'call-busy' ? 'The other person is busy.' : 'The call was declined.');
  } else if (msg.type === 'call-end' && callState !== 'idle') {endCall(false); addSystem('Video call ended.');}
}

async function openIdentityDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('veil-device-identity-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getIdentity() {
  const db = await openIdentityDatabase();
  const prior = await new Promise((resolve, reject) => {
    const req = db.transaction('keys', 'readonly').objectStore('keys').get('identity');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  if (prior?.privateKey && prior?.publicKey) {db.close(); return prior;}
  const identity = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign','verify']);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(identity, 'identity');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close(); return identity;
}
async function startRoom(keyBytes) {
  $('welcome').classList.add('hidden'); $('roomView').classList.remove('hidden');
  try {
    await deriveSecret(keyBytes);
    const identity = await getIdentity();
    localIdentity = identity; localPub = new Uint8Array(await crypto.subtle.exportKey('raw', identity.publicKey));
    signaling = await connectSignaling(roomId, {
      onRole: newRole => {role = newRole;},
      onPeer: (joined) => {
        if (joined) {
          if (!peerJoined) {
            peerJoined = true; initPeer();
            addSystem('The other person joined. Establishing a secure connection…');
          }
        } else if (peerJoined) onPeerLeft();
        updateUI();
      },
      onEncryptedSignal: payload => {
        incomingSignals = incomingSignals.catch(() => {}).then(() => handleEncryptedSignal(payload));
      },
      onDisconnectError: err => {console.warn('Firebase signaling connection:', err); toast('Firebase connection lost. Check internet and database rules.');}
    });
    role = signaling.role;
    signalReadyResolve(signaling);
    updateUI();
  } catch (err) {signalReadyResolve(null); console.error(err); toast('Cannot enter room: ' + (err?.message || 'Check Firebase configuration and reload.')); $('welcome').classList.remove('hidden'); $('roomView').classList.add('hidden');}
}

function showCall(status) {
  $('callOverlay').classList.remove('hidden');
  $('callPlaceholder').classList.remove('hidden'); $('callStatus').textContent = status;
  $('muteBtn').textContent = 'Mic on'; $('cameraBtn').textContent = 'Camera on';
}
function hideCall() {
  $('callOverlay').classList.add('hidden'); $('incomingDialog').classList.add('hidden');
  $('remoteVideo').srcObject = null; $('localVideo').srcObject = null;
  remoteMedia = null;
}
async function startLocalMedia() {
  if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera requires HTTPS or localhost');
  try {localMedia = await navigator.mediaDevices.getUserMedia({audio: true, video: {facingMode: 'user'}});}
  catch (err) {toast(`Camera/microphone unavailable: ${err.name || 'permission denied'}`); throw err;}
  $('localVideo').srcObject = localMedia;
  for (const track of localMedia.getTracks()) mediaSenders.push(pc.addTrack(track, localMedia));
}
function stopLocalMedia() {
  for (const sender of mediaSenders) {
    try {if (pc?.signalingState !== 'closed') pc?.removeTrack(sender);} catch { /* no-op */ }
  }
  mediaSenders = [];
  localMedia?.getTracks().forEach(t => t.stop()); localMedia = null;
}
function endCall(notify = true) {
  if (notify && callState !== 'idle') sendPeer({type: 'call-end'});
  stopLocalMedia(); callState = 'idle'; hideCall(); updateUI();
}

$('createBtn').addEventListener('click', async () => {
  const newKey = random(32);
  history.replaceState(null, '', `#k=${encoder(newKey)}`);
  await startRoom(newKey);
});
$('toggleJoinBtn').addEventListener('click', () => {$('joinForm').classList.toggle('hidden');});
$('joinForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const u = new URL($('joinLink').value.trim());
    const match = /^#k=([A-Za-z0-9_-]{43})$/.exec(u.hash);
    if (u.origin !== location.origin || u.pathname !== location.pathname || !match) throw Error('Different site or invalid link');
    const key = unbase64(match[1]); if (key.length !== 32) throw Error('Invalid secret');
    history.replaceState(null, '', `#k=${match[1]}`);
    await startRoom(key);
  } catch {toast('Use a valid invitation for this exact website.');}
});
$('copyBtn').addEventListener('click', async () => {
  try {await navigator.clipboard.writeText(location.href); toast('Private invitation copied. Share it carefully.');}
  catch {toast('Clipboard not available. Copy the URL from your address bar.');}
});
$('shareBtn').addEventListener('click', async () => {
  if (navigator.share) {
    try {await navigator.share({title:'Private Veil invitation', text:'Join my private conversation', url:location.href});} catch (error) {if (error.name !== 'AbortError') toast('Could not share. Use Copy invitation link.');}
  } else {
    try {await navigator.clipboard.writeText(location.href); toast('Invite link copied. Share it only with your friend.');} catch {toast('Copy the private URL from the browser address bar.');}
  }
});
$('leaveBtn').addEventListener('click', async () => {await signaling?.close(); resetPeer(); location.replace(location.pathname + location.search);});
$('verifyBtn').addEventListener('click', () => {
  if (!identityOK || localVerified) return;
  localVerified = true;
  sendPeer({type: 'verified'});
  updateUI();
  if (ready()) addSystem('Both identity checks complete. Private messages and calls are enabled.');
});
$('messageForm').addEventListener('submit', event => {
  event.preventDefault();
  const content = $('messageInput').value.trim();
  if (!ready() || !content || content.length > 4000) return;
  if (sendPeer({type: 'chat', text: content})) {addChat(content, true); $('messageInput').value = '';}
});
$('clearBtn').addEventListener('click', () => {
  $('messageList').replaceChildren(); addSystem('This screen was cleared. Messages were never stored on the server.');
});
$('callBtn').addEventListener('click', () => {
  if (!ready() || callState !== 'idle') return;
  callState = 'outgoing'; showCall('Ringing…');
  sendPeer({type: 'call-request'}); updateUI();
});
$('acceptBtn').addEventListener('click', async () => {
  if (callState !== 'incoming') return;
  $('incomingDialog').classList.add('hidden'); showCall('Connecting live video…');
  try {await startLocalMedia(); callState = 'active'; sendPeer({type: 'call-accept'}); updateUI();}
  catch {sendPeer({type: 'call-decline'}); endCall(false);}
});
$('declineBtn').addEventListener('click', () => {
  if (callState === 'incoming') {sendPeer({type: 'call-decline'}); endCall(false);}
});
$('hangupBtn').addEventListener('click', () => {endCall(true); addSystem('Video call ended.');});
$('muteBtn').addEventListener('click', () => {
  const track = localMedia?.getAudioTracks()[0]; if (!track) return;
  track.enabled = !track.enabled; $('muteBtn').textContent = track.enabled ? 'Mic on' : 'Mic muted';
});
$('cameraBtn').addEventListener('click', () => {
  const track = localMedia?.getVideoTracks()[0]; if (!track) return;
  track.enabled = !track.enabled; $('cameraBtn').textContent = track.enabled ? 'Camera on' : 'Camera off';
});
$('aboutBtn').addEventListener('click', () => $('aboutDialog').classList.remove('hidden'));
$('closeAboutBtn').addEventListener('click', () => $('aboutDialog').classList.add('hidden'));
$('closeAboutBottomBtn').addEventListener('click', () => $('aboutDialog').classList.add('hidden'));

if (!configured) { $('setupNotice').classList.remove('hidden'); $('createBtn').disabled = true; $('toggleJoinBtn').disabled = true; }
const initial = /^#k=([A-Za-z0-9_-]{43})$/.exec(location.hash);
if (initial) {
  try {const bytes = unbase64(initial[1]); if (bytes.length === 32) void startRoom(bytes);}
  catch {toast('The invitation link is invalid.');}
}

// GitHub Pages-compatible installable web app. Code is cached; chats are not.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}
