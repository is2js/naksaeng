import { describe, expect, it } from 'vitest';
import { parseDocumentCatalog } from './catalog';

const document = () => ({
  id: 'mortgage-product', title: '전용 모기지 상품설명서', description: '상품 조건을 확인하는 보관본입니다.',
  category: 'mortgage', file: 'documents/mortgage-product-20261107.pdf', sourceUrl: 'https://example.com/product',
  sourceLabel: '원문', retrievedAt: '2026-11-07', pageCount: 12, bytes: 25000,
  sha256: 'a'.repeat(64), summaryGuideId: 'mortgage-product', notice: '실제 심사 조건을 확인하세요.',
});
const catalog = (entry = document()) => ({ schemaVersion: 1, updatedAt: '2026-11-07', documents: [entry] });

describe('public archived document catalog', () => {
  it('accepts reviewed local PDF metadata and explicitly returns only known fields', () => {
    const entry = { ...document(), privateField: 'never render unknown fields' };
    const parsed = parseDocumentCatalog(catalog(entry));
    expect(parsed.documents).toEqual([document()]);
    expect(parsed.schemaVersion).toBe(1);
  });

  it.each(['../private.pdf', 'documents/../private.pdf', '/documents/source.pdf', 'https://example.com/a.pdf', 'documents/%2e%2e.pdf', 'documents/source.PDF', 'documents/source.svg', 'documents/a\\b.pdf', 'documents/a.pdf?nickname=test'])('rejects non-local or ambiguous PDF paths %s', (file) => {
    expect(() => parseDocumentCatalog(catalog({ ...document(), file }))).toThrow();
  });

  it.each(['javascript:alert(1)', 'http://example.com/file', 'https://user:password@example.com/file', 'data:application/pdf,'])('rejects unsafe source URLs %s', (sourceUrl) => {
    expect(() => parseDocumentCatalog(catalog({ ...document(), sourceUrl }))).toThrow();
  });

  it.each([
    { pageCount: 0 }, { bytes: -1 }, { bytes: Number.MAX_SAFE_INTEGER + 1 }, { sha256: 'invalid' },
    { summaryGuideId: '../admin' }, { retrievedAt: '2026-02-30' }, { category: 'private' }, { title: '' },
  ])('fails closed for invalid metadata %j', (invalid) => {
    expect(() => parseDocumentCatalog(catalog({ ...document(), ...invalid }))).toThrow();
  });

  it('rejects duplicate IDs or archived file paths and excessive catalog size', () => {
    expect(() => parseDocumentCatalog({ ...catalog(), documents: [document(), document()] })).toThrow();
    expect(() => parseDocumentCatalog({ ...catalog(), documents: [document(), { ...document(), id: 'another-document' }] })).toThrow();
    expect(() => parseDocumentCatalog({ ...catalog(), documents: Array.from({ length: 33 }, () => document()) })).toThrow();
  });

  it('rejects unsupported schema or malformed root without returning partial documents', () => {
    for (const invalid of [null, [], { ...catalog(), schemaVersion: 2 }, { ...catalog(), documents: null }, { ...catalog(), updatedAt: '2026-13-01' }]) {
      expect(() => parseDocumentCatalog(invalid)).toThrow();
    }
    expect(parseDocumentCatalog({ ...catalog(), documents: [] }).documents).toEqual([]);
  });
});
