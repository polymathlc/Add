export const MAX_BYTES = 40 * 1024 * 1024;
export const CHUNK_BYTES = 3 * 1024 * 1024;

export function pdfError(file, maxBytes = MAX_BYTES) {
  if (!file || !/\.pdf$/i.test(file.name || '')) return 'Choose a PDF file.';
  if (!file.size) return 'This PDF is empty.';
  if (file.size > maxBytes) return `PDF limit: ${Math.floor(maxBytes / 1024 / 1024)} MB per file.`;
  return '';
}

// Same audited projection and format as CER tlSig and the durable worker.
// Do not accept older worker signatures: they predate crop/answer-key audits.
export function questionCheckSignature(question) {
  if (!question) return '';
  try {
    // Firestore may reorder nested map keys. Imported questions use the same
    // canonical block projection in CER and its worker; native CER questions
    // retain their existing signature contract. Array/part order stays exact.
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const raw = JSON.stringify({cropAudit: 1, keyImage: question.answerKeyImage || '', t: question.title || '', p: question.topic || '', c: question.category || '', a: !!question.annotation, b: question.rapidImportId ? canonical(question.blocks || []) : question.blocks || []});
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
    return `${raw.length}:ai:${(hash >>> 0).toString(36)}:${raw.slice(0, 4000)}`;
  } catch { return ''; }
}

export function questionFromVettingDocument(id, data) {
  // CER's production collection removes approved/deleted documents outright,
  // and its loader ignores records without a stored question ID. Do not turn
  // an empty/metadata/tombstone-shaped document into an editable question.
  return data && data.id ? {...data, id} : null;
}

export function qualityStatus(question) {
  const check = question?.autoCheck;
  if (check?.state) {
    const signature = questionCheckSignature(question);
    if (!signature || !check.sig || check.sig !== signature) return {state: 'pending', label: 'Check out of date', stale: true};
  }
  if (check?.state === 'error') return {state: 'red', label: 'Check failed'};
  if (check?.state === 'red') return {state: 'red', label: 'Needs review'};
  if (question?.importWarning || question?.diagramWhole || (question?.blocks || []).some(b => b.enhancement?.state === 'error')) return {state: 'amber', label: 'Needs review'};
  if (check?.state === 'green') return {state: 'green', label: 'Checked'};
  if (['amber', 'yellow'].includes(check?.state)) return {state: 'amber', label: 'Needs review'};
  return {state: 'pending', label: 'Not checked'};
}

export function jobMessage(job) {
  if (job.status === 'completed') return `Complete · ${job.added || 0} questions added to vetting`;
  if (job.status === 'uploading') return 'Upload incomplete. Select the same PDF again to resume.';
  if (job.status === 'failed') return `Stopped after page ${job.page || 0}. Retry to continue from the saved checkpoint.`;
  return `Stored online — safe to close · ${job.page || 0}${job.total ? ` / ${job.total}` : ''} pages processed · ${job.added || 0} questions saved`;
}

export function safeImageUrl(value) {
  try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

function transient(error) {
  return /(?:unavailable|internal|deadline-exceeded|resource-exhausted|network-request-failed)$/.test(error?.code || '') || error instanceof TypeError;
}

export async function uploadPdf({file, uid, call, storage, assertCurrent = () => {}, progress = () => {}, settings = {}, maxBytes = MAX_BYTES, chunkBytes = CHUNK_BYTES, digest = async bytes => crypto.subtle.digest('SHA-256', bytes), uuid = () => crypto.randomUUID(), delay = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const error = pdfError(file, maxBytes);
  if (error) throw new Error(error);
  assertCurrent();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('This file does not contain a valid PDF header.');
  const hash = [...new Uint8Array(await digest(bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const resumeKey = `cer-add-upload:${uid}:${hash}`;
  let id = uuid();
  try { const saved = storage?.getItem(resumeKey); if (saved && /^[a-zA-Z0-9_-]{1,100}$/.test(saved)) id = saved; storage?.setItem(resumeKey, id); } catch { /* uploads still work without browser storage */ }
  assertCurrent();
  await call('rapidImportBegin', {...settings, id, name: file.name, size: file.size, autoCheck: true});
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > CHUNK_BYTES) throw new Error('The server returned an unsupported upload chunk size.');
  for (let offset = 0, index = 0; offset < bytes.length; offset += chunkBytes, index++) {
    assertCurrent();
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes));
    let binary = '';
    for (let p = 0; p < chunk.length; p += 32768) binary += String.fromCharCode(...chunk.subarray(p, p + 32768));
    const data = btoa(binary);
    for (let attempt = 0;; attempt++) {
      try { assertCurrent(); await call('rapidImportChunk', {id, index, data}); break; }
      catch (e) { if (attempt >= 2 || !transient(e)) throw e; await delay(1000 * (attempt + 1)); }
    }
    progress({id, percent: Math.round(Math.min(offset + chunkBytes, bytes.length) / bytes.length * 100), stage: 'uploading'});
  }
  assertCurrent();
  progress({id, percent: 100, stage: 'confirming'});
  const result = await call('rapidImportFinish', {id});
  if (result?.queued !== true) throw new Error('Online storage was not acknowledged. Select this PDF again to resume.');
  // Retain the content-addressed ID: a lost Finish response or repeat selection
  // must resume the same durable job instead of creating duplicate questions.
  progress({id, percent: 100, stage: 'stored'});
  return {id};
}
