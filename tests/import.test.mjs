import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {uploadPdf, qualityStatus, questionCheckSignature, questionFromVettingDocument, pdfError, jobMessage, safeImageUrl, MAX_BYTES} from '../import-core.js';
import {importTopics} from '../config.js';

const file = (text = '%PDF-1.7\nmock exam', name = 'paper.pdf') => new File([text], name, {type: 'application/pdf'});
const memory = () => {const data = new Map(); return {getItem: key => data.get(key), setItem: (key, value) => data.set(key, value)};};
const base = extra => ({file: file(), uid: 'teacher', chunkBytes: 6, storage: memory(), digest: bytes => webcrypto.subtle.digest('SHA-256', bytes), uuid: () => 'import-1', delay: async () => {}, ...extra});
const checked = (question = {}, state = 'green') => ({...question, autoCheck: {state, sig: questionCheckSignature(question)}});

test('PDF guard rejects empty, oversized and non-PDF files before upload', async () => {
  assert.match(pdfError(file('', 'paper.pdf')), /empty/);
  assert.match(pdfError({name: 'paper.pdf', size: MAX_BYTES + 1}), /40 MB/);
  assert.match(pdfError(file('hello', 'image.png')), /PDF/);
  let calls = 0;
  await assert.rejects(uploadPdf(base({file: file('not a PDF'), call: async () => {calls++;}})), /header/);
  assert.equal(calls, 0);
});

test('safe-to-close is emitted only after server acknowledgement; chunks preserve bytes', async () => {
  const calls = [], progress = [], chunks = [];
  const result = await uploadPdf(base({settings: {autoCheck: false, prompt: 'read'}, progress: update => progress.push(update.stage), call: async (name, data) => {
    calls.push(name);
    if (name === 'rapidImportBegin') assert.equal(data.autoCheck, true);
    if (name === 'rapidImportChunk') chunks.push(Buffer.from(data.data, 'base64'));
    if (name === 'rapidImportFinish') {assert.ok(!progress.includes('stored')); return {queued: true};}
    return {};
  }}));
  assert.equal(result.id, 'import-1');
  assert.equal(Buffer.concat(chunks).toString(), '%PDF-1.7\nmock exam');
  assert.equal(calls.at(-1), 'rapidImportFinish');
  assert.equal(progress.at(-1), 'stored');
});

test('failed or ambiguous final acknowledgement never says stored', async () => {
  const progress = [];
  await assert.rejects(uploadPdf(base({progress: update => progress.push(update.stage), call: async name => name === 'rapidImportFinish' ? {} : {}})), /not acknowledged/);
  assert.ok(!progress.includes('stored'));
});

test('a lost finish response reuses the exact same import ID on repeat selection', async () => {
  const storage = memory(), ids = [];
  let fail = true;
  const call = async (name, data) => { if (name === 'rapidImportBegin') ids.push(data.id); if (name === 'rapidImportFinish' && fail) {fail = false; throw new Error('Response lost');} return {queued: true}; };
  await assert.rejects(uploadPdf(base({storage, call})), /lost/);
  await uploadPdf(base({storage, call, uuid: () => 'different-id'}));
  assert.deepEqual(ids, ['import-1', 'import-1']);
});

test('different users do not share resume IDs, same-name changed content gets a new job', async () => {
  const storage = memory(), ids = [];
  const call = async (name, data) => {if (name === 'rapidImportBegin') ids.push(data.id); return {queued: true};};
  await uploadPdf(base({storage, call}));
  await uploadPdf(base({storage, call, uid: 'other', uuid: () => 'other-id'}));
  await uploadPdf(base({storage, call, file: file('%PDF-1.7\nchanged'), uuid: () => 'changed-id'}));
  assert.deepEqual(ids, ['import-1', 'other-id', 'changed-id']);
});

test('transient chunk failure retries in place, permission failure stops immediately', async () => {
  let attempts = 0;
  await uploadPdf(base({chunkBytes: 100, call: async name => {if (name === 'rapidImportChunk' && ++attempts < 3) throw Object.assign(new Error('retry'), {code: 'functions/unavailable'}); return {queued: true};}}));
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(uploadPdf(base({call: async name => {if (name === 'rapidImportChunk') {attempts++; throw Object.assign(new Error('denied'), {code: 'functions/permission-denied'});} return {};}})), /denied/);
  assert.equal(attempts, 1);
});

test('account change after a chunk fences the remaining upload and finish', async () => {
  let current = true; const calls = [];
  await assert.rejects(uploadPdf(base({assertCurrent: () => {if (!current) throw Error('Account changed');}, call: async name => {calls.push(name); if (name === 'rapidImportChunk') current = false; return {};}})), /Account changed/);
  assert.equal(calls.filter(name => name === 'rapidImportChunk').length, 1);
  assert.ok(!calls.includes('rapidImportFinish'));
});

