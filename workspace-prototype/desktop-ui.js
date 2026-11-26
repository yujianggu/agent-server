export const byId = (id) => document.getElementById(id);

export function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const paths = {
  back: '<path d="m9 6-6 6 6 6M3 12h16"/>',
  forward: '<path d="m15 6 6 6-6 6M21 12H5"/>',
  'panel-left': '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M9 4v16"/>',
  'panel-right': '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M15 4v16"/>',
  home: '<path fill="currentColor" stroke-linejoin="round" d="M2 10.7 10.7 3a2 2 0 0 1 2.6 0l8.7 7.7h-2v8.1a2.2 2.2 0 0 1-2.2 2.2H15v-5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v5H6.2A2.2 2.2 0 0 1 4 18.8v-8.1z"/>',
  pages: '<rect x="3" y="5.5" width="13.5" height="16" rx="3" transform="rotate(-11 9.75 13.5)"/><path d="m10.5 4.1 1.1-1.2a3 3 0 0 1 3.3-.8l5 2.1a3 3 0 0 1 1.7 3.7l-2.5 7"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.7V12l-3 3"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 9h16m-11 5 2 2 4-4"/>',
  plugin: '<circle cx="12" cy="12" r="9.2"/><path d="m12 7 2 2-2 2-2-2 2-2Zm-3 5 2 2-2 2-2-2 2-2Zm6 0 2 2-2 2-2-2 2-2Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M12 17v4m-4 0h8"/>',
  incognito: '<path d="m6 11 1.3-6.1h9.4L18 11M3 11h18m-9 5h1"/><circle cx="7" cy="16.5" r="3"/><circle cx="17" cy="16.5" r="3"/>',
  images: '<rect x="5" y="7" width="13" height="13" rx="3" transform="rotate(-12 11.5 13.5)"/><path d="M9 7V5a3 3 0 0 1 3-3l7 1a3 3 0 0 1 2.5 3.5l-1 6M6 16l4-4 4 4 2-2 2 2"/><circle cx="12.5" cy="10" r="1"/>',
  health: '<path d="M12 3a4 4 0 0 1 4 1.5 4 4 0 0 1 4 4 4 4 0 0 1 0 7 4 4 0 0 1-4 4 4 4 0 0 1-8 0 4 4 0 0 1-4-4 4 4 0 0 1 0-7 4 4 0 0 1 4-4A4 4 0 0 1 12 3Z"/><path d="M12 16.5c-2.5-1.8-4.6-3-4.6-5a2.5 2.5 0 0 1 4.6-1.3 2.5 2.5 0 0 1 4.6 1.3c0 2-2.1 3.2-4.6 5Z"/>',
  map: '<circle cx="12" cy="6" r="3"/><path d="M12 9v8m5-1.5c2.6.5 4 1.7 4 2.8 0 1.7-4 3.2-9 3.2s-9-1.5-9-3.2c0-1.1 1.4-2.2 4-2.8"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm-9 5 9 5 9-5m-9 5v10"/>',
  codex: '<path d="M12 3a4.6 4.6 0 0 1 4.5 1.7 4 4 0 0 1 4 4.1 4.5 4.5 0 0 1 0 6.4 4 4 0 0 1-4 4.1 4.6 4.6 0 0 1-9 0 4 4 0 0 1-4-4.1 4.5 4.5 0 0 1 0-6.4 4 4 0 0 1 4-4.1A4.6 4.6 0 0 1 12 3Z"/><path d="m8 9 2.5 3L8 15m5 0h3"/>',
  pin: '<path d="m14 3 7 7-3 1-3 3v3l-2 2-3-4-4-3 2-2h3l3-3Zm-4 12-6 6"/>',
  trash: '<path d="M4 7h16m-11 0V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
  share: '<path d="M12 16V3m-4 4 4-4 4 4M6 11H4v9h16v-9h-2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  archive: '<path d="M4 8v12h16V8M3 4h18v4H3zm7 8h4"/>',
  filter: '<path d="M4 6h16M7 12h10m-7 6h4"/>',
  at: '<path d="M16 18.9A9.2 9.2 0 1 1 21 11v1.4a2.4 2.4 0 0 1-4.8 0V9m0 2.6a4.1 4.1 0 1 1-8.2 0 4.1 4.1 0 0 1 8.2 0Z"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  branch: '<circle cx="6" cy="5" r="2.3"/><circle cx="6" cy="19" r="2.3"/><circle cx="18" cy="19" r="2.3"/><path d="M6 7.5v9M18 16v-4a4 4 0 0 0-4-4h-2m2.5-5L11 8l3.5 3"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="15" width="6" height="6" rx="1.5"/><rect x="12" y="12" width="9" height="9" rx="2"/>',
  usage: '<path d="M12 2a10 10 0 1 1-4.7 1.2"/><path d="m12 7 5 5-5 5-5-5Z" fill="currentColor" opacity=".25" stroke="none"/>',
  bell: '<path d="M20 17H4l1.1-2.2c.6-1 .9-2.1.9-3.3V9a6 6 0 1 1 12 0v2.5c0 1.2.3 2.3.9 3.3ZM10 20a2 2 0 0 0 4 0"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 4.5 4.5"/>',
  edit: '<path d="M11 4H7a4 4 0 0 0-4 4v9a4 4 0 0 0 4 4h9a4 4 0 0 0 4-4v-4M11 15l2.9-.6L21 7.2a2 2 0 0 0-2.8-2.8L11 11.6z"/>',
  dot: '<ellipse cx="12" cy="12" rx="4.7" ry="10" transform="rotate(45 12 12)"/><ellipse cx="12" cy="12" rx="4.7" ry="10" transform="rotate(-45 12 12)"/>',
  folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Zm0 3h18"/>',
  'folder-open': '<path d="M3 18V7a2 2 0 0 1 2-2h5l2 2h6a2 2 0 0 1 2 2v2M3 18l3-7h14.4a1.4 1.4 0 0 1 1.3 2l-2.3 5.3a2 2 0 0 1-1.8 1.2H5a2 2 0 0 1-2-1.5Z"/>',
  sliders: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M12 7h8m-8 10h5"/>',
  'chevron-down': '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  'chevron-right': '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  copy: '<rect x="3" y="8" width="13" height="13" rx="3"/><path d="M8 5a3 3 0 0 1 3-2h7a3 3 0 0 1 3 3v7a3 3 0 0 1-2 2.8"/>',
  dislike: '<path d="M14 4H9a2 2 0 0 0-2 1.7L5.9 12A2 2 0 0 0 8 14h2l-.5 3.6a2 2 0 0 0 3.8 1l2.5-5V6a2 2 0 0 0-1.8-2ZM19 5h2v8h-2z"/>',
  speaker: '<path d="M3 9v6h4l5 4V5L7 9Zm13 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  shield: '<path d="m12 2.5 8 3v5.7c0 4.8-3.4 8.8-8 10.3-4.6-1.5-8-5.5-8-10.3V5.5Zm0 5v5m0 3h.01"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v2a7 7 0 0 0 14 0v-2m-7 9v2"/>',
  wave: '<path d="M4 10v4m4-7v10m4-13v16m4-12v8m4-6v4"/>',
  'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  github: '<path fill="currentColor" stroke="none" d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.6.1.8-.3.8-.6v-2c-3.2.7-3.8-1.4-3.8-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1.9 1.7 2.5 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.5-.3-5.2-1.2-5.2-5.5a4.4 4.4 0 0 1 1.2-3.1c-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.7 11.7 0 0 1 6 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1a4.4 4.4 0 0 1 1.2 3.1c0 4.3-2.7 5.2-5.2 5.5.4.4.8 1 .8 2.1v2.9c0 .3.2.7.8.6A11.1 11.1 0 0 0 12 .9Z"/>',
};

