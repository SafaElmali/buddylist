// Web Push, from this Mac to a phone, with no server of ours (see push.js for when a note is sent). A browser that
// turns notifications on gives the phone app a subscription: an address at its own push service (Apple's, Google's,
// Mozilla's or Microsoft's) and two keys. A note is encrypted for that browser alone (RFC 8291, aes128gcm), so the
// push service passes on what it can't read, and is signed with the key the browser subscribed with (RFC 8292,
// VAPID), so nobody else can send to it. All of it is node:crypto.
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

/** Who sends, as a push service asks: the app's site. */
export const SUBJECT = 'https://buddylist.dev';
/** How long a push service keeps a note for a phone that is off: a day. */
export const TTL_SECONDS = 24 * 60 * 60;
/** One record, as big as a push service takes. A note is far smaller. */
const RECORD_SIZE = 4096;
/** The longest note sent: what is left of a record once the delimiter and the tag are in it. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 17;
/** The longest address a subscription may have. */
const MAX_ENDPOINT = 2048;
/** How long a push service has to answer. */
const TIMEOUT_MS = 15 * 1000;

/**
 * The push services a subscription may be at: the browsers' own, over https. Nothing is sent anywhere else.
 * Apple's (web.push.apple.com), Google's for Chrome, Mozilla's for Firefox, Microsoft's for Edge on Windows.
 */
const PUSH_HOSTS = [
  /^([a-z0-9-]+\.)+push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)+notify\.windows\.com$/,
];

/** A fake push service on this computer, which a check of the whole path is given (see scripts/check-remote-ui.js). */
const TEST_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

/**
 * A subscription, as a browser's PushSubscription.toJSON() has it.
 * @typedef {{ endpoint: string, keys: { p256dh: string, auth: string } }} Subscription
 */

/**
 * The app's own key pair, which every subscription is made with, base64url: the public key as an uncompressed point.
 * @typedef {{ publicKey: string, privateKey: string }} VapidKeys
 */

/**
 * Whether a subscription's address is at one of the push services: https, on its usual port.
 * @param {unknown} endpoint
 * @param {{ testOrigin?: string }} [options]  a fake push service on 127.0.0.1, for a check run; '' otherwise
 */
export function allowedEndpoint(endpoint, { testOrigin = '' } = {}) {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (TEST_ORIGIN.test(testOrigin) && url.origin === testOrigin) return true;
  return (
    url.protocol === 'https:' &&
    !url.port &&
    !url.username &&
    !url.password &&
    PUSH_HOSTS.some((host) => host.test(url.hostname))
  );
}

/**
 * What a browser posted as its subscription, checked: at a push service, with a key that is a point on P-256 and a
 * secret of 16 bytes. Null for anything else.
 * @param {unknown} value
 * @param {{ testOrigin?: string }} [options]
 * @returns {Subscription | null}
 */
export function subscriptionOf(value, options) {
  const { endpoint, keys } = /** @type {any} */ (value ?? {});
  if (!allowedEndpoint(endpoint, options) || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string')
    return null;
  const point = Buffer.from(keys.p256dh, 'base64url');
  if (point.length !== 65 || point[0] !== 4 || Buffer.from(keys.auth, 'base64url').length !== 16) return null;
  try {
    // Throws for a point that isn't on the curve.
    crypto.ECDH.convertKey(point, 'prime256v1');
  } catch {
    return null;
  }
  return { endpoint, keys: { p256dh: point.toString('base64url'), auth: keys.auth } };
}

/** How long a P-256 private key is, as a JWK's `d` must have it (RFC 7518 section 6.2.2.1). */
const PRIVATE_KEY_BYTES = 32;

/**
 * A private key at its full 32 bytes, base64url. ECDH drops a key's leading zero bytes, so about 1 key in 256 comes
 * out at 31, and remote.json may have kept one like that from before.
 * @param {Buffer} key
 */
const fullPrivateKey = (key) =>
  Buffer.concat([Buffer.alloc(Math.max(0, PRIVATE_KEY_BYTES - key.length)), key]).toString('base64url');

/** A new key pair for the app, made once and kept in remote.json. @returns {VapidKeys} */
export function vapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: fullPrivateKey(ecdh.getPrivateKey()),
  };
}

/** @param {VapidKeys} keys */
const signingKey = ({ publicKey, privateKey }) => {
  const point = Buffer.from(publicKey, 'base64url');
  return crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: fullPrivateKey(Buffer.from(privateKey, 'base64url')),
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
};

const base64url = (value) => Buffer.from(value).toString('base64url');

