/** Request bodies are capped before they are read, and must be UTF-8 JSON objects. */
import { describe, expect, it } from 'vitest';
import { readCapped, readJson, json } from './http';

const req = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request('https://x.test/', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);

describe('request bodies', () => {
  it('reads a small JSON object', async () => {
    expect(await readJson(req('{"email":"a@b.co"}'))).toEqual({ email: 'a@b.co' });
  });
  it('refuses a declared length over the limit without reading', async () => {
    expect(await readCapped(req('x', { 'content-length': '999999' }), 2048)).toBeNull();
    expect(await readCapped(req('x', { 'content-length': 'abc' }), 2048)).toBeNull();
  });
  it('stops reading a stream that grows past the limit', async () => {
    let pulled = 0;
    const big = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); if (pulled > 1000) c.close(); } });
    expect(await readCapped(req(big), 4096)).toBeNull();
    expect(pulled).toBeLessThan(20);
  });
  it('refuses bytes that are not UTF-8, arrays and non-JSON', async () => {
    expect(await readCapped(req(new Uint8Array([0xff, 0xfe, 0x41])), 2048)).toBeNull();
    expect(await readJson(req('[1,2]'))).toBeNull();
    expect(await readJson(req('not json'))).toBeNull();
    expect(await readJson(req('"a string"'))).toBeNull();
  });
  it('sends the security headers on every API answer', () => {
    const h = json({ ok: true }).headers;
    for (const k of ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'cache-control', 'referrer-policy', 'permissions-policy']) expect(h.get(k), k).toBeTruthy();
  });
});
