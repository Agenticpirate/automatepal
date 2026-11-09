// Prints a new VAPID key pair for Web Push (lib/web-push.ts). Put the public key in WEB_PUSH_PUBLIC_KEY and the
// private key in WEB_PUSH_PRIVATE_KEY (a secret). Rotating the pair means every device turns notifications on again.
const kp = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
const b64u = (b) => Buffer.from(b).toString('base64url');
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
console.log(`WEB_PUSH_PUBLIC_KEY=${b64u(pub)}\nWEB_PUSH_PRIVATE_KEY=${jwk.d}`);
