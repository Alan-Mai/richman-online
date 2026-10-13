import { describe, expect, it } from 'vitest';
import { devAssetSource } from './asset-source';

function fakeFetch(files: Record<string, string>) {
  const calls: { url: string; method: string }[] = [];
  const fn: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? 'GET' });
    const body = files[url];
    return Promise.resolve(
      body === undefined ? new Response('not found', { status: 404 }) : new Response(body),
    );
  };
  return { fn, calls };
}

describe('devAssetSource', () => {
  it('reads text through the dev middleware route', async () => {
    const { fn, calls } = fakeFetch({ '/local-assets/maps/0/map.json': '{"a":1}' });
    const source = devAssetSource(fn);
    expect(await source.readText('0/map.json')).toBe('{"a":1}');
    expect(calls).toEqual([{ url: '/local-assets/maps/0/map.json', method: 'GET' }]);
  });

  it('returns null for missing files and network errors', async () => {
    const source = devAssetSource(fakeFetch({}).fn);
    expect(await source.readText('index.json')).toBeNull();
    expect(await source.imageUrl('0/background.png')).toBeNull();
    const failing = devAssetSource(() => Promise.reject(new Error('offline')));
    expect(await failing.readText('index.json')).toBeNull();
  });

  it('gives image URLs after checking they exist', async () => {
    const { fn, calls } = fakeFetch({ '/local-assets/maps/3/background.png': 'png' });
    const source = devAssetSource(fn);
    expect(await source.imageUrl('3/background.png')).toBe('/local-assets/maps/3/background.png');
    expect(calls[0]?.method).toBe('HEAD');
  });

  it('encodes each path segment', async () => {
    const { fn, calls } = fakeFetch({});
    await devAssetSource(fn).readText('a b/#.json');
    expect(calls[0]?.url).toBe('/local-assets/maps/a%20b/%23.json');
  });
});