function paintIcon(node, name) {
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;
  return node;
}

export function icon(name) {
  return paintIcon(element('span', 'ui-icon'), name);
}

export function populateIcons() {
  document.querySelectorAll('[data-icon]').forEach((node) => paintIcon(node, node.dataset.icon));
}

export function iconButton(name, label, onClick) {
  const button = element('button', 'icon-button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(name));
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

const menu = byId('floating-menu');
let menuAnchor;

export function closeMenu(restoreFocus = false) {
  if (!menuAnchor) return;
  const anchor = menuAnchor;
  menuAnchor = undefined;
  anchor.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
  if (restoreFocus) anchor.focus();
}

export function openMenu(anchor, options) {
  if (menuAnchor === anchor) {
    closeMenu(true);
    return;
  }
  closeMenu();
  menuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  menu.setAttribute('aria-label', anchor.getAttribute('aria-label') ?? anchor.textContent.trim());
  fillMenu(menu, options);
  menu.hidden = false;
  positionMenu(menu, anchor.getBoundingClientRect());
  menu.querySelector('button:not(:disabled)')?.focus();
}

function fillMenu(container, options) {
  container.replaceChildren(...options.map(({ label, icon: graphic, active, select, disabled, checkbox, badge, submenu }) => {
    const option = element('button', 'menu-item');
    option.type = 'button';
    option.disabled = Boolean(disabled);
    const role = active === undefined ? 'menuitem' : checkbox ? 'menuitemcheckbox' : 'menuitemradio';
    option.setAttribute('role', role);
    if (graphic) option.append(icon(graphic));
    option.append(element('span', 'menu-item-label', label));
    if (badge) option.append(element('small', 'menu-item-badge', badge));
    if (active !== undefined) option.setAttribute('aria-checked', String(active));
    if (active) option.append(icon('check'));
    if (submenu?.length) {
      option.setAttribute('aria-haspopup', 'menu');
      option.setAttribute('aria-expanded', 'false');
      option.append(icon('chevron-right'));
      option.addEventListener('click', () => openSubmenu(option, submenu, true));
      option.addEventListener('pointerenter', () => openSubmenu(option, submenu));
    } else {
      option.addEventListener('pointerenter', () => clearSubmenu(container));
      option.addEventListener('click', () => { closeMenu(true); select?.(); });
    }
    return option;
  }));
}

function positionMenu(target, box) {
  const { offsetWidth: width, offsetHeight: height } = target;
  target.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, box.left))}px`;
  target.style.top = `${box.bottom + 8 + height <= innerHeight
    ? box.bottom + 6 : Math.max(8, box.top - height - 6)}px`;
}

function clearSubmenu(container) {
  container.querySelector(':scope > .menu-submenu')?.remove();
  container.querySelector(':scope > [aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
}

function openSubmenu(option, options, focus = false) {
  const parent = option.parentElement;
  if (option.getAttribute('aria-expanded') !== 'true') {
    clearSubmenu(parent);
    const submenu = element('div', 'floating-menu menu-submenu');
    submenu.setAttribute('role', 'menu');
    submenu.setAttribute('aria-label', option.querySelector('.menu-item-label').textContent);
    fillMenu(submenu, options);
    parent.append(submenu);
    option.setAttribute('aria-expanded', 'true');
    const box = parent.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = submenu;
    const left = box.right + width <= innerWidth - 8 ? box.right - 1 : Math.max(8, box.left - width + 1);
    submenu.style.left = `${left}px`;
    submenu.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, option.getBoundingClientRect().top - 5))}px`;
  }
  if (focus) parent.querySelector(':scope > .menu-submenu > button:not(:disabled)')?.focus();
}

