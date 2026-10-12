# Veil Private Messenger — GitHub Chat repository

Your repository: https://github.com/0PAtelDhruV0/Chat

Site address (after GitHub Pages deployment): https://0pateldhruv0.github.io/Chat/

## Remaining required account setup

1. Open https://console.firebase.google.com/ and create a new Firebase project, then register a web app.
2. Enable Authentication > Anonymous. Create a Realtime Database in locked mode and paste the exact rules in `database.rules.json`.
3. Copy your Firebase **public web app configuration** to `firebase-config.js` (apiKey, authDomain, databaseURL, projectId, appId). Do not publish service-account private keys.
4. In https://github.com/0PAtelDhruV0/Chat/settings/pages choose **GitHub Actions** as Pages source. The workflow runs tests and deploys your site.
5. Open the site on two phones. Create a room on the first, share the entire private invitation with the second, and compare safety numbers on a separate trusted channel. Only then accept a call.

Note: no independent security audit or two-phone video-call verification; without TURN server, certain networks will not connect. This is a prototype, not an unhackable messenger.
