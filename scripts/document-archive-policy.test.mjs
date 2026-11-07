import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyDocumentArchive } from './document-archive-policy.mjs';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const digest = value => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bunfirvil-document-policy-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const archive = path.join(root, 'documents');
  await mkdir(archive);
  const manifestPath = path.join(archive, 'document-catalog.v1.json');
  const document = {
    id: 'sale-notice', title: '공식 모집공고', description: '검토한 공식 공고 보관본입니다.', category: 'official',
    file: 'documents/sale-notice-20260702.pdf', sourceUrl: 'https://www.elife.co.kr/notice.pdf', sourceLabel: '공식 공고',
    retrievedAt: '2026-11-07', pageCount: 1, bytes: PDF.length, sha256: digest(PDF),
  };
  const catalog = { schemaVersion: 1, updatedAt: '2026-11-07', documents: [document] };
  const save = () => writeFile(manifestPath, JSON.stringify(catalog));
  await writeFile(path.join(root, document.file), PDF);
  await save();
  return { root, archive, manifestPath, document, catalog, save };
}
const fails = async (root, pattern) => {
  const result = await verifyDocumentArchive(root);
  assert.ok(result.failures.length > 0);
  if (pattern) assert.match(result.failures.join('\n'), pattern);
  return result;
};

test('reviewed archive returns exact PDF+catalog bytes and absolute file membership', async t => {
  const f = await fixture(t);
  const result = await verifyDocumentArchive(f.root);
  assert.deepEqual(result.failures, []);
  assert.equal(result.bytes, PDF.length + (await readFile(f.manifestPath)).length);
  assert.deepEqual(result.files, new Set([f.manifestPath, path.join(f.root, f.document.file)]));
});

test('generated bounded HTML viewer is accepted but remains entirely in the application budget', async t => {
  const f = await fixture(t);
  const viewer = path.join(f.archive, 'index.html');
  await writeFile(viewer, '<!doctype html><html lang="ko"><head><title>문서</title></head><body>PDF viewer</body></html>');
  const result = await verifyDocumentArchive(f.root);
  assert.deepEqual(result.failures, []);
  assert.equal(result.bytes, PDF.length + (await readFile(f.manifestPath)).length);
  assert.equal(result.files.has(viewer), false);
  assert.equal(result.files.size, 2);
});

test('PDF disguised as index.html, missing HTML doctype and oversized viewer are rejected', async t => {
  const f = await fixture(t);
  const viewer = path.join(f.archive, 'index.html');
  await writeFile(viewer, PDF); await fails(f.root, /disguised PDF/);
  await writeFile(viewer, '<html><body>Missing doctype</body></html>'); await fails(f.root, /HTML document/);
  await writeFile(viewer, '<!doctype html><html><body></body></html>');
  await truncate(viewer, 128 * 1024 + 1); await fails(f.root, /128 KiB/);
});

test('approved mortgage source is permanent KB, never expiring vFlat/CDN URLs', async t => {
  const f = await fixture(t);
  Object.assign(f.document, { id: 'mortgage-product', category: 'mortgage', sourceUrl: 'https://obank.kbstar.com/quics?page=C020709' });
  await f.save();
  assert.deepEqual((await verifyDocumentArchive(f.root)).failures, []);
  for (const sourceUrl of ['https://share.vflat.com/Tbc9Yv', 'https://cdn.example.com/source.pdf?signature=secret', 'https://www.elife.co.kr/notice.pdf', 'http://obank.kbstar.com/', 'https://user:pass@obank.kbstar.com/']) {
    f.document.sourceUrl = sourceUrl; await f.save(); await fails(f.root, /source/);
  }
});

test('public contract procedure notice is permitted but signed contract paths are rejected', async t => {
  const f = await fixture(t);
  Object.assign(f.document, { id: 'contract-procedure', file: 'documents/contract-procedure-20261028.pdf' });
  await rm(path.join(f.archive, 'sale-notice-20260702.pdf'));
  await writeFile(path.join(f.root, f.document.file), PDF); await f.save();
  assert.deepEqual((await verifyDocumentArchive(f.root)).failures, []);
  for (const name of ['signed-contract.pdf', 'personal-contract.pdf', 'account-dump.pdf', 'auth-sheet.pdf', 'members-raw.pdf', 'contract-private.pdf']) {
    f.document.file = `documents/${name}`; await f.save(); await fails(f.root, /filename/);
  }
});

