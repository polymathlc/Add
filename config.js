// Public Firebase web configuration shared with CER; provider secrets stay on the server.
export const firebaseConfig = {
  apiKey: 'AIzaSyAUSI3Uh28IeqASEp0JhH4QPaVt-O3meBo',
  authDomain: 'mathgen--app.firebaseapp.com',
  projectId: 'mathgen--app',
  storageBucket: 'mathgen--app.firebasestorage.app',
  messagingSenderId: '165654161198',
  appId: '1:165654161198:web:16c8bd60eb3a2aa7edbcbf'
};
export const CER_URL = 'https://polymathlc.github.io/cer/';
export const TOPICS_BY_LEVEL = {
  P3: ['Living and non-living things', 'Materials', 'Life Cycles', 'Magnets'],
  P4: ['Plant Systems', 'Human Body Systems', 'Matter and its 3 States', 'Light', 'Heat'],
  P5: ['Water and its 3 States', 'Plant Reproduction', 'Human Reproduction', 'Human and Plant Respiration', 'Human and Plant Transport', 'Electrical Systems'],
  P6: ['Forces', 'Energy in Food', 'Energy Conversion', 'Living Together', 'Food Chains and Webs', 'Humans and the Environment'],
  S1: ['The Scientific Endeavour', 'Measurement and Lab Skills', 'Diversity of Matter — Physical Properties', 'Diversity of Matter — Chemical Composition', 'Separation Techniques', 'Particulate Nature of Matter', 'Atoms and Molecules', 'Cells — The Basic Unit of Life', 'Ray Model of Light', 'Forces and Their Effects']
};
export function importTopics(level, settings = {}) {
  const map = Object.fromEntries(Object.entries(TOPICS_BY_LEVEL).flatMap(([lv, topics]) => topics.map(topic => [topic, lv])));
  for (const topic of settings.removed || []) delete map[topic];
  for (const [topic, lv] of Object.entries(settings.custom || {})) if (Object.hasOwn(TOPICS_BY_LEVEL, lv)) map[topic] = lv;
  const all = Object.keys(map), selected = all.filter(topic => map[topic] === level);
  return selected.length ? selected : all;
}
export const READING_PROMPT = `Read the supplied Singapore science examination page faithfully and return ONLY JSON {"questions":[...]}. A cover, instructions-only, answer-key-only or blank page has no questions. Each independent numbered question is a separate entry; keep questions sharing indispensable context together. Never discard any question or part. Each entry has title, topic, category, tags, sourceQuestionNumber, continuation (boolean) and ordered blocks. Retain the paper number only in sourceQuestionNumber, never in the wording. If this page starts midway through the preceding question, including a repeated number marked continued or a later diagram, put that continuation first with continuation:true. Keep only this page's blocks and never renumber lettered parts.
Allowed blocks: {"type":"text","text":"verbatim wording","marks":2}; {"type":"image","box_2d":[ymin,xmin,ymax,xmax],"figureKind":"diagram|table|flowchart|graph","caption":""}; {"type":"mcq","options":["option text"],"correctIndex":0}; {"type":"answer","claim":"...","evidence":"...","reasoning":"..."}; {"type":"plainanswer","text":"..."}; {"type":"explanation","text":"..."}.
Copy all question wording, units, values and labels exactly, using plain text without Markdown or HTML. Do not guess unreadable text. Each lettered part begins its own text block with '(a) ', '(b) ', etc. Include printed marks only when visible, in marks rather than duplicating them in the text. Every open part has its own model answer followed immediately by its own short teacher explanation of the principle. MCQs have one mcq block, verbatim options without leading choice labels, correctIndex (zero based), and an explanation. Do not add answer blocks to MCQs.
Every figure, photograph, data table, graph, flowchart or experimental setup is an image block interleaved exactly where it occurs. Crop coordinates use 0–1000 on the WHOLE current page, [top,left,bottom,right]. Include the entire figure and all labels, arrows, units, legends, borders and captions with a clear white margin; exclude surrounding question prose and unrelated content. Do not cut any label. Picture answer options are ONE crop preserving their numbered arrangement. Give every question all figures it needs, even if another question uses the same figure. Tables are cropped images, never flattened into text. Classify figureKind carefully so tables, graphs and flowcharts remain black and white. Source evidence is authoritative; correct only obvious scan artefacts, never change the science.`;