menu.addEventListener('keydown', (event) => {
  const currentMenu = event.target.closest('[role="menu"]');
  const options = Array.from(currentMenu.querySelectorAll(':scope > button:not(:disabled)'));
  const index = options.indexOf(document.activeElement);
  const delta = { ArrowDown: 1, ArrowUp: -1 }[event.key];
  if (delta !== undefined) {
    event.preventDefault();
    options[(index + delta + options.length) % options.length]?.focus();
  }
  if (event.key === 'ArrowRight' && event.target.getAttribute('aria-haspopup') === 'menu') {
    event.preventDefault();
    event.target.click();
  }
  if (currentMenu !== menu && (event.key === 'ArrowLeft' || event.key === 'Escape')) {
    event.preventDefault();
    const parent = currentMenu.parentElement;
    const trigger = parent.querySelector(':scope > [aria-expanded="true"]');
    clearSubmenu(parent);
    trigger?.focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu(true);
  }
  if (event.key === 'Tab') closeMenu();
});

document.addEventListener('pointerdown', (event) => {
  if (!menuAnchor?.contains(event.target) && !menu.contains(event.target)) closeMenu();
});
window.addEventListener('resize', () => closeMenu());

const dialog = byId('workspace-dialog');

export function showDialog(title, content) {
  closeMenu();
  byId('dialog-title').textContent = title;
  byId('dialog-body').replaceChildren(content);
  if (!dialog.open) dialog.showModal();
}

export function showInformation(title, text) {
  showDialog(title, element('p', 'dialog-empty', text));
}

export function closeDialog() {
  dialog.close();
}

let toastTimer;

export function notify(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3300);
}

export function copyText(text, success = '已复制') {
  if (!navigator.clipboard) {
    notify('无法访问剪贴板');
    return;
  }
  return navigator.clipboard.writeText(text).then(
    () => notify(success),
    () => notify('无法访问剪贴板'),
  );
}
