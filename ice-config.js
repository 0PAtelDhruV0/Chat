// STUN helps connect many networks. It DOES NOT guarantee mobile-to-mobile calls.
// For calls on restrictive carrier networks, add a TURN service with short-lived
// credentials. Avoid publishing permanent shared TURN passwords in GitHub.
export const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
