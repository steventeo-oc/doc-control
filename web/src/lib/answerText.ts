/**
 * Turns the assistant's reply into structure the page renders with React elements only.
 *
 * The reply is model output built from document text, so it can contain anything. Nothing here produces HTML: the
 * result is data (paragraphs, lists, bold, code, citation marks) and the page decides which element each part becomes.
 * Links are never made from the reply; the only links on the page come from the sources' metadata.
 *
 * Understood: paragraphs (a single line break is kept), "- " / "* " bullet lists, "1." / "1)" numbered lists (the
 * first number is kept, so a list split by a paragraph does not restart at 1), "#" headings (shown as bold text),
 * table rows starting with "|" (shown as monospaced text so the alignment survives), **bold**, `code`, and citation
 * marks such as [S1], [S1, S2] or [S1; S3]. Anything else is plain text.
 *
 * Checked by web/scripts/check-answer-text.ts (node web/scripts/check-answer-text.ts).
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  /** one or more sources this stretch of the answer rests on */
  | { kind: 'cite'; labels: string[] };

export type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'heading'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'table'; text: string };

// Bold, code, or a bracket holding only source labels. A bracket with other words in it ("[see S1 in step 3]") is
// left as text so no words are lost.
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[\s*S\d+(?:\s*[,;]\s*S\d+)*\s*\])/g;

/**
 * `known` is the set of labels that exist among the sources; a mark for a label that does not exist stays text, so
 * the page never shows a chip that goes nowhere.
 */
export function parseInline(text: string, known?: ReadonlySet<string>): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    if (token.startsWith('**')) {
      out.push({ kind: 'bold', text: token.slice(2, -2) });
    } else if (token.startsWith('`')) {
      out.push({ kind: 'code', text: token.slice(1, -1) });
    } else {
      const labels = [...token.matchAll(/S(\d+)/g)].map((m) => `S${m[1]}`);
      const shown = known ? labels.filter((label) => known.has(label)) : labels;
      out.push(shown.length > 0 ? { kind: 'cite', labels: shown } : { kind: 'text', text: token });
    }
    last = at + token.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

const RULE = /^\s*([-*_])\1{2,}\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|/;
const WRAPPED = /^\s{2,}\S/;

export function parseAnswer(text: string, known?: ReadonlySet<string>): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let table: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join('\n'), known) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({
        kind: 'list',
        ordered: list.ordered,
        start: list.start,
        items: list.items.map((item) => parseInline(item, known)),
      });
      list = null;
    }
  };
  const flushTable = () => {
    if (table.length > 0) {
      blocks.push({ kind: 'table', text: table.join('\n') });
      table = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '' || RULE.test(line)) {
      flushAll();
      continue;
    }
    if (TABLE_ROW.test(line)) {
      flushParagraph();
      flushList();
      table.push(line.trim());
      continue;
    }
    flushTable();
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', inline: parseInline(heading[1], known) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = numbered !== null;
      flushParagraph();
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(numbered ? numbered[2] : bullet![1]);
      continue;
    }
    if (list && WRAPPED.test(raw)) {
      list.items[list.items.length - 1] += ' ' + line.trim();   // the item continues on the next line
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushAll();
  return blocks;
}
