# Veyra — mobile encrypted chat + video calls (GitHub Pages edition)

This repository is a **static GitHub Pages website** you can open in **iPhone/iPad Safari, Android Chrome, or desktop browsers**. Use the same HTTPS link on both phones. After deployment, create a room and send your friend the private invitation link. The invited friend joins as the second participant.

**IMPORTANT**: The code is an **unaudited prototype, not a production secure messenger**. No software is impossible to hack. For high-sensitivity conversations use Signal or another established audited messenger. A malicious GitHub repository owner, a compromised browser/device, or someone with the full room invitation may undermine security. Live calls require browsers to stay open; there are no push notifications or offline messages.

## What is included

- No native iOS/Android app needed; installable website (Add to Home Screen)
- Two-person temporary private rooms; third users cannot claim a room's occupied slot
- **End-to-end WebRTC encryption** for messages (DTLS/SCTP) and video/audio (DTLS-SRTP)
- **AES-256-GCM encrypted signaling**: WebRTC SDP/ICE envelopes stored *temporarily* in Firebase Realtime Database; messages/media are never put in Firebase
- 256-bit random secret stored in URL fragment (`#k=`); the secret is not sent by HTTP to the server
- Persistent non-extractable P-256 identity key in each browser's IndexedDB; cryptographic possession proof and manually compared safety number; both people have to confirm before chatting/calling
- In-memory chat only; refreshing clears the UI. Firebase retains anonymous account UIDs, room presence while connected, and possibly undelivered/stale **encrypted signaling** records. It does not store chat text or calls.

## STEP 1 — Make your Firebase project (required)

