// Tiny DOM helpers (no framework).
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

export const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

export function fmtAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const fmtTime = (iso) => iso ? new Date(iso).toLocaleString() : '';

// Minimal, safe-ish markdown → HTML for the intel panel (escapes first).
export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc(md || '').split('\n');
  let html = '', inList = false, inTable = false;
  const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const isSep = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const closeTable = () => { if (inTable) { html += '</table>'; inTable = false; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const isRow = /^\s*\|.*\|\s*$/.test(l);
    if (isRow) {
      if (isSep(l)) continue; // header separator
      closeList();
      const tag = inTable ? 'td' : 'th';
      if (!inTable) { html += '<table>'; inTable = true; }
      html += '<tr>' + cells(l).map(c => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>';
      continue;
    }
    closeTable();
    const h = l.match(/^(#{1,4})\s+(.*)/);
    const li = l.match(/^\s*[-*]\s+(.*)/) || l.match(/^\s*\d+\.\s+(.*)/);
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; }
    else if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; }
    else if (!l.trim()) closeList();
    else { closeList(); html += `<p>${inline(l)}</p>`; }
  }
  closeList(); closeTable();
  return html;
}
