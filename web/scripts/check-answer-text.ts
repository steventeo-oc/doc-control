// Checks the assistant-answer parser (src/lib/answerText.ts). The web project has no test runner, so this is a plain
// script that needs nothing installed: from the repo root run   node web/scripts/check-answer-text.ts
// (Node 22.6+ strips the types itself). It is not part of the build; it exists because the parser is the one place
// where model output meets the page, and "no HTML, no links, no lost words" should stay true when it is edited.
import assert from 'node:assert/strict';
import { parseAnswer, parseInline } from '../src/lib/answerText.ts';

let failures = 0;
function check(name: string, run: () => void) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${(error as Error).message.split('\n').join('\n     ')}`);
  }
}

const known = new Set(['S1', 'S2', 'S3']);

check('a citation mark becomes a cite and the sentence around it is kept', () => {
  assert.deepEqual(parseInline('The burn-in runs 24 hours [S1].', known), [
    { kind: 'text', text: 'The burn-in runs 24 hours ' },
    { kind: 'cite', labels: ['S1'] },
    { kind: 'text', text: '.' },
  ]);
});

check('grouped and adjacent marks', () => {
  assert.deepEqual(parseInline('a [S1, S2] b [S1][S3]', known), [
    { kind: 'text', text: 'a ' },
    { kind: 'cite', labels: ['S1', 'S2'] },
    { kind: 'text', text: ' b ' },
    { kind: 'cite', labels: ['S1'] },
    { kind: 'cite', labels: ['S3'] },
  ]);
});

check('a bracket with other words in it, or an unknown label, stays text (no chip that goes nowhere)', () => {
  assert.deepEqual(parseInline('[see S1 in step 3]', known), [{ kind: 'text', text: '[see S1 in step 3]' }]);
  assert.deepEqual(parseInline('[S9]', known), [{ kind: 'text', text: '[S9]' }]);
  assert.deepEqual(parseInline('[S1, S9]', known), [{ kind: 'cite', labels: ['S1'] }]);
});

check('bold and code, and unbalanced markers stay text', () => {
  assert.deepEqual(parseInline('Use **the torque driver** and `BMC` now', known), [
    { kind: 'text', text: 'Use ' },
    { kind: 'bold', text: 'the torque driver' },
    { kind: 'text', text: ' and ' },
    { kind: 'code', text: 'BMC' },
    { kind: 'text', text: ' now' },
  ]);
  assert.deepEqual(parseInline('2 ** 3 and a `lone tick', known), [{ kind: 'text', text: '2 ** 3 and a `lone tick' }]);
});

check('markup and links from a document stay inert text', () => {
  const hostile = '<img src=x onerror=alert(1)> <script>alert(2)</script> [click](javascript:alert(3)) <a href="http://evil">x</a>';
  const [block] = parseAnswer(hostile, known);
  assert.equal(block.kind, 'paragraph');
  assert.ok(block.kind === 'paragraph' && block.inline.every((part) => ['text', 'bold', 'code', 'cite'].includes(part.kind)));
  const text = block.kind === 'paragraph' ? block.inline.map((part) => ('text' in part ? part.text : '')).join('') : '';
  assert.equal(text, hostile);                                       // every character survives, untouched
});

check('paragraphs keep their line breaks; blank lines and rules separate blocks', () => {
  const blocks = parseAnswer('First line\nsecond line\n\n---\n\nNext paragraph', known);
  assert.deepEqual(blocks, [
    { kind: 'paragraph', inline: [{ kind: 'text', text: 'First line\nsecond line' }] },
    { kind: 'paragraph', inline: [{ kind: 'text', text: 'Next paragraph' }] },
  ]);
});

check('bullet lists, including a wrapped item', () => {
  const [list] = parseAnswer('- one\n* two\n  continued\n• three', known);
  assert.deepEqual(list, {
    kind: 'list',
    ordered: false,
    start: 1,
    items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two continued' }], [{ kind: 'text', text: 'three' }]],
  });
});

check('numbered lists keep their first number, so a split list does not restart at 1', () => {
  const blocks = parseAnswer('1. Open the case\n2) Seat the tray\n\nNote: torque as below.\n\n3. Close the case', known);
  assert.deepEqual(
    blocks.map((block) => (block.kind === 'list' ? [block.ordered, block.start, block.items.length] : block.kind)),
    [[true, 1, 2], 'paragraph', [true, 3, 1]],
  );
});

check('a bullet list followed by a numbered list are two lists', () => {
  const blocks = parseAnswer('- a\n- b\n1. c\n2. d', known);
  assert.deepEqual(blocks.map((block) => (block.kind === 'list' ? block.ordered : block.kind)), [false, true]);
});

check('headings become heading blocks with their marks removed', () => {
  const [heading] = parseAnswer('## Torque values', known);
  assert.deepEqual(heading, { kind: 'heading', inline: [{ kind: 'text', text: 'Torque values' }] });
});

check('table rows are kept verbatim as one block', () => {
  const rows = '| Port | Cable |\n|---|---|\n| A1 | C7 |';
  assert.deepEqual(parseAnswer(rows, known), [{ kind: 'table', text: rows }]);
});

check('citations inside list items and bold text work', () => {
  const [list] = parseAnswer('1. Run the test [S2]\n2. **Record** the result [S1, S3]', known);
  assert.ok(list.kind === 'list');
  if (list.kind === 'list') {
    assert.deepEqual(list.items[0].at(-1), { kind: 'cite', labels: ['S2'] });
    assert.deepEqual(list.items[1].map((part) => part.kind), ['bold', 'text', 'cite']);
  }
});

check('Windows line endings and an empty reply', () => {
  assert.equal(parseAnswer('a\r\n\r\nb', known).length, 2);
  assert.deepEqual(parseAnswer('', known), []);
  assert.deepEqual(parseAnswer('   \n\n  ', known), []);
});

check('Malay text with a citation', () => {
  const [block] = parseAnswer('Ujian burn-in berjalan selama 24 jam [S1].', known);
  assert.ok(block.kind === 'paragraph' && block.inline.some((part) => part.kind === 'cite'));
});

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
