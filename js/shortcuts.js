// Keyboard shortcut registry, dispatcher, hover tooltips and generated help table.
//
// Each entry: id (action name), keys (first one is shown in tooltips), label,
// group (help section), when (context predicate name), el (CSS selector of the UI element it triggers).
// Note: "Ctrl" also matches Cmd on macOS.

export const SHORTCUTS = [
  // File
  { id: 'open', group: 'File', label: 'Load JSON', keys: ['Ctrl+O'], el: '[data-imp=".json"]' },
  { id: 'save', group: 'File', label: 'Save JSON', keys: ['Ctrl+S'], el: '#exp' },
  { id: 'clear', group: 'File', label: 'Clear scene', keys: ['Alt+N'], el: '#clear' },
  // Edit
  { id: 'undo', group: 'Edit', label: 'Undo', keys: ['Ctrl+Z'], el: '#undo' },
  { id: 'redo', group: 'Edit', label: 'Redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], el: '#redo' },
  { id: 'cut', group: 'Edit', label: 'Cut selected objects', keys: ['Ctrl+X'], when: 'obj', el: '#cut' },
  { id: 'copy', group: 'Edit', label: 'Copy selected objects', keys: ['Ctrl+C'], when: 'obj', el: '#copy' },
  { id: 'paste', group: 'Edit', label: 'Paste objects', keys: ['Ctrl+V'], when: 'obj', el: '#paste' },
  { id: 'dup', group: 'Edit', label: 'Duplicate selected objects', keys: ['Ctrl+D'], when: 'obj', el: '#dup' },
  { id: 'cloneRef', group: 'Edit', label: 'Clone as reference (edits are shared)', keys: ['Ctrl+Shift+D'], when: 'obj', el: '#cloneRef' },
  { id: 'del', group: 'Edit', label: 'Delete selected objects', keys: ['Del', 'Backspace'], when: 'obj', el: '#del' },
  { id: 'selectAllObjects', group: 'Edit', label: 'Select all objects', keys: ['Ctrl+A'], when: 'obj' },
  { id: 'bool', group: 'Edit', label: 'Boolean operation (two objects)', keys: ['Shift+B'], when: 'obj', el: '#bool' },
  { id: 'smooth', group: 'Edit', label: 'Hide edges below an angle', keys: ['Shift+H'], when: 'obj', el: '#smooth' },
  { id: 'closeHoles', group: 'Edit', label: 'Close holes of selected objects', keys: ['Shift+K'], when: 'obj', el: '#closeHoles' },
  { id: 'deselect', group: 'Edit', label: 'Deselect', keys: ['Esc'], when: 'obj' },
  { id: 'prev', group: 'Edit', label: 'Select previous object', keys: ['Up'], when: 'obj' },
  { id: 'next', group: 'Edit', label: 'Select next object', keys: ['Down'], when: 'obj' },
  { id: 'rename', group: 'Edit', label: 'Rename selected object', keys: ['F2'], when: 'sel' },
  { id: 'objColor', group: 'Edit', label: 'Object color', keys: ['C'], when: 'obj' },
  // Modes and creation
  { id: 'select', group: 'Modes & create', label: 'Select mode', keys: ['1'], when: 'obj', el: '#mSelect' },
  { id: 'box', group: 'Modes & create', label: 'Create box', keys: ['2'], when: 'obj', el: '[data-shape=box]' },
  { id: 'sphere', group: 'Modes & create', label: 'Create sphere', keys: ['3'], when: 'obj', el: '[data-shape=sphere]' },
  { id: 'cylinder', group: 'Modes & create', label: 'Create cylinder', keys: ['4'], when: 'obj', el: '[data-shape=cylinder]' },
  { id: 'tube', group: 'Modes & create', label: 'Create tube', keys: ['5'], when: 'obj', el: '[data-shape=tube]' },
  { id: 'plane', group: 'Modes & create', label: 'Create plane', keys: ['6'], when: 'obj', el: '[data-shape=plane]' },
  { id: 'cone', group: 'Modes & create', label: 'Create cone', keys: ['7'], when: 'obj', el: '[data-shape=cone]' },
  { id: 'torus', group: 'Modes & create', label: 'Create torus', keys: ['8'], when: 'obj', el: '[data-shape=torus]' },
  { id: 'icosphere', group: 'Modes & create', label: 'Create ico sphere', keys: ['9'], when: 'obj', el: '[data-shape=icosphere]' },
  { id: 'editMode', group: 'Modes & create', label: 'Toggle edit mode', keys: ['Tab'], when: 'sel', el: '#mEdit' },
  // Transform
  { id: 'move', group: 'Transform', label: 'Move', keys: ['W'], when: 'sel', el: '#tMove' },
  { id: 'rotate', group: 'Transform', label: 'Rotate', keys: ['E'], when: 'sel', el: '#tRot' },
  { id: 'scale', group: 'Transform', label: 'Scale', keys: ['R'], when: 'sel', el: '#tScale' },
  { id: 'space', group: 'Transform', label: 'Gizmo: global / local', keys: ['X'], el: '#tSpace' },
  { id: 'snap', group: 'Transform', label: 'Focus snap field', keys: ['G'] },
  // View
  { id: 'focus', group: 'View', label: 'Center view on orbit center', keys: ['F'], el: '#pvFocus' },
  { id: 'home', group: 'View', label: 'Reset view to initial position', keys: ['Home'], el: '#pvHome' },
  { id: 'pvOrigin', group: 'View', label: 'Orbit around origin', keys: ['O'], el: '#pvOrigin' },
  { id: 'pvSel', group: 'View', label: 'Orbit around selection', keys: ['P'], el: '#pvSel' },
  // Edit mode
  { id: 'vertex', group: 'Edit mode', label: 'Vertex mode', keys: ['1'], when: 'edit', el: '[data-sub=vertex]' },
  { id: 'edge', group: 'Edit mode', label: 'Edge mode', keys: ['2'], when: 'edit', el: '[data-sub=edge]' },
  { id: 'face', group: 'Edit mode', label: 'Face mode', keys: ['3'], when: 'edit', el: '[data-sub=face]' },
  { id: 'selectAll', group: 'Edit mode', label: 'Select all', keys: ['A', 'Ctrl+A'], when: 'edit' },
  { id: 'subAdd', group: 'Edit mode', label: 'Add', keys: ['Enter'], when: 'edit', el: '#subAdd' },
  { id: 'subDel', group: 'Edit mode', label: 'Remove', keys: ['Del', 'Backspace'], when: 'edit', el: '#subDel' },
  { id: 'chamfer', group: 'Edit mode', label: 'Chamfer selected edges', keys: ['B'], when: 'edit', el: '#subChamfer' },
  { id: 'subdivide', group: 'Edit mode', label: 'Subdivide (Catmull-Clark)', keys: ['Shift+D'], when: 'edit', el: '#subDivide' },
  { id: 'chamferDown', group: 'Edit mode', label: 'Decrease chamfer width', keys: ['['], when: 'edit' },
  { id: 'chamferUp', group: 'Edit mode', label: 'Increase chamfer width', keys: [']'], when: 'edit' },
  { id: 'mirrorX', group: 'Edit mode', label: 'Toggle mirror X', keys: ['Shift+X'], when: 'edit' },
  { id: 'mirrorY', group: 'Edit mode', label: 'Toggle mirror Y', keys: ['Shift+Y'], when: 'edit' },
  { id: 'mirrorZ', group: 'Edit mode', label: 'Toggle mirror Z', keys: ['Shift+Z'], when: 'edit' },
  { id: 'faceColor', group: 'Edit mode', label: 'Face color', keys: ['C'], when: 'edit' },
  { id: 'faceColorReset', group: 'Edit mode', label: 'Reset face color', keys: ['Shift+C'], when: 'edit', el: '#fcolReset' },
  { id: 'editEsc', group: 'Edit mode', label: 'Cancel add / clear selection / leave edit mode', keys: ['Esc'], when: 'edit' },
  // Help
  { id: 'helpKeys', group: 'Help', label: 'Keyboard shortcuts', keys: ['?'], el: '#helpKeysBtn' },
  { id: 'help', group: 'Help', label: 'Controls help', keys: ['F1'], el: '#helpBtn' },
  { id: 'helpEdit', group: 'Help', label: 'Edit mode help', keys: ['Shift+F1'], el: '#helpEditBtn' },
  { id: 'about', group: 'Help', label: 'About / splash screen', keys: ['Alt+A'], el: '#logoBtn' },
];

const NAMES = { esc: 'escape', del: 'delete', up: 'arrowup', down: 'arrowdown' };

function parse(spec) {
  const parts = spec.split('+');
  // A lone "+" key would be split away; none is used here.
  const key = parts.pop().toLowerCase();
  const mods = parts.map(p => p.toLowerCase());
  return {
    key: NAMES[key] || key,
    ctrl: mods.includes('ctrl'), shift: mods.includes('shift'), alt: mods.includes('alt'),
    // Punctuation keys (?, [, ]) are produced with varying Shift states per layout
    anyShift: !/^[a-z0-9]$/.test(key) && key.length === 1,
  };
}

function matches(p, e) {
  if (p.ctrl !== (e.ctrlKey || e.metaKey) || p.alt !== e.altKey) return false;
  if (!p.anyShift && p.shift !== e.shiftKey) return false;
  const k = e.key.toLowerCase();
  if (k === p.key) return true;
  // With Alt, macOS produces dead/special characters: fall back to the physical key
  return p.alt && e.code === 'Key' + p.key.toUpperCase();
}

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
const kbd = k => { const n = el('kbd', '', k.replace('Backspace', '⌫').replace('Del', 'Del')); return n; };

// Wires the global key handler, the tooltips and the shortcut table.
//   actions: { id: () => void | false }   (returning false = "not handled", key is not swallowed)
//   ctx:     { edit(), sel(), obj() }     context predicates
export function setupShortcuts(actions, ctx) {
  const defs = SHORTCUTS.map(d => ({ ...d, parsed: d.keys.map(parse) }));
  const pred = { edit: () => ctx.edit(), obj: () => !ctx.edit(), sel: () => ctx.sel() };

  addEventListener('keydown', e => {
    if (e.target.matches('textarea, select, input:not([type=checkbox],[type=color],[type=button])')) return;
    if (document.querySelector('dialog[open]') && e.key !== 'F1') return;
    for (const d of defs) {
      if (d.when && !pred[d.when]()) continue;
      if (!d.parsed.some(p => matches(p, e))) continue;
      const btn = d.el && document.querySelector(d.el);
      if (btn && btn.disabled) continue;
      if (actions[d.id]?.() === false) continue;
      e.preventDefault();
      return;
    }
  });

  // Attach shortcut hints: inline in menus, tooltips elsewhere
  for (const d of defs) {
    if (!d.el) continue;
    document.querySelectorAll(d.el).forEach(n => {
      const list = (n.dataset.keys ? n.dataset.keys.split('|') : []);
      for (const k of d.keys) if (!list.includes(k)) list.push(k);
      n.dataset.keys = list.join('|');
      if (!n.dataset.tip) n.dataset.tip = d.label;
      if (n.closest('.dropdown')) {
        n.querySelector('.kb')?.remove();
        const s = el('span', 'kb'); s.textContent = d.keys.join(' / ');
        n.append(s);
      }
    });
  }

  setupTooltips();
  buildTable(defs);
}

// Hover popup: text from data-tip / title, plus the shortcut badges from data-keys
function setupTooltips() {
  const tip = el('div'); tip.id = 'tip'; document.body.append(tip);
  let timer = null, cur = null;
  const hide = () => { clearTimeout(timer); tip.classList.remove('show'); cur = null; };
  document.addEventListener('mouseover', e => {
    const n = e.target.closest?.('[title],[data-tip],[data-keys]');
    if (n === cur) return;
    hide();
    if (!n || n.closest('.dropdown') || n.closest('dialog')) return;
    if (n.hasAttribute('title')) { n.dataset.tip = n.getAttribute('title').replace(/\s*\([^)]*\)$/, ''); n.removeAttribute('title'); }
    cur = n;
    timer = setTimeout(() => {
      const text = n.dataset.tip, keys = n.dataset.keys ? n.dataset.keys.split('|') : [];
      if (!text && !keys.length) return;
      tip.replaceChildren(el('span', '', text || ''), ...keys.map(kbd));
      const r = n.getBoundingClientRect();
      tip.classList.add('show');
      const w = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2)) + 'px';
      const below = r.bottom + 8 + tip.offsetHeight < innerHeight;
      tip.style.top = (below ? r.bottom + 8 : r.top - tip.offsetHeight - 8) + 'px';
    }, 450);
  });
  document.addEventListener('mousedown', hide);
  document.addEventListener('mouseleave', hide);
  addEventListener('keydown', hide);
}

// Fills the shortcut dialog from the registry
function buildTable(defs) {
  const host = document.getElementById('keysTable');
  if (!host) return;
  const groups = new Map();
  for (const d of defs) (groups.get(d.group) || groups.set(d.group, []).get(d.group)).push(d);
  for (const [name, list] of groups) {
    host.append(el('h4', '', name));
    const t = el('table');
    for (const d of list) {
      const tr = el('tr');
      tr.append(el('td', '', d.label));
      const td = el('td');
      d.keys.forEach((k, i) => { if (i) td.append(' / '); td.append(kbd(k)); });
      tr.append(td);
      t.append(tr);
    }
    host.append(t);
  }
}
