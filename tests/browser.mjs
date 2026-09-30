import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root)) {response.writeHead(403); response.end(); return;}
  try {const content = await readFile(target); response.setHeader('Content-Type', target.endsWith('.css') ? 'text/css' : /\.m?js$/.test(target) ? 'text/javascript' : 'text/html'); response.end(content);} catch {response.writeHead(404); response.end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {})});
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.fixture = {auth: {currentUser: null}, calls: [], available: false, snapshot: null, questions: [{id: 'q-one', title: 'Heating a metal ball', topic: 'Heat', sourcePdf: 'Paper A.pdf', rapidImportId: 'paper-a', createdAt: '2026-09-30', autoCheck: {state: 'green'}, blocks: [{id: 't', type: 'text', content: 'Explain why the metal ball expands.<script>window.xss=true</script><img src=x onerror="window.xss=true">'}, {id: 'diagram', type: 'image', url: 'https://example.test/figure.png', originalCropUrl: 'https://example.test/original.png', figureKind: 'diagram', enhancement: {state: 'done', mode: 'colour'}}, {id: 'a', type: 'plainanswer', content: 'The ball gains heat.'}]}, {id: 'q-two', title: 'A table of results', topic: 'Heat', autoCheck: {state: 'amber', tries: 3, findings: [{issue: 'Check the answer.'}]}, blocks: [{id: 'table', type: 'image', url: 'https://example.test/figure.png', originalCropUrl: 'https://example.test/original.png', figureKind: 'table'}]}]};
  });
  const firebaseMock = `const f=window.fixture; export const initializeApp=()=>({});export const getAuth=()=>f.auth;export const getFirestore=()=>({});export const getFunctions=()=>({});export class GoogleAuthProvider{};export function onAuthStateChanged(auth,cb){f.authChanged=cb;queueMicrotask(()=>cb(auth.currentUser));}export async function signInWithEmailAndPassword(){f.auth.currentUser={uid:'teacher',email:'teacher@example.test'};f.authChanged(f.auth.currentUser);}export const signInWithPopup=signInWithEmailAndPassword;export async function signOut(){f.auth.currentUser=null;f.authChanged(null);}export const collection=(...args)=>args;export const doc=(...args)=>args;export function onSnapshot(ref,cb){if(ref.at(-1)==='topics'){queueMicrotask(()=>cb({data:()=>({})}));return()=>{};}f.snapshot=()=>cb({docs:f.questions.map(q=>({id:q.id,data:()=>structuredClone(q)})),metadata:{fromCache:false}});queueMicrotask(f.snapshot);return()=>{};}export const httpsCallable=(fns,name)=>async(data)=>{f.calls.push({name,data});if(name==='rapidImportStatus'){if(!f.available)throw Object.assign(Error('Worker offline'),{code:'functions/unavailable'});return{data:{available:true,capabilities:{imageEditing:true,automaticChecks:true,automaticEnhancement:true},jobs:[{id:'paper-a',name:'Paper A.pdf',status:'completed',added:1}]}};}if(name==='rapidImportFinish')return{data:{queued:true}};if(name==='rapidVettingImage'){const q=f.questions.find(q=>q.id===data.questionId),b=q.blocks.find(b=>b.id===data.blockId);if(data.scale)b.scale=data.scale;else b.enhancement={state:'done',mode:data.mode};f.snapshot();return{data:{question:structuredClone(q),changed:true}};}return{data:{}};};`;
  await context.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({contentType: 'text/javascript', body: firebaseMock}));
  await context.route('https://example.test/**', route => route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="170"><rect width="500" height="170" fill="white"/><circle cx="160" cy="80" r="40" fill="#d9e3dd" stroke="#234932"/><path d="M215 80h100" stroke="#234932"/><text x="327" y="88" fill="#234932" font-size="20">Metal ball</text></svg>'}));
  await context.route('https://polymathlc.github.io/cer/**', route => route.fulfill({contentType: 'text/html', body: `<h1>CER worksheet fixture</h1><script>parent.postMessage({type:'cer-rapid-preview-ready'},'*');window.addEventListener('message',event=>{if(event.data.type==='cer-rapid-preview'){window.ids=event.data.ids;parent.postMessage({type:'cer-rapid-preview-opened'},'*');}if(event.data.type==='cer-rapid-preview-close-request')parent.postMessage({type:'cer-rapid-preview-close'},'*');});</script>`}));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(async () => {
    const {questionCheckSignature} = await import('/import-core.js');
    for (const question of window.fixture.questions) question.autoCheck.sig = questionCheckSignature(question);
    window.fixture.questions.push({deletedAt: '2026-10-01', status: 'deleted'});
  });
  await page.locator('#email').fill('teacher@example.test'); await page.locator('#password').fill('not-a-real-password'); await page.locator('#login-form button').click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('unavailable'));
  assert.equal(await page.locator('#pdf-files').isDisabled(), true, 'an unavailable service cannot accept files');
  await page.evaluate(() => {window.fixture.available = true;}); await page.locator('#refresh').click();
  await page.waitForSelector('.question-card');
  assert.equal(await page.locator('.question-card').count(), 2);
  assert.equal(await page.locator('.question-card').first().locator('.status').textContent(), 'Checked');
  await page.evaluate(() => {window.fixture.questions[0].title = 'Updated in CER'; window.fixture.snapshot();});
  assert.equal(await page.locator('.question-card').first().locator('.status').textContent(), 'Check out of date');
  await page.locator('#quality-filter').selectOption('green');
  assert.equal(await page.locator('.question-card').count(), 0, 'edited green question leaves the checked filter');
  await page.locator('#quality-filter').selectOption('all');
  await page.evaluate(async () => {const {questionCheckSignature} = await import('/import-core.js'); const question = window.fixture.questions[0]; question.title = 'Heating a metal ball'; question.autoCheck.sig = questionCheckSignature(question); window.fixture.snapshot();});
  await page.evaluate(() => {window.fixture.questions[1].autoCheck.findings = [{type: 'Answer', title: 'Check answer', detail: 'A unit is missing.', fix: 'Read the source measurement.'}]; window.fixture.questions[1].autoCheck.repairs = [{type: 'text', reason: 'Restored the source label.'}]; window.fixture.snapshot();});
  assert.match(await page.locator('.question-card').nth(1).textContent(), /A unit is missing.*Read the source measurement/);
  assert.match(await page.locator('.question-card').nth(1).textContent(), /1 automatic correction/);
  assert.equal(await page.evaluate(() => window.xss), undefined, 'rich question text cannot execute');
  assert.equal(await page.locator('.question-card').nth(1).getByText('Regenerate colour', {exact: true}).count(), 0, 'tables stay black and white');
  await page.locator('#pdf-files').setInputFiles({name: 'mock.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nfixture')});
  await page.waitForFunction(() => document.querySelector('#uploads').textContent.includes('Stored online'));
  const calls = await page.evaluate(() => window.fixture.calls);
  assert.ok(calls.find(call => call.name === 'rapidImportBegin').data.autoCheck);
  assert.ok(calls.find(call => call.name === 'rapidImportFinish'));
  await page.locator('.question-card').first().getByText('Clean B&W', {exact: true}).click();
  await page.waitForFunction(() => window.fixture.calls.some(call => call.name === 'rapidVettingImage' && call.data.mode === 'bw'));
  const slider = page.locator('.question-card').first().locator('input[type=range]');
  await slider.fill('1.25'); await slider.dispatchEvent('change');
  await page.waitForFunction(() => window.fixture.calls.some(call => call.data.scale === 1.25));
  await page.locator('#quality-filter').selectOption('amber');
  assert.equal(await page.locator('.question-card').count(), 1);
  await page.locator('#preview-all').click();
  await page.waitForFunction(() => document.querySelector('#preview-loading').textContent.includes('Resize'));
  const frame = page.frames().find(frame => frame.url().includes('polymathlc.github.io/cer'));
  assert.deepEqual(await frame.evaluate(() => window.ids), ['q-two'], 'exported preview receives the filtered question IDs');
  await page.locator('#close-preview').click();
  await page.waitForFunction(() => !document.querySelector('#preview-dialog').open);
  assert.ok(await page.locator('#preview-frame').getAttribute('src'), 'closing preserves mounted editor until future reopening');
  await page.locator('#quality-filter').selectOption('all');
  await mkdir(path.join(root, 'test-results'), {recursive: true});
  await page.setViewportSize({width: 1440, height: 1100});
  await page.evaluate(async () => {document.querySelector('#toast').hidden = true; await Promise.all([...document.images].map(image => {image.loading = 'eager'; return image.decode().catch(() => {});}));});
  await page.screenshot({path: path.join(root, 'test-results', 'desktop.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(async () => {await Promise.all([...document.images].map(image => image.decode().catch(() => {})));});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no horizontal overflow');
  await page.screenshot({path: path.join(root, 'test-results', 'mobile.png'), fullPage: true});
  await page.locator('#sign-out').click();
  assert.equal(await page.locator('#workspace').isHidden(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: sign-in, deployment gating, shared list, XSS isolation, chunk upload, image edit, filters, exact preview bridge, mobile, sign-out');
} finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
