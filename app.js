import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth, onAuthStateChanged, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore, collection, doc, onSnapshot} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {getFunctions, httpsCallable} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import {firebaseConfig, CER_URL, importTopics, READING_PROMPT} from './config.js';
import {uploadPdf, qualityStatus, questionFromVettingDocument, MAX_BYTES, CHUNK_BYTES} from './import-core.js';
import {el, renderJobs, renderQuestion} from './view.js';

const firebase = initializeApp(firebaseConfig);
const auth = getAuth(firebase), db = getFirestore(firebase), fns = getFunctions(firebase, 'us-central1');
const $ = id => document.getElementById(id);
let user = null, epoch = 0, ready = false, status = {}, questions = [], jobs = [], unsubscribe = null, topicsUnsubscribe = null, topicSettings = {}, timer = null, uploadTail = Promise.resolve(), activeUploads = 0, toastTimer;
const imageBusy = new Set();
let previewIds = [], frameReady = false;
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').className = `notice${error ? ' error' : ''}`; };
const call = async (name, data = {}, timeout = 120000) => (await httpsCallable(fns, name, {timeout})(data)).data;
const toast = message => { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => {$('toast').hidden = true;}, 7000); };

function errorMessage(error) {
  if (/permission-denied/.test(error?.code)) return 'This tool requires a CER administrator account with a verified email address.';
  if (/unauthenticated|invalid-credential|wrong-password|user-not-found/.test(error?.code)) return 'Sign in with your existing CER account. Check your email and password.';
  if (/unauthorized-domain/.test(error?.code)) return 'This website domain must be authorised in Firebase Authentication before Google sign-in can work. Email and password sign-in is also available.';
  if (/popup-closed|cancelled-popup/.test(error?.code)) return 'Sign-in was cancelled.';
  if (/aborted/.test(error?.code)) return 'This question changed in CER while you were editing. The latest version has been loaded; try again.';
  return error?.message || 'Connection interrupted. Please try again.';
}

async function refreshStatus() {
  clearTimeout(timer);
  if (!user) return;
  const ticket = epoch, hadImageEditing = ready && status.capabilities?.imageEditing === true;
  $('refresh').disabled = true;
  try {
    const result = await call('rapidImportStatus');
    if (ticket !== epoch) return;
    status = result; ready = result.available === true;
    jobs = Array.isArray(result.jobs) ? result.jobs : [];
    $('server-state').textContent = ready ? 'Server connected' : 'Server unavailable';
    $('server-state').className = `status ${ready ? 'green' : 'amber'}`;
    $('pdf-files').disabled = !ready;
    const fullWorker = status.capabilities?.automaticChecks && status.capabilities?.automaticEnhancement;
    notice(!ready ? 'The CER import service is not ready. Uploads are disabled.' : fullWorker ? 'Connected. Uploads go directly to your CER vetting list.' : 'Connected to the import worker. Automatic checking is enabled; automatic colour and B&W enhancement need the latest CER worker deployment.');
    paintJobs();
    if (hadImageEditing !== (ready && status.capabilities?.imageEditing === true)) paintQuestions();
    if (ready && !unsubscribe) watchVetting(ticket);
  } catch (error) {
    if (ticket !== epoch) return;
    ready = false; $('pdf-files').disabled = true;
    $('server-state').textContent = 'Connection needs attention'; $('server-state').className = 'status amber';
    notice(`Upload service unavailable. ${errorMessage(error)} Retry after checking the connection or deploying the CER worker. Previously acknowledged imports remain on the server.`, true);
    if (hadImageEditing) paintQuestions();
  } finally {
    if (ticket === epoch) { $('refresh').disabled = false; timer = setTimeout(refreshStatus, document.hidden ? 30000 : 10000); }
  }
}

function watchVetting(ticket) {
  if (!topicsUnsubscribe) topicsUnsubscribe = onSnapshot(doc(db, 'users', user.uid, 'settings', 'topics'), snapshot => {if (ticket === epoch) topicSettings = snapshot.data() || {};}, () => {});
  unsubscribe = onSnapshot(collection(db, 'users', user.uid, 'vetting'), snapshot => {
    if (ticket !== epoch) return;
    questions = snapshot.docs.map(doc => questionFromVettingDocument(doc.id, doc.data())).filter(Boolean).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(a.sourceQuestionNumber || '').localeCompare(String(b.sourceQuestionNumber || ''), undefined, {numeric: true}));
    $('sync-state').textContent = snapshot.metadata.fromCache ? 'Showing cached questions. Waiting for server sync…' : 'Live sync with your CER vetting list';
    paintQuestions();
  }, error => {
    if (ticket !== epoch) return;
    unsubscribe?.(); unsubscribe = null;
    $('sync-state').textContent = `Could not sync the vetting list. ${errorMessage(error)}`;
  });
}

