// Notebook nav + copy-to-clipboard buttons.
// Must also work inside a sandboxed srcdoc iframe (no allow-same-origin): there
// history.replaceState can throw and navigator.clipboard may be missing or refuse.
const sections = Array.from(document.querySelectorAll('.nb'));
const navLinks = Array.from(document.querySelectorAll('[data-target]'));

function setHash(id) {
  try { if (history.replaceState) history.replaceState(null, '', '#' + id); }
  catch (e) { /* sandboxed: the hash just stays local, navigation still works */ }
}
function show(id) {
  sections.forEach(s => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('data-target') === id));
  window.scrollTo({ top: 0 });
  setHash(id);
}
navLinks.forEach(a => a.addEventListener('click', e => { e.preventDefault(); show(a.getAttribute('data-target')); }));
const initial = (location.hash || '#nb-00').slice(1);
if (document.getElementById(initial)) show(initial); else show('nb-00');

function flash(btn, label, ms) {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.textContent = label;
  btn.classList.add('done');
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = btn.dataset.label; btn.classList.remove('done'); }, ms);
}
function clipboardWrite(text) {
  if (!(navigator.clipboard && navigator.clipboard.writeText)) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}
// Fallback: select the prompt so the attendee can press Ctrl/⌘C themselves.
function selectAndCopy(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  try { return document.execCommand('copy'); } catch (e) { return false; }
}
document.querySelectorAll('.prompt .copy').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = btn.closest('.prompt').querySelector('p');
    clipboardWrite(p.innerText.trim()).then(ok => {
      if (ok) return flash(btn, 'Copied ✓', 1400);
      if (selectAndCopy(p)) return flash(btn, 'Copied ✓', 1400);
      flash(btn, 'Press ⌘C', 3000);
    });
  });
});
