import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../site/worker.js';

const OLD_SITE = 'https://agent-messenger.tsafaelmali-b18.workers.dev';

for (const redirectOrigin of [OLD_SITE, 'https://www.buddylist.dev']) {
  test(`${redirectOrigin} permanently redirects before accessing assets or forms`, async () => {
    for (const path of [
      '/',
      '/changelog',
      '/demo/?tour=1&utm_source=old',
      '/site.css',
      '/missing',
      '//elsewhere.example/a%20b?q=a%2Fb',
    ]) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const response = await worker.fetch(new Request(redirectOrigin + path, { method }), {});
        assert.equal(response.status, 308);
        assert.equal(response.headers.get('location'), 'https://buddylist.dev' + path);
      }
    }
    const response = await worker.fetch(
      new Request(redirectOrigin + '/api/feedback', { method: 'POST', body: 'report' }),
      {}
    );
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), 'https://buddylist.dev/api/feedback');
  });
}

test('custom domains and local previews serve assets without a redirect loop', async () => {
  for (const origin of ['https://buddylist.dev', 'http://localhost:8787']) {
    const request = new Request(origin + '/demo/?tour=1');
    const asset = new Response('demo', { headers: { 'content-type': 'text/html' } });
    const response = await worker.fetch(request, {
      ASSETS: {
        async fetch(received) {
          assert.equal(received, request);
          return asset;
        },
      },
    });
    assert.equal(response, asset);
    assert.equal(response.headers.get('location'), null);
  }
});