function visibleQuestions() {
  const text = $('search').value.trim().toLowerCase(), quality = $('quality-filter').value, paper = $('paper-filter').value;
  return questions.filter(q => (!text || [q.title, q.topic, q.sourcePdf].some(value => String(value || '').toLowerCase().includes(text))) && (quality === 'all' || qualityStatus(q).state === quality) && (paper === 'all' || q.rapidImportId === paper));
}

function paintQuestions() {
  const paperSelect = $('paper-filter'), previous = paperSelect.value;
  const papers = new Map(questions.filter(q => q.rapidImportId).map(q => [q.rapidImportId, q.sourcePdf || q.rapidImportId]));
  paperSelect.replaceChildren(el('option', {value: 'all', text: 'All papers'}), ...[...papers].map(([value, text]) => el('option', {value, text})));
  paperSelect.value = papers.has(previous) ? previous : 'all';
  const filtered = visibleQuestions();
  $('question-count').textContent = filtered.length === questions.length ? String(questions.length) : `${filtered.length} / ${questions.length}`;
  $('preview-all').disabled = !filtered.length;
  const options = {busy: imageBusy, imageEditing: ready && status.capabilities?.imageEditing === true, imageAction, preview: openPreview};
  $('questions').replaceChildren(...(filtered.length ? filtered.map((q, i) => renderQuestion(q, i, options)) : [el('p', {class: 'empty', text: questions.length ? 'No questions match these filters.' : 'Questions will appear here as CER saves them to vetting.'})]));
}

function paintJobs() {
  $('jobs').replaceChildren(...renderJobs(jobs, {
    retry: async id => { try {await call('rapidImportRetry', {id}); toast('Retry queued on the server.'); await refreshStatus();} catch (error) {toast(errorMessage(error));} },
    filter: id => { if ([...$('paper-filter').options].some(option => option.value === id)) { $('paper-filter').value = id; $('quality-filter').value = 'all'; $('search').value = ''; paintQuestions(); $('vetting-title').scrollIntoView({behavior: 'smooth'}); } else toast('The questions are still syncing. Please try again shortly.'); }
  }));
}

function acceptFiles(files) {
  if (!ready || !user) { toast('Sign in and connect to the CER worker before uploading.'); return; }
  const uid = user.uid, ticket = epoch;
  const topics = importTopics($('level').value, topicSettings);
  if (!topics.length) {toast('No CER topics are configured. Add a topic in CER before importing.'); return;}
  const settings = {prompt: `${READING_PROMPT}\nChoose a topic from: ${topics.join('; ')}.\nSchool level: ${$('level').value || 'P3–P6 or Secondary 1, as appropriate'}.\n${$('instructions').value}`, level: $('level').value, release: $('release').value, topics, engineOrder: ['openai','gemini'], autoCheck: true};
  const limits = {maxBytes: Math.min(status.maxBytes || MAX_BYTES, MAX_BYTES), chunkBytes: status.chunkBytes || CHUNK_BYTES};
  for (const file of files) {
    const description = el('p', {text: 'Waiting to upload — keep this page open.'});
    const progress = el('progress', {max: 100, value: 0, 'aria-label': `Upload ${file.name}`});
    const row = el('div', {class: 'upload-row'}, [el('strong', {text: file.name}), description, progress]);
    $('uploads').prepend(row); activeUploads++;
    const upload = async () => {
      try {
        let browserStorage;
        try {browserStorage = localStorage;} catch { /* storage may be disabled in private sessions */ }
        await uploadPdf({file, uid, call, storage: browserStorage, settings, ...limits,
          assertCurrent: () => { if (ticket !== epoch || auth.currentUser?.uid !== uid) throw new Error('Account changed. Select this PDF again after signing in.'); },
          progress: update => {
            progress.value = update.percent;
            description.textContent = update.stage === 'stored' ? 'Stored online — safe to close. Questions will continue arriving in CER.' : update.stage === 'confirming' ? 'Confirming online storage — keep this page open.' : `Uploading ${update.percent}% — keep this page open.`;
          }});
        if (ticket === epoch) await refreshStatus();
      } catch (error) {
        description.textContent = `${errorMessage(error)} Select the same PDF again to resume.`; description.className = 'error-text';
      } finally { activeUploads--; }
    };
    uploadTail = uploadTail.then(upload, upload);
  }
}

