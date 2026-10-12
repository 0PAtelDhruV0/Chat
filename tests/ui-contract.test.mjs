import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const originalControls = ['createBtn','joinForm','joinLink','copyBtn','shareBtn','leaveBtn',
  'peerStatus','securityPill','messageList','messageForm','messageInput','sendBtn',
  'safetyNumber','verifyState','verifyBtn','callBtn','remoteVideo','localVideo',
  'acceptBtn','declineBtn','hangupBtn','muteBtn','cameraBtn'];
const pulseControls = ['chatSearch','searchFeedback','quickInviteBtn','verifyShortcut',
  'pulseVerifyLabel','pulseVerifyNote','pulseNavChats','pulseNavInvite','pulseNavCall',
  'pulseNavSafety','inviteCard','verifyCard'];

test('existing messaging, call, and identity controls remain present once', () => {
  for (const id of originalControls) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `Missing or duplicate ${id}`);
  }
});

test('Pulse quick actions and search have matching elements and handlers', () => {
  for (const id of pulseControls) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `Missing or duplicate ${id}`);
  }
  assert.match(app, /\$\('chatSearch'\)\.addEventListener\('input', filterPulseMessages\)/);
  assert.match(app, /\$\('pulseNavCall'\)\.addEventListener\('click'/);
  assert.match(app, /\$\('callBtn'\)\.click\(\)/);
});

test('WebRTC and original verified-send security gates stay in place', () => {
  assert.match(app, /new RTCPeerConnection\(\{iceServers\}\)/);
  assert.match(app, /function ready\(\)/);
  assert.match(app, /ready\(\) && typeof msg\.text/);
  assert.match(app, /if \(!ready\(\) \|\| !content/);
  assert.match(app, /if \(!ready\(\) \|\| callState !== 'idle'\) return/);
  assert.match(app, /sealSignal\(signalKey, roomId, data\)/);
});

test('mobile navigation has a safe-area footer and does not replace call overlay', () => {
  assert.match(css, /\.pulse-mobile-nav\{display:flex/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /id="callOverlay"/);
});
