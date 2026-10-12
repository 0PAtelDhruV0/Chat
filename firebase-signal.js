// Firebase is used ONLY to discover the second participant and relay
// encrypted WebRTC offer/answer/ICE envelopes. Chat/media never traverse RTDB.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth, signInAnonymously} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getDatabase, ref, get, onValue, onChildAdded, onDisconnect, runTransaction, push, set, remove} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import {firebaseConfig} from './firebase-config.js';

export const configured = Boolean(firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('REPLACE_ME') &&
  firebaseConfig.databaseURL?.startsWith('https://') && !firebaseConfig.databaseURL.includes('REPLACE_ME'));

let app, auth, db;
async function readyFirebase() {
  if (!configured) throw new Error('Firebase is not configured. Open firebase-config.js and README.md.');
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app); db = getDatabase(app);
  }
  if (!auth.currentUser) await signInAnonymously(auth);
  if (!auth.currentUser) throw new Error('Anonymous authentication did not succeed.');
  return auth.currentUser.uid;
}

// Client checks whether a Firebase connection is live. The signaling service
// deliberately never receives the invitation secret (#k= fragment).
export async function connectSignaling(roomId, {onRole, onPeer, onEncryptedSignal, onDisconnectError}) {
  const uid = await readyFirebase();
  const base = `rooms/${roomId}`;
  const hostRef = ref(db, `${base}/members/host`);
  const guestRef = ref(db, `${base}/members/guest`);
  let role = 'host';
  let ownRef, peerUid = null, closed = false;
  let offMembers = () => {}, offSignals = () => {}, offConnection = () => {};
  const waitingSignals = new Map();
  function dispatchSignal(snapshot) {
    if (closed) return;
    const msg = snapshot.val();
    if (!msg || msg.to !== uid || msg.from === uid) return;
    // The Firebase signals listener can run before the members listener.
    // Queue only until the other participant is known.
    if (!peerUid) {
      if (waitingSignals.size < 128) waitingSignals.set(snapshot.key, snapshot);
      return;
    }
    if (msg.from === peerUid && typeof msg.time === 'number' &&
        Math.abs(Date.now() - msg.time) < 2 * 60 * 1000 &&
        typeof msg.iv === 'string' && typeof msg.cipher === 'string') {
      onEncryptedSignal({iv: msg.iv, cipher: msg.cipher});
    }
    // Old or invalid data directed to us should not accumulate forever.
    remove(snapshot.ref).catch(err => onDisconnectError?.(err));
  }

  // Atomic slots: no third participant can claim an already occupied room.
  let hostCommitted = false;
  // A concurrent host may win the slot between read and transaction;
  // treat that as guest admission, not a fatal room error.
  if (!(await get(hostRef)).exists()) {
    try {
      const claim = await runTransaction(hostRef, old => old === null ? uid : undefined, {applyLocally: false});
      hostCommitted = claim.committed;
    } catch (err) {
      if (!(await get(hostRef)).exists()) throw err;
    }
  }
  if (hostCommitted) { ownRef = hostRef; }
  else {
    role = 'guest'; ownRef = guestRef;
    if (!(await get(hostRef)).exists()) throw new Error('No host is available. Create a new room.');
    const guest = await runTransaction(guestRef, old => old === null ? uid : undefined, {applyLocally: false});
    if (!guest.committed) throw new Error('This private room already has two participants.');
  }

  onRole?.(role);

  // Connection loss removes our slot. Register it again after a reconnect.
  try {await onDisconnect(ownRef).remove();} catch (error) {
    await remove(ownRef).catch(() => {}); throw error;
  }

  offConnection = onValue(ref(db, '.info/connected'), async snapshot => {
    if (!snapshot.val() || closed) return;
    try {
      await onDisconnect(ownRef).remove();
      const occupant = (await get(ownRef)).val();
      if (occupant === null) {
        const claim = await runTransaction(ownRef, old => old === null ? uid : undefined, {applyLocally: false});
        if (!claim.committed) throw new Error('Room slot taken on reconnect');
      } else if (occupant !== uid) throw new Error('Room slot no longer belongs to this device');
    } catch (err) {if (!closed) onDisconnectError?.(err);}
  });

  offMembers = onValue(ref(db, `${base}/members`), snapshot => {
    if (closed) return;
    const members = snapshot.val() || {};
    const ourUid = members[role];
    if (ourUid !== uid) {peerUid = null; onPeer(false); return;}
    const nextPeer = members[role === 'host' ? 'guest' : 'host'];
    if (nextPeer && nextPeer !== uid) {
      // If a new person arrives, drop the old peer connection first.
      if (peerUid !== nextPeer) {
        if (peerUid) onPeer(false);
        peerUid = nextPeer; onPeer(true, nextPeer);
        for (const snapshot of waitingSignals.values()) dispatchSignal(snapshot);
        waitingSignals.clear();
      }
    } else if (peerUid) {peerUid = null; onPeer(false);}
  }, error => onDisconnectError?.(error));

  offSignals = onChildAdded(ref(db, `${base}/signals`), dispatchSignal,
    error => onDisconnectError?.(error));

  return {
    role,
    async send(payload) {
      if (closed || !peerUid) return;
      await set(push(ref(db, `${base}/signals`)), {
        from: uid, to: peerUid, iv: payload.iv, cipher: payload.cipher,
        time: {'.sv': 'timestamp'}
      });
    },
    async close() {
      if (closed) return;
      closed = true; waitingSignals.clear(); offMembers(); offSignals(); offConnection();
      await onDisconnect(ownRef).cancel().catch(() => {});
      await remove(ownRef).catch(() => {});
    }
  };
}
