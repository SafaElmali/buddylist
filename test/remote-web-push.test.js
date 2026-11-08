import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {
  allowedEndpoint,
  decrypt,
  encrypt,
  MAX_PAYLOAD_BYTES,
  sendPush,
  SUBJECT,
  subscriptionOf,
  TTL_SECONDS,
  vapidAuthorization,
  vapidKeys,
} from '../src/main/remote/web-push.js';

/** RFC 8291 section 5 and appendix A: the worked example. */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const rfcSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  keys: { p256dh: RFC.uaPublic, auth: RFC.auth },
};

/**
 * A key pair whose private key starts with a zero byte, as remote.json kept it before such keys were padded: ECDH drops
 * the zero, so the private key is 31 bytes. About 1 key in 256 is like this.
 */
const SHORT_KEY = {
  publicKey: 'BBLkl6E7I7Om0GGP7mxcKAg_76Tv3abzeSIqBN0h1b00LmhGDTkUUSZfD8bT__ASSC9n_sR_YkijUVywouXpjFA',
  privateKey: '86P-ifEjDMERE2jmiB5rltO_2Vzt6hlHPjPSI9FWsQ',
};
const fullShortKey = Buffer.concat([Buffer.from([0]), Buffer.from(SHORT_KEY.privateKey, 'base64url')]);

/** A browser's side of a subscription: what it gives the phone app, and the private key it keeps. */
function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  return {
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth },
    receiver: { privateKey: ecdh.getPrivateKey().toString('base64url'), auth },
  };
}

test('encrypt gives RFC 8291’s worked example, byte for byte, from its keys and salt', () => {
  const body = encrypt(RFC.plaintext, rfcSubscription, {
    salt: Buffer.from(RFC.salt, 'base64url'),
    senderKey: RFC.asPrivate,
  });
  assert.equal(body.toString('base64url'), RFC.message);
});

test('decrypt reads RFC 8291’s worked example with the user agent’s private key', () => {
  const plain = decrypt(Buffer.from(RFC.message, 'base64url'), { privateKey: RFC.uaPrivate, auth: RFC.auth });
  assert.equal(plain.toString('utf8'), RFC.plaintext);
});

test('every note has a new salt and key pair, and only its browser reads it', () => {
  const { keys, receiver } = browserKeys();
  const subscription = { endpoint: 'https://web.push.apple.com/abc', keys };
  const first = encrypt('{"title":"x"}', subscription);
  const second = encrypt('{"title":"x"}', subscription);
  assert.notDeepEqual(first.subarray(0, 86), second.subarray(0, 86));
  assert.equal(decrypt(first, receiver).toString(), '{"title":"x"}');
  const other = browserKeys();
  assert.throws(() => decrypt(first, other.receiver));
  // The record size is 4096, and the sender's key is in the header.
  assert.equal(first.readUInt32BE(16), 4096);
  assert.equal(first[20], 65);
});

test('a note too long for one record is refused', () => {
  const { keys } = browserKeys();
  assert.throws(() => encrypt('x'.repeat(MAX_PAYLOAD_BYTES + 1), { endpoint: '', keys }), /too long/);
  assert.doesNotThrow(() => encrypt('x'.repeat(MAX_PAYLOAD_BYTES), { endpoint: '', keys }));
});

test('the VAPID header is an ES256 JWT for the push service, checked with the public key it names', () => {
  const vapid = vapidKeys();
  assert.equal(Buffer.from(vapid.publicKey, 'base64url').length, 65);
  assert.equal(Buffer.from(vapid.privateKey, 'base64url').length, 32);
  const now = Date.UTC(2026, 9, 29, 12);
  const header = vapidAuthorization('https://web.push.apple.com/QGuq?x=1', vapid, { now });
  const [, jwt, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? [];
  assert.equal(key, vapid.publicKey);
  const [head, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url').toString()), {
    aud: 'https://web.push.apple.com',
    exp: now / 1000 + 12 * 60 * 60,
    sub: SUBJECT,
  });
  // ES256 is r and s side by side, 64 bytes, not DER.
  const raw = Buffer.from(signature, 'base64url');
  assert.equal(raw.length, 64);
  const point = Buffer.from(key, 'base64url');
  const publicKey = crypto.createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
  const signed = Buffer.from(`${head}.${claims}`);
  assert.ok(crypto.verify('sha256', signed, { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw));
  assert.ok(
    !crypto.verify('sha256', Buffer.from(`${head}.${claims}x`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)
  );
  // Another app's key doesn't check it.
  const other = Buffer.from(vapidKeys().publicKey, 'base64url');
  const otherKey = crypto.createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: other.subarray(1, 33).toString('base64url'),
      y: other.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
  assert.ok(!crypto.verify('sha256', signed, { key: otherKey, dsaEncoding: 'ieee-p1363' }, raw));
});

test('a new private key that starts with a zero byte is kept at its full 32 bytes', (t) => {
  assert.equal(Buffer.from(SHORT_KEY.privateKey, 'base64url').length, 31);
  // Every key pair made in this test is the one with the zero byte.
  t.mock.method(crypto.ECDH.prototype, 'generateKeys', function () {
    this.setPrivateKey(Buffer.from(SHORT_KEY.privateKey, 'base64url'));
    return this.getPublicKey();
  });
  const vapid = vapidKeys();
  assert.equal(vapid.publicKey, SHORT_KEY.publicKey);
  assert.deepEqual(Buffer.from(vapid.privateKey, 'base64url'), fullShortKey);
});

test('a kept 31-byte private key still signs, with the full 32 bytes the JWK needs, and keeps its public key', (t) => {
  const createPrivateKey = t.mock.method(crypto, 'createPrivateKey');
  const header = vapidAuthorization('https://web.push.apple.com/QGuq', SHORT_KEY, { now: Date.UTC(2026, 10, 4) });
  const [, jwt, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? [];
  // Subscriptions are made with the public key, so it is never made again.
  assert.equal(key, SHORT_KEY.publicKey);
  assert.equal(createPrivateKey.mock.callCount(), 1);
  const { key: jwk } = createPrivateKey.mock.calls[0].arguments[0];
  assert.deepEqual(Buffer.from(jwk.d, 'base64url'), fullShortKey);
  const [head, claims, signature] = jwt.split('.');
  const point = Buffer.from(key, 'base64url');
  const publicKey = crypto.createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
    format: 'jwk',
  });
  assert.ok(
    crypto.verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url')
    )
  );
});

