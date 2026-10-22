/** The audit log never carries personal data, whatever a caller passes. */
import { describe, expect, it } from 'vitest';
import { auditLine } from './audit';

describe('audit lines', () => {
  it('is one JSON line with the event and the time', () => {
    const o = JSON.parse(auditLine('signin.requested', { ok: true }, Date.UTC(2026, 9, 20, 12)));
    expect(o).toEqual({ audit: 'signin.requested', at: '2026-10-20T12:00:00.000Z', ok: true });
  });
  it('drops fields that would carry an address, a secret or a message, and truncates the rest', () => {
    const o = JSON.parse(auditLine('x', { email: 'p@e.co', Token: 'abc', code: '123456', message: 'hi', key: 'k', cookie: 'c', kind: 'refund', long: 'y'.repeat(500), gone: undefined }));
    expect(Object.keys(o).sort()).toEqual(['at', 'audit', 'kind', 'long']);
    expect(o.long).toHaveLength(120);
  });
});