GitHub Pages is static hosting: it **cannot run a WebSocket or signaling server**. This version uses [Firebase Realtime Database](https://firebase.google.com/docs/database) for room presence and *encrypted* call signaling. Firebase has a no-cost Spark tier subject to quotas. A Google/Firebase account and setup are required; do **not** skip the access rules.

1. Go to <https://console.firebase.google.com/> and select **Create a project** (e.g. `veil-phone`). Analytics may be disabled.
2. On the project overview select **Add app** → **Web** (`</>`). Register it, and copy the **Firebase Web app config** shown. You don't need Firebase Hosting.
3. Open `firebase-config.js` in the downloaded repository. Replace every `REPLACE_ME` with the **exact** config fields from Firebase. Include `apiKey`, `authDomain`, `projectId`, `appId`, and **databaseURL**. The database URL will come from step 5.
4. Go to **Build → Authentication → Sign-in method**, select **Anonymous**, and **Enable** it. Under **Authentication → Settings → Authorized domains** ensure your deployed **`USERNAME.github.io`** domain is authorized when required. Do not add arbitrary domains.
5. Go to **Build → Realtime Database → Create Database**. Choose a suitable region and start in **locked mode**. Copy the **databaseURL** shown (for example `https://PROJECT-default-rtdb.firebaseio.com`, or regional `https://PROJECT-default-rtdb.REGION.firebasedatabase.app`) into `firebase-config.js`.
6. In Realtime Database → **Rules**, paste **the entire contents** of `database.rules.json` and click **Publish**. **Do not use `.read: true` or `.write: true` at the root.** The shipped rules limit rooms to two authenticated anonymous users, permit only encrypted signal envelopes of bounded size, and restrict message deletion to the sender or recipient.
7. In Firebase → Project settings → **Your apps** double-check your web app's config fields. Firebase Web `apiKey` is an identifier and is okay in publicly hosted JavaScript; **never put Admin SDK/private service account keys in GitHub**.

## STEP 2 — Upload to GitHub

1. Create a **public GitHub repository** (for example `Chat`) and upload **the individual files/folders inside this ZIP**, directly in the repository root. In GitHub, `Add file → Upload files` can upload these together. Do not upload only a ZIP as the website.
2. Verify `index.html`, `app.js`, `firebase-signal.js`, `protocol.js`, `firebase-config.js`, `database.rules.json`, and `style.css` are in the repository root. (The `tests/` folder is optional to deploy.)
3. In the repo choose **Settings → Pages** → **Source: GitHub Actions** → **Save**. The included `.github/workflows/pages.yml` automatically runs tests and publishes the website when files change. **Do not choose Deploy from a branch** for this package.
4. Your address will look like `https://USERNAME.github.io/Chat/`. Open this HTTPS link on your phone. The app will warn on its landing screen if Firebase isn't configured. Configuration changes require committing a new file to GitHub and allowing Pages to redeploy.

> **GitHub Pages is public:** Anyone can read website source code and public Firebase config. The database rules and random secret protect temporary signaling data. Do not host secrets in the repository. GitHub can see web access metadata.

The included workflow automatically publishes after changes to `main`; check the **Actions** tab for deployment success. **GitHub Pages must be enabled once** in Settings → Pages (GitHub Actions source).

## STEP 3 — Chat and call from two phones

1. On **phone A**, open your GitHub Pages URL in Safari or Chrome and tap **Start a private conversation**.
2. Tap **Copy invitation link**, and privately send the **entire URL, including `#k=...`**, to your friend using Messages or WhatsApp. The room secret is in that link: treat it as a password. Do not post publicly.
3. On **phone B**, open the invitation link. Both phones need an internet connection and should **keep the website open and unlocked**.
4. When the browser-to-browser connection opens, **independently compare every digit of the safety number over a trusted separate channel** (ideally in person or a previously trusted voice call). Confirm the number on **both** phones.
5. Messages become available. Tap the **camera icon** to place a video call. Your friend must **Accept**, then grant camera/microphone permission. Camera/mic are not enabled by just joining a chat. Tap **End call** to stop sharing.
6. To put Veil on your home screen: iPhone → Safari → **Share → Add to Home Screen**; Android → Chrome menu → **Add to Home screen/Install app**. Open from the home-screen icon later; create a fresh room and invite again. Chats are not saved.

### If phones cannot connect / video is black

- Both devices must be online with a modern WebRTC-capable browser. **HTTPS** is needed for camera and microphone permissions. Unmute volume and allow permissions.
- Test both phones on Wi-Fi first. Some cellular networks use carrier-grade NAT and need a **TURN relay**. `ice-config.js` includes a public STUN service but **not TURN**. That means **phone-to-phone calling is not guaranteed to succeed on every network** until TURN is configured. Obtain a trustworthy TURN service and provision **short-lived credentials**. Do not put long-lived paid TURN service passwords into a public GitHub repository.
- The invitation link must be complete, and both users must use exactly the same deployed website/repo path.
- Check Firebase Authentication Anonymous enabled, the correct `databaseURL`, and pasted rules. On iOS, permission prompts may require a tap inside the call; don't lock the phone during a call.
- If the room is full or a disconnected device keeps a slot briefly, create a **new room** and share a fresh invitation.
- iPhone's home-screen app and Safari may have separate browser storage/identities; safety codes can change when switching contexts or clearing site data. Re-verify every conversation.

## Security limits (read before trusting)

- **Invitation links are bearer credentials.** Anyone holding the full URL can try to join a vacant slot. The safety number comparison is required to avoid blindly trusting who joined.
- WebRTC can disclose IP addresses to the other participant and STUN/TURN infrastructure; Firebase can observe connection metadata, anonymous user identifiers, and the timing/size of encrypted signaling.
- It does not implement the Signal protocol, double ratchet, post-quantum security, authenticated contacts, offline delivery, account recovery, or multi-device synchronization. Browser memory, screenshots, malware and compromised operating systems are outside its protection.
- **No independent audit or real-device integration tests** have been performed. Do not market this as unhackable or use it for safety-critical/regulated communication.
- Firebase Realtime Database can leave behind encrypted setup records after abrupt disconnections. No messages or media are written there. Provide your own retention/cleanup controls for a production service.
- Public unmetered Firebase projects can face quota abuse/DoS, even with rules and 2-person rooms. Restrict API usage, review usage alerts, and use Firebase App Check / abuse defenses for production.
- The website uses Google-hosted Firebase JavaScript SDK imports, so first load requires an internet connection and trusts the CDN supply chain. A production security product should pin and review dependencies and adopt deploy-integrity safeguards.

## Local tests

Requires Node.js 20+ only (for automated cryptographic tests):

```sh
npm test
```

This checks secret encoding, key derivation, authenticated encryption, tamper rejection and malformed inputs. It **does not** perform a true two-phone call integration test. For local web preview (not working remote camera over HTTP), use `python3 -m http.server 8000` and navigate to <http://localhost:8000>. After Firebase setup you can test two browser profiles on HTTPS GitHub Pages.

## File map

| File | What it does |
|---|---|
| `index.html` + `style.css` | Dark responsive messaging/video UI |
| `app.js` | WebRTC, text UI, identity checks and calling |
| `protocol.js` | Web Crypto keys, SHA-256, HKDF, AES-GCM |
| `firebase-signal.js` | Anonymous auth, 2-user room presence, encrypted signaling relay |
| `firebase-config.js` | **You edit:** Firebase public config |
| `database.rules.json` | **Paste into Firebase Console:** security rules |
| `ice-config.js` | STUN / optional TURN configuration |
| `manifest.webmanifest`, `service-worker.js`, images | Add to Home Screen and responsive app assets |
| `tests/` | Native Node.js cryptographic tests |

Code license: MIT. Prototype intended as an educational starting point.

## Deployment status and GitHub permissions

The linked GitHub integration can update files in an existing repository, but cannot create a repository or enable GitHub Pages for a new one. You must create an empty **public** repository on your account and enable GitHub Actions as the Pages source. Firebase project creation, anonymous sign-in enablement, and database rule publication also require the project owner to authorize those changes in the Firebase Console. These steps cannot be performed anonymously or by simply uploading a ZIP.

Once the repository exists, its individual files can be published from this folder. Do not copy the ZIP itself into the repository as the only file.