async function imageAction(question, block, change) {
  if (!ready || !status.capabilities?.imageEditing) return;
  const key = `${question.id}:${block.id}`, ticket = epoch;
  if (imageBusy.has(key)) return;
  imageBusy.add(key); paintQuestions();
  try {
    const result = await call('rapidVettingImage', {questionId: question.id, blockId: block.id, expectedUrl: block.url, ...change}, 540000);
    if (ticket !== epoch) return;
    if (result.question) {const at = questions.findIndex(q => q.id === question.id); if (at >= 0) questions[at] = {...result.question, id: question.id};}
    toast(change.scale ? 'Figure size saved to CER.' : 'Figure updated in CER. The original crop is preserved.');
  } catch (error) {if (ticket === epoch) toast(errorMessage(error));}
  finally {imageBusy.delete(key); if (ticket === epoch) paintQuestions();}
}

function postPreview() {
  if (frameReady && previewIds.length) $('preview-frame').contentWindow?.postMessage({type: 'cer-rapid-preview', ids: previewIds}, new URL(CER_URL).origin);
}
function openPreview(ids) {
  if (ids.length > 500) { toast('Filter to 500 questions or fewer for a single preview.'); return; }
  previewIds = ids;
  $('preview-dialog').showModal();
  if (!$('preview-frame').getAttribute('src')) $('preview-frame').src = `${CER_URL}?rapidPreview=1`;
  else postPreview();
}
function closePreview() { $('preview-dialog').close(); }
function requestClosePreview() {
  if (frameReady) $('preview-frame').contentWindow?.postMessage({type: 'cer-rapid-preview-close-request'}, new URL(CER_URL).origin);
  else closePreview();
}
window.addEventListener('message', event => {
  if (event.origin !== new URL(CER_URL).origin || event.source !== $('preview-frame').contentWindow) return;
  if (event.data?.type === 'cer-rapid-preview-ready') {frameReady = true; $('preview-loading').textContent = 'Resize or regenerate figures directly in the CER preview. Changes sync to this list.'; postPreview();}
  if (event.data?.type === 'cer-rapid-preview-error') $('preview-loading').textContent = event.data.message || 'CER could not open this preview.';
  if (event.data?.type === 'cer-rapid-preview-auth') {frameReady = false; $('preview-loading').textContent = 'Sign in to CER inside this preview to continue.';}
  if (event.data?.type === 'cer-rapid-preview-close') closePreview();
});
$('close-preview').addEventListener('click', requestClosePreview);
$('preview-dialog').addEventListener('cancel', event => {event.preventDefault(); requestClosePreview();});
$('preview-all').addEventListener('click', () => openPreview(visibleQuestions().map(q => q.id)));
$('refresh').addEventListener('click', refreshStatus);
for (const id of ['search','quality-filter','paper-filter']) $(id).addEventListener(id === 'search' ? 'input' : 'change', paintQuestions);
$('pdf-files').addEventListener('change', event => { acceptFiles(event.target.files); event.target.value = ''; });
for (const type of ['dragenter','dragover']) $('drop-zone').addEventListener(type, event => { event.preventDefault(); if (ready) $('drop-zone').classList.add('dragging'); });
for (const type of ['dragleave','drop']) $('drop-zone').addEventListener(type, event => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); if (type === 'drop') acceptFiles(event.dataTransfer.files); });
window.addEventListener('beforeunload', event => { if (activeUploads) {event.preventDefault(); event.returnValue = '';} });
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) refreshStatus(); });
window.addEventListener('online', () => {if (user) refreshStatus();});

$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value); $('password').value = '';}
  catch (error) {notice(errorMessage(error), true);} finally {button.disabled = false;}
});
$('google-sign-in').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try {await signInWithPopup(auth, new GoogleAuthProvider());}
  catch (error) {notice(errorMessage(error), true);} finally {$('google-sign-in').disabled = false;}
});
$('sign-out').addEventListener('click', async () => { try {await signOut(auth);} catch (error) {toast(errorMessage(error));} });
onAuthStateChanged(auth, account => {
  epoch++; user = account; ready = false; status = {}; clearTimeout(timer); unsubscribe?.(); unsubscribe = null; topicsUnsubscribe?.(); topicsUnsubscribe = null; topicSettings = {};
  try {topicSettings = JSON.parse(localStorage.getItem(`cerTopics:${account?.uid}`) || '{}');} catch {topicSettings = {};}
  questions = []; jobs = []; imageBusy.clear(); frameReady = false; previewIds = [];
  $('preview-frame').removeAttribute('src'); if ($('preview-dialog').open) closePreview();
  $('login').hidden = !!account; $('workspace').hidden = !account; $('account').hidden = !account; $('sign-out').hidden = !account;
  $('account').textContent = account?.email || ''; $('uploads').replaceChildren(); $('pdf-files').disabled = true;
  if (account) {notice('Checking administrator access and the import service…'); paintJobs(); paintQuestions(); refreshStatus();}
  else notice('Sign in to upload papers and access your CER vetting list.');
});
