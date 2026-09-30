import {qualityStatus, safeImageUrl, jobMessage} from './import-core.js';

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

// Imported question HTML is data, never executable markup. Preserve basic
// scientific formatting without URLs, inline events, styles or active embeds.
export function richText(value) {
  const source = document.createElement('template');
  source.innerHTML = String(value || '');
  const target = document.createDocumentFragment();
  const allowed = new Set(['P','DIV','BR','B','STRONG','I','EM','U','SUB','SUP','UL','OL','LI','SPAN','SMALL','TABLE','TBODY','THEAD','TR','TD','TH']);
  const omit = new Set(['SCRIPT','STYLE','TEMPLATE','IFRAME','OBJECT','EMBED','SVG','MATH']);
  function copy(parent, node) {
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || omit.has(node.tagName)) return;
    const child = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : document.createDocumentFragment();
    if (['TD','TH'].includes(node.tagName)) for (const name of ['colspan','rowspan']) { const n = Number(node.getAttribute(name)); if (Number.isInteger(n) && n > 0 && n < 100) child.setAttribute(name, String(n)); }
    for (const grandchild of node.childNodes) copy(child, grandchild);
    parent.append(child);
  }
  for (const child of source.content.childNodes) copy(target, child);
  return target;
}

export function renderJobs(jobs, {retry, filter}) {
  if (!jobs.length) return [el('p', {class: 'empty', text: 'Your uploaded papers will appear here.'})];
  return jobs.map(job => {
    const info = el('div', {}, [el('div', {class: 'job-name', text: job.name}), el('p', {text: jobMessage(job)})]);
    if (job.error) info.append(el('p', {class: 'error-text', text: job.error}));
    const actions = el('div', {class: 'job-actions'});
    if (job.added) actions.append(el('button', {class: 'quiet', text: 'View questions', onclick: () => filter(job.id)}));
    if (job.status === 'failed') actions.append(el('button', {text: 'Retry remaining', onclick: async event => {
      event.currentTarget.disabled = true;
      try { await retry(job.id); } finally { event.target.disabled = false; }
    }}));
    return el('article', {class: 'job'}, [info, actions]);
  });
}

function figureTools(question, block, options) {
  const original = safeImageUrl(block.originalCropUrl || block.preColourUrl || block.cropSource?.imageUrl);
  const state = block.enhancement?.state;
  const pending = options.busy.has(`${question.id}:${block.id}`);
  const tools = el('div', {class: 'image-tools'});
  if (original) tools.append(el('a', {href: original, target: '_blank', rel: 'noopener', class: 'image-source', text: 'View original crop ↗'}));
  const scale = Number.isFinite(block.scale) ? block.scale : 1;
  const output = el('output', {text: `${Math.round(scale * 100)}%`});
  const input = el('input', {type: 'range', min: '.25', max: '2', step: '.05', value: scale, 'aria-label': `Figure size for ${question.title || 'question'}`, disabled: !options.imageEditing || pending});
  input.addEventListener('input', () => {output.value = `${Math.round(Number(input.value) * 100)}%`; const image = tools.previousElementSibling; if (image?.tagName === 'IMG') image.style.width = `${Math.min(100, Number(input.value) * 65)}%`;});
  input.addEventListener('change', () => options.imageAction(question, block, {scale: Number(input.value), expectedScale: Number.isFinite(block.scale) ? block.scale : null}));
  tools.append(el('label', {}, [el('span', {text: 'Size'}), input, output]));
  const monochrome = ['table','flowchart','graph'].includes(block.figureKind);
  for (const [mode, label] of [['colour','Regenerate colour'], ['bw','Clean B&W'], ['original','Restore original']]) {
    if (mode === 'colour' && monochrome) continue;
    tools.append(el('button', {text: label, disabled: !options.imageEditing || pending || (mode === 'original' && !original), onclick: () => options.imageAction(question, block, {mode})}));
  }
  const description = pending ? 'Saving on the server… Keep this page open until the result is confirmed.'
    : !options.imageEditing ? 'Image tools will become available after the CER worker update is deployed.'
    : state === 'error' ? `Enhancement needs review: ${block.enhancement.error || 'Could not enhance this figure. The original is preserved.'}`
    : monochrome ? 'Tables, flowcharts and graphs are kept in black and white.'
    : state === 'done' ? `${block.enhancement.mode === 'colour' ? 'Colour' : block.enhancement.mode === 'original' ? 'Original' : 'Black and white'} · original crop preserved` : 'Regeneration uses the preserved original crop.';
  tools.append(el('span', {class: 'image-state', text: description}));
  return tools;
}

