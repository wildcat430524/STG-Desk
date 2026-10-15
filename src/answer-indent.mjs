// Describe one native textarea replacement so indentation remains undoable.
export function answerIndent(value, start, end, outdent = false) {
  const unit = '    ';
  if (!outdent && !value.slice(start, end).includes('\n')) {
    return { from: start, to: end, text: unit, start: start + unit.length, end: start + unit.length };
  }
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const next = value.indexOf('\n', last);
  const to = next < 0 ? value.length : next;
  const edits = [];
  let offset = from;
  const text = value.slice(from, to).split('\n').map(line => {
    const removed = outdent ? (line.match(/^(?:\t| {1,4})/)?.[0].length || 0) : 0;
    edits.push({ offset, removed, added: outdent ? 0 : unit.length });
    offset += line.length + 1;
    return outdent ? line.slice(removed) : unit + line;
  }).join('\n');
  const position = p => edits.reduce((result, edit) => result + (edit.offset <= p ? edit.added - Math.min(edit.removed, p - edit.offset) : 0), p);
  return { from, to, text, start: position(start), end: position(end) };
}