test('schema fields, approved IDs, dates and required integrity metadata fail closed', async t => {
  const f = await fixture(t);
  const initial = { ...f.document };
  for (const invalid of [
    { id: 'unreviewed' }, { id: 'personal-contract' }, { nickname: 'private' }, { accountNumber: 'private' },
    { pageCount: 0 }, { pageCount: 1.5 }, { bytes: 0 }, { bytes: Number.MAX_SAFE_INTEGER + 1 }, { sha256: 'invalid' },
    { retrievedAt: '2026-02-30' }, { category: 'mortgage' }, { summaryGuideId: '../admin' },
  ]) {
    f.catalog.documents = [{ ...initial, ...invalid }]; await f.save(); await fails(f.root);
  }
  f.catalog.documents = [initial];
  for (const field of ['pageCount', 'bytes', 'sha256']) {
    const entry = { ...initial }; delete entry[field]; f.catalog.documents = [entry]; await f.save(); await fails(f.root, /metadata/);
  }
  f.catalog.documents = [initial]; f.catalog.schemaVersion = 2; await f.save(); await fails(f.root, /schema/);
});

test('empty catalog, unknown root fields and duplicate ID/file paths are rejected', async t => {
  const f = await fixture(t);
  f.catalog.documents = []; await f.save(); await fails(f.root, /count/);
  f.catalog.documents = [f.document, { ...f.document }]; await f.save(); await fails(f.root, /duplicate/);
  f.catalog.documents[1] = { ...f.document, id: 'supply-guide' }; await f.save(); await fails(f.root, /duplicate archived/);
  f.catalog.documents = [f.document]; f.catalog.privateDump = true; await f.save(); await fails(f.root, /schema/);
});

test('PDF source bytes, header and declared digest must match', async t => {
  const f = await fixture(t);
  f.document.bytes += 1; await f.save(); await fails(f.root, /byte size/);
  f.document.bytes = PDF.length; f.document.sha256 = '0'.repeat(64); await f.save(); await fails(f.root, /SHA-256/);
  const wrong = Buffer.from('not a PDF'); await writeFile(path.join(f.root, f.document.file), wrong);
  f.document.bytes = wrong.length; f.document.sha256 = digest(wrong); await f.save(); await fails(f.root, /signature/);
});

test('unknown PDF and raw sheet dump files are rejected even when approved documents pass', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.archive, 'unlisted.pdf'), PDF); await fails(f.root, /undeclared/);
  await rm(path.join(f.archive, 'unlisted.pdf'));
  await writeFile(path.join(f.archive, 'members.csv'), 'private-header-only'); await fails(f.root, /undeclared/);
});

test('path traversal, URLs, encoded paths and missing archive are rejected', async t => {
  const f = await fixture(t);
  for (const file of ['../private.pdf', 'documents/../private.pdf', '/documents/source.pdf', 'https://example.com/a.pdf', 'documents/%2e%2e.pdf', 'documents/a\\b.pdf', 'documents/a.pdf?account=private']) {
    f.document.file = file; await f.save(); await fails(f.root, /path/);
  }
  await fails(path.join(f.root, 'missing'), /directory/);
});

test('symlinked archive directories and nested directories are rejected without traversal', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.archive, 'nested')); await fails(f.root, /nested/);
  const otherRoot = path.join(f.root, 'other-app'); await mkdir(otherRoot);
  try { await symlink(f.archive, path.join(otherRoot, 'documents'), 'junction'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('symlink creation is unavailable on this Windows host'); return; } throw error; }
  await fails(otherRoot, /symlink/);
});

test('a PDF symlink cannot approve a file outside the archive', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'outside.pdf'); await writeFile(source, PDF);
  await rm(path.join(f.root, f.document.file));
  try { await symlink(source, path.join(f.root, f.document.file), 'file'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('file symlink creation is unavailable on this Windows host'); return; } throw error; }
  await fails(f.root, /symlink/);
});

test('per-PDF limit is 35 MiB without reading oversized PDF bytes', async t => {
  const f = await fixture(t);
  await truncate(path.join(f.root, f.document.file), 35 * 1024 * 1024 + 1);
  f.document.bytes = 35 * 1024 * 1024 + 1; await f.save(); await fails(f.root, /single PDF exceeds 35 MiB/);
});

test('total archive limit is 50 MiB and includes catalog bytes without allocating huge buffers', async t => {
  const f = await fixture(t);
  const extra = path.join(f.archive, 'unlisted-large.pdf');
  await writeFile(extra, PDF);
  // Sparse test fixture: PDF-sized files alone total exactly 50 MiB. Only the
  // catalog pushes the archive over the cap. Unlisted bytes must count too.
  await truncate(extra, 50 * 1024 * 1024 - PDF.length);
  const result = await fails(f.root, /total archive including catalog exceeds 50 MiB/);
  assert.equal(result.bytes, 50 * 1024 * 1024 + (await readFile(f.manifestPath)).length);
});