export function renderQuestion(question, index, options) {
  const quality = qualityStatus(question);
  const content = el('div', {class: 'question-content'});
  const answers = el('details', {class: 'answers'}, [el('summary', {text: 'Model answers and explanations'})]);
  let hasAnswers = false, lastPart = '';
  for (const block of question.blocks || []) {
    if (['answer','plainanswer','explanation','workingSpace'].includes(block.type)) {
      const answer = el('div');
      if (block.part) answer.append(el('strong', {text: `(${block.part}) `}));
      if (block.type === 'answer') for (const key of ['claim','evidence','reasoning']) answer.append(el('div', {}, [el('b', {text: `${key[0].toUpperCase() + key.slice(1)}: `}), richText(block[key])]));
      else answer.append(richText(block.content || block.text || block.answer));
      answers.append(answer); hasAnswers = true; continue;
    }
    const container = el('div');
    if (block.part && block.part !== lastPart) {container.append(el('span', {class: 'part-label', text: `(${block.part})`})); lastPart = block.part;}
    if (block.type === 'text' || block.type === 'part') {
      container.append(richText(block.content || block.text));
      if (block.marks) container.append(el('span', {class: 'marks', text: `[${block.marks}]`}));
    } else if (block.type === 'image') {
      const url = safeImageUrl(block.url);
      if (url) {
        const image = el('img', {src: url, alt: block.caption || 'Question figure', loading: 'lazy'});
        image.style.width = `${Math.min(100, (Number.isFinite(block.scale) ? block.scale : 1) * 65)}%`;
        image.addEventListener('error', () => { image.replaceWith(el('p', {class: 'error-text', text: 'Figure could not load. Check the original scan in CER.'})); });
        container.append(image, figureTools(question, block, options));
      } else container.append(el('p', {class: 'error-text', text: 'Figure unavailable. Open the source page or review in CER.'}));
    } else if (block.type === 'mcq') {
      container.append(el('ol', {class: 'mcq-options'}, (block.options || []).map(option => el('li', {}, [richText(option.text ?? option)]))));
      const correct = (block.options || []).findIndex(option => option.id === block.correctId);
      if (correct >= 0) {answers.append(el('div', {text: `Correct option: ${correct + 1}`})); hasAnswers = true;}
    } else if (block.type === 'table') {
      const table = el('table');
      for (let r = 0; r < Math.min(Number(block.rows) || 3, 100); r++) {
        const row = el('tr');
        for (let c = 0; c < Math.min(Number(block.cols) || 3, 50); c++) row.append(el('td', {}, [richText(block.data?.[r]?.[c] || '')]));
        table.append(row);
      }
      container.append(table);
    } else container.append(el('span', {class: 'muted', text: `${block.type || 'Additional'} block — open exported preview for the full layout.`}));
    content.append(container);
  }
  const title = el('div', {}, [el('h3', {text: `${index + 1}. ${question.title || 'Untitled question'}`}), el('p', {class: 'question-meta', text: [question.topic, question.sourcePdf, question.sourceQuestionNumber ? `Source Q${question.sourceQuestionNumber}` : ''].filter(Boolean).join(' · ')})]);
  const card = el('article', {class: 'question-card'}, [el('div', {class: 'question-top'}, [title, el('span', {class: `status ${quality.state}`, text: quality.label})]), content]);
  if (quality.stale) card.append(el('p', {class: 'findings', text: 'The saved check no longer matches this question or uses an older audit. Run the traffic light check in CER before approving it.'}));
  const findings = question.autoCheck?.findings || [];
  if (findings.length || question.importWarning || question.autoCheck?.error) {
    const note = el('div', {class: 'findings'}, [el('strong', {text: `${question.autoCheck?.tries || 0} automatic check pass(es) · ${quality.stale ? 'Previous findings (check out of date)' : 'Review remaining findings'}`})]);
    if (question.importWarning) note.append(el('p', {text: question.importWarning}));
    if (question.autoCheck?.error) note.append(el('p', {text: question.autoCheck.error}));
    note.append(el('ul', {}, findings.map(finding => el('li', {text: typeof finding === 'string' ? finding : [finding.title || finding.area || finding.kind || finding.type, finding.detail || finding.issue || finding.message || finding.reason, finding.fix || finding.suggestion].filter(Boolean).join(' · ')}))));
    card.append(note);
  }
  if (question.autoCheck?.repairs?.length) card.append(el('details', {class: 'answers'}, [el('summary', {text: `${question.autoCheck.repairs.length} automatic correction(s) applied`}), el('ul', {}, question.autoCheck.repairs.map(repair => el('li', {text: repair.reason || repair.type || 'Question corrected and checked again.'})))]));
  if (hasAnswers) card.append(answers);
  const footer = el('div', {class: 'card-footer'}, [el('button', {text: 'Exported preview', onclick: () => options.preview([question.id])})]);
  for (const page of question.sourcePages || []) {const url = safeImageUrl(page.url); if (url) footer.append(el('a', {href: url, target: '_blank', rel: 'noopener', text: `Source page ${page.page} ↗`}));}
  card.append(footer);
  return card;
}