test('missing or failed checks are never green; unresolved source and enhancement issues remain yellow', () => {
  assert.equal(qualityStatus({}).state, 'pending');
  assert.equal(qualityStatus(checked({}, 'error')).state, 'red');
  assert.equal(qualityStatus(checked({diagramWhole: true})).state, 'amber');
  assert.equal(qualityStatus(checked({blocks: [{enhancement: {state: 'error'}}]})).state, 'amber');
  assert.equal(qualityStatus(checked()).state, 'green');
  assert.match(jobMessage({status: 'uploading'}), /incomplete/);
  assert.match(jobMessage({status: 'queued'}), /safe to close/);
});

test('green requires the current CER content audit; missing, old and edited signatures are explicitly stale', () => {
  const question = checked({title: 'A question', topic: 'Heat', category: 'Explanation', blocks: [{id: 't', type: 'text', content: 'Explain.'}, {id: 'im', type: 'image', url: 'https://example.com/image.png', cropSource: {box_2d: [0, 0, 500, 500]}}]});
  assert.equal(qualityStatus(question).state, 'green');
  for (const patch of [{title: 'Edited title'}, {topic: 'Light'}, {category: 'CER'}, {answerKeyImage: 'https://example.com/new-key.png'}, {annotation: true}, {blocks: [...question.blocks, {id: 'a', type: 'answer', claim: 'Different answer'}]}]) {
    assert.deepEqual(qualityStatus({...question, ...patch}), {state: 'pending', label: 'Check out of date', stale: true});
  }
  const cropEdit = structuredClone(question); cropEdit.blocks[1].cropSource.box_2d[0] = 50;
  assert.equal(qualityStatus(cropEdit).stale, true);
  for (const sig of ['', 'old-pre-crop-audit-signature']) assert.equal(qualityStatus({...question, autoCheck: {state: 'green', sig}}).stale, true);
  assert.equal(qualityStatus({...question, tags: ['new-tag'], sourcePdf: 'new-name.pdf'}).state, 'green', 'bookkeeping does not invalidate a check');
});

test('check signature hashes text beyond its 4000-character stored prefix and rejects nonserializable questions', () => {
  const question = checked({blocks: [{type: 'text', content: 'A'.repeat(5000)}]});
  const changed = structuredClone(question); changed.blocks[0].content = 'A'.repeat(4999) + 'B';
  assert.equal(question.autoCheck.sig.split(':').slice(3).join(':'), questionCheckSignature(changed).split(':').slice(3).join(':'));
  assert.equal(qualityStatus(changed).stale, true);
  const circular = {blocks: []}; circular.blocks.push(circular);
  assert.equal(questionCheckSignature(circular), '');
  assert.equal(qualityStatus({...circular, autoCheck: {state: 'green', sig: ''}}).stale, true);
});

test('import checks survive Firestore map-key reordering but retain ordered content and native CER compatibility', () => {
  const question = {rapidImportId: 'paper-a', title: 'Q', blocks: [{id: 'img', type: 'image', url: 'https://example.com/a.png', cropSource: {url: 'https://example.com/page.png', box_2d: [1, 2, 30, 40]}}, {id: 't', type: 'text', content: 'Explain.'}]};
  const reordered = {...question, blocks: [{cropSource: {box_2d: [1, 2, 30, 40], url: 'https://example.com/page.png'}, url: 'https://example.com/a.png', type: 'image', id: 'img'}, {content: 'Explain.', type: 'text', id: 't'}]};
  assert.equal(questionCheckSignature(question), questionCheckSignature(reordered));
  assert.notEqual(questionCheckSignature(question), questionCheckSignature({...reordered, blocks: [...reordered.blocks].reverse()}));
  const changed = structuredClone(reordered); changed.blocks[0].cropSource.box_2d[0] = 2;
  assert.notEqual(questionCheckSignature(question), questionCheckSignature(changed));
  const native = {...question}; delete native.rapidImportId;
  const nativeReordered = {...reordered}; delete nativeReordered.rapidImportId;
  assert.notEqual(questionCheckSignature(native), questionCheckSignature(nativeReordered), 'native CER signatures keep their established property-order contract');
});

test('vetting collection matches CER: metadata-only records are not fabricated into questions', () => {
  assert.equal(questionFromVettingDocument('empty', null), null);
  assert.equal(questionFromVettingDocument('metadata', {deletedAt: '2026-10-01', status: 'deleted'}), null);
  assert.equal(questionFromVettingDocument('empty-id', {id: '', blocks: []}), null);
  assert.deepEqual(questionFromVettingDocument('document-id', {id: 'stored-id', title: 'Question'}), {id: 'document-id', title: 'Question'});
});

test('image links reject executable and non-web URLs', () => {
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('data:text/html,test'), '');
  assert.equal(safeImageUrl('https://example.com/crop.png'), 'https://example.com/crop.png');
});

test('topic selection follows CER levels, custom topics and removals', () => {
  assert.deepEqual(importTopics('P3', {removed: ['Magnets'], custom: {'New topic': 'P3', 'Unsupported': 'S4'}}), ['Living and non-living things','Materials','Life Cycles','New topic']);
  assert.ok(importTopics('S1').includes('Cells — The Basic Unit of Life'));
  assert.ok(!importTopics('P5').includes('Cells — The Basic Unit of Life'));
});