/**
 * The Authorization header that says the app sent a note (RFC 8292): a JWT for the push service, signed with ES256,
 * which lasts 12 hours, and the public key it is checked with.
 * @param {string} endpoint
 * @param {VapidKeys} keys
 * @param {{ now?: number }} [options]
 */
export function vapidAuthorization(endpoint, keys, { now = Date.now() } = {}) {
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64url(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: SUBJECT })
  );
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: signingKey(keys),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${claims}.${signature.toString('base64url')}, k=${keys.publicKey}`;
}

const hkdf = (salt, ikm, info, length) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));

/**
 * The key and nonce a note is encrypted with (RFC 8291 section 3.4, RFC 8188 section 2.2), from the secret both
 * sides share.
 */
function contentKeys({ secret, auth, receiver, sender, salt }) {
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), receiver, sender]), 32);
  return {
    key: hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    nonce: hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12),
  };
}

/**
 * A note, encrypted for one browser: the body a push service is posted (RFC 8291). A new key pair and salt each
 * time; a test gives its own, to get the RFC's worked example.
 * @param {string | Buffer} payload
 * @param {Subscription} subscription
 * @param {{ salt?: Buffer, senderKey?: string }} [options]  `senderKey`: a private key, base64url
 */
export function encrypt(payload, { keys }, { salt = crypto.randomBytes(16), senderKey } = {}) {
  const plain = Buffer.from(payload);
  if (plain.length > MAX_PAYLOAD_BYTES) throw new Error('The note is too long to send.');
  const receiver = Buffer.from(keys.p256dh, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  if (senderKey) ecdh.setPrivateKey(Buffer.from(senderKey, 'base64url'));
  else ecdh.generateKeys();
  const sender = ecdh.getPublicKey();
  const { key, nonce } = contentKeys({
    secret: ecdh.computeSecret(receiver),
    auth: Buffer.from(keys.auth, 'base64url'),
    receiver,
    sender,
    salt,
  });
  const cipher = crypto.createCipheriv('aes-128-gcm', key, nonce);
  // The last record ends with 2, and needs no padding.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([2])])), cipher.final()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = sender.length;
  return Buffer.concat([header, sender, sealed, cipher.getAuthTag()]);
}

/**
 * What a browser does with a note it is pushed: decrypts it with its own private key and secret. For tests, and
 * for the fake push service of a check run, which plays the browser.
 * @param {Buffer} body
 * @param {{ privateKey: string, auth: string }} receiverKeys  base64url
 */
export function decrypt(body, { privateKey, auth }) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const sender = body.subarray(21, 21 + idLength);
  const sealed = body.subarray(21 + idLength);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
  const { key, nonce } = contentKeys({
    secret: ecdh.computeSecret(sender),
    auth: Buffer.from(auth, 'base64url'),
    receiver: ecdh.getPublicKey(),
    sender,
    salt,
  });
  const decipher = crypto.createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(sealed.subarray(-16));
  const padded = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (padded[end] !== 2) throw new Error('Not the last record.');
  return padded.subarray(0, end);
}

/**
 * Posts one note to one subscription's push service, and says how it answered: 201 when it took it, 404 or 410
 * when the subscription is gone. Only to a push service's address (see allowedEndpoint).
 * @param {Subscription} subscription
 * @param {object} note  sent as JSON
 * @param {object} options
 * @param {VapidKeys} options.vapid
 * @param {'high' | 'normal'} [options.urgency]  high wakes a phone that saves its battery
 * @param {string} [options.testOrigin]
 * @param {number} [options.now]
 * @returns {Promise<{ status: number, text: string }>}
 */
export function sendPush(subscription, note, { vapid, urgency = 'normal', testOrigin = '', now = Date.now() }) {
  if (!allowedEndpoint(subscription.endpoint, { testOrigin }))
    return Promise.reject(new Error('Not the address of a push service.'));
  const body = encrypt(JSON.stringify(note), subscription);
  const url = new URL(subscription.endpoint);
  const request = url.protocol === 'https:' ? https.request : http.request;
  return new Promise((resolve, reject) => {
    const asked = request(
      url,
      {
        method: 'POST',
        timeout: TIMEOUT_MS,
        headers: {
          ttl: String(TTL_SECONDS),
          urgency,
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          'content-length': String(body.length),
          authorization: vapidAuthorization(subscription.endpoint, vapid, { now }),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (text = (text + chunk).slice(0, 512)));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text }));
        response.on('error', reject);
      }
    );
    asked.on('timeout', () => asked.destroy(new Error('The push service did not answer.')));
    asked.on('error', reject);
    asked.end(body);
  });
}