test('only the push services’ https addresses are allowed', () => {
  for (const endpoint of [
    'https://web.push.apple.com/QGuq',
    'https://api.push.apple.com/x',
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])
    assert.ok(allowedEndpoint(endpoint), endpoint);
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://push.apple.com/x',
    'https://evil.com/web.push.apple.com',
    'https://web.push.apple.com.evil.com/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://notify.windows.com/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'http://127.0.0.1:9999/push',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    `https://fcm.googleapis.com/${'x'.repeat(2100)}`,
    42,
    null,
  ])
    assert.ok(!allowedEndpoint(endpoint), String(endpoint));
});

test('a fake push service on 127.0.0.1 is allowed only when a check run names its origin', () => {
  assert.ok(allowedEndpoint('http://127.0.0.1:9999/push/1', { testOrigin: 'http://127.0.0.1:9999' }));
  assert.ok(!allowedEndpoint('http://127.0.0.1:9998/push/1', { testOrigin: 'http://127.0.0.1:9999' }));
  // Nowhere but this computer, whatever is named.
  assert.ok(!allowedEndpoint('http://example.com:9999/push', { testOrigin: 'http://example.com:9999' }));
  assert.ok(!allowedEndpoint('http://localhost:9999/push', { testOrigin: 'http://localhost:9999' }));
});

test('a subscription needs a push service’s address, a P-256 point and a 16-byte secret', () => {
  const { keys } = browserKeys();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  assert.deepEqual(subscriptionOf({ endpoint, keys, expirationTime: null }), { endpoint, keys });
  assert.equal(subscriptionOf({ endpoint: 'https://evil.com/x', keys }), null);
  assert.equal(subscriptionOf({ endpoint, keys: { ...keys, auth: 'c2hvcnQ' } }), null);
  assert.equal(
    subscriptionOf({ endpoint, keys: { ...keys, p256dh: Buffer.alloc(65, 4).toString('base64url') } }),
    null
  );
  assert.equal(subscriptionOf({ endpoint, keys: { ...keys, p256dh: keys.p256dh.slice(0, 40) } }), null);
  assert.equal(subscriptionOf({ endpoint }), null);
  assert.equal(subscriptionOf(null), null);
  assert.equal(subscriptionOf('nope'), null);
});

test('sendPush posts the encrypted note with VAPID, and a fake push service decrypts it', async (t) => {
  const { keys, receiver } = browserKeys();
  const vapid = vapidKeys();
  const got = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      got.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(request.url === '/gone' ? 410 : 201);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const testOrigin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;

  const sent = await sendPush(
    { endpoint: `${testOrigin}/push/1`, keys },
    { title: 'api-worker needs your permission' },
    { vapid, urgency: 'high', testOrigin }
  );
  assert.equal(sent.status, 201);
  const [{ url, headers, body }] = got;
  assert.equal(url, '/push/1');
  assert.equal(headers['content-encoding'], 'aes128gcm');
  assert.equal(headers['content-type'], 'application/octet-stream');
  assert.equal(headers.ttl, String(TTL_SECONDS));
  assert.equal(headers.urgency, 'high');
  assert.match(headers.authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
  assert.deepEqual(JSON.parse(decrypt(body, receiver).toString()), { title: 'api-worker needs your permission' });

  const gone = await sendPush({ endpoint: `${testOrigin}/gone`, keys }, {}, { vapid, testOrigin });
  assert.equal(gone.status, 410);
});

test('sendPush refuses any address but a push service’s, before connecting', async () => {
  const { keys } = browserKeys();
  await assert.rejects(
    sendPush({ endpoint: 'http://127.0.0.1:1/push', keys }, {}, { vapid: vapidKeys() }),
    /Not the address of a push service/
  );
});
