import { closeDialog, closeMenu, element, icon, iconButton, showDialog } from './desktop-ui.js';

const items = [
  { id: 'projects', label: '项目', glyph: 'folder' },
  { id: 'images', label: '图像', glyph: 'images' },
  { id: 'health', label: '健康', glyph: 'health' },
  { id: 'sites', label: '站点', glyph: 'grid' },
  { id: 'maps', label: '地图', glyph: 'map' },
  { id: 'gpts', label: 'GPT', glyph: 'cube' },
  { id: 'codex', label: 'Codex', glyph: 'codex' },
];
const defaultPins = ['sites'];
const storageKey = 'workspace-explore-pins-v1';
const byItemId = new Map(items.map((item) => [item.id, item]));

function parsePins(value) {
  try {
    const ids = JSON.parse(value);
    return Array.isArray(ids)
      ? [...new Set(ids.filter((id) => byItemId.has(id)))]
      : defaultPins;
  } catch {
    return defaultPins;
  }
}

function loadPins() {
  try {
    return parsePins(localStorage.getItem(storageKey));
  } catch {
    return defaultPins;
  }
}

export function openExploreDestination(id, { openSites, getProjects, startInProject, showInformation }) {
  if (id === 'sites') {
    openSites();
  } else if (id === 'projects') {
    const list = element('div', 'dialog-results');
    for (const project of getProjects()) {
      const open = element('button', 'dialog-row', project.name);
      open.type = 'button';
      open.addEventListener('click', () => { closeDialog(); startInProject(project); });
      list.append(open);
    }
    showDialog('项目', list);
  } else {
    showInformation(byItemId.get(id).label, '这是本地原型中的入口。');
  }
}

export function createExploreMenu({ anchor, pinnedContainer, pinDivider, onNavigate }) {
  const popover = element('div', 'web-explore-menu');
  popover.id = 'explore-menu';
  popover.tabIndex = -1;
  popover.hidden = true;
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', '探索');
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-controls', popover.id);
  anchor.setAttribute('aria-expanded', 'false');
  document.body.append(popover);

  let pinned = loadPins();
  let activeId;

  const rows = items.map(({ id, label, glyph }) => {
    const group = element('div', 'web-explore-row');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const destination = element('button', 'web-explore-entry');
    destination.type = 'button';
    destination.append(icon(glyph), element('span', '', label));
    destination.addEventListener('click', () => {
      hide(true);
      onNavigate(id);
    });
    const pin = iconButton('pin', '固定到侧边栏', () => changePin(id));
    pin.classList.add('web-explore-pin');
    group.append(destination, pin);
    popover.append(group);
    return { id, group, destination, pin };
  });

  function setActive(id) {
    activeId = id;
    for (const button of pinnedContainer.children) {
      if (button.dataset.exploreDestination === id) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }
    if (byItemId.has(id) && !pinned.includes(id)) {
      anchor.setAttribute('aria-current', 'page');
    } else {
      anchor.removeAttribute('aria-current');
    }
  }

  function renderPins() {
    pinnedContainer.replaceChildren(...pinned.map((id) => {
      const { label, glyph } = byItemId.get(id);
      const button = iconButton(glyph, label, () => onNavigate(id));
      button.dataset.exploreDestination = id;
      return button;
    }));
    pinnedContainer.hidden = pinned.length === 0;
    pinDivider.hidden = pinnedContainer.hidden;
    for (const row of rows) {
      const isPinned = pinned.includes(row.id);
      const label = isPinned ? '从侧边栏取消置顶' : '固定到侧边栏';
      row.group.dataset.pinned = String(isPinned);
      row.pin.setAttribute('aria-label', label);
      row.pin.title = label;
    }
    setActive(activeId);
  }

  function changePin(id) {
    pinned = pinned.includes(id)
      ? pinned.filter((item) => item !== id)
      : [...pinned, id];
    try {
      localStorage.setItem(storageKey, JSON.stringify(pinned));
    } catch {
      // Keep the preference for this page when browser storage is unavailable.
    }
    renderPins();
  }

  function place() {
    const { right, top } = anchor.getBoundingClientRect();
    const { width, height } = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(right + 6, innerWidth - width - 8))}px`;
    popover.style.top = `${Math.max(8, Math.min(top - 1, innerHeight - height - 8))}px`;
  }

  function hide(restoreFocus = false) {
    if (popover.hidden) return;
    popover.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus) anchor.focus();
  }

  function toggle() {
    if (!popover.hidden) {
      hide(true);
      return;
    }
    closeMenu();
    popover.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    place();
    popover.focus();
  }

  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hide(true);
      return;
    }
    const index = rows.findIndex(({ group }) => group.contains(document.activeElement));
    const current = rows[index < 0 ? 0 : index];
    const offset = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (offset) {
      event.preventDefault();
      const next = index < 0 ? (offset > 0 ? 0 : rows.length - 1)
        : (index + offset + rows.length) % rows.length;
      rows[next].destination.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      rows[event.key === 'Home' ? 0 : rows.length - 1].destination.focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      (event.key === 'ArrowLeft' ? current.destination : current.pin).focus();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!popover.contains(event.target) && !anchor.contains(event.target)) hide();
  });
  document.addEventListener('focusin', (event) => {
    if (!popover.contains(event.target) && event.target !== anchor) hide();
  });
  window.addEventListener('resize', () => {
    if (!popover.hidden) place();
  });
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage || event.key !== storageKey) return;
    pinned = parsePins(event.newValue);
    renderPins();
  });

  renderPins();
  return { toggle, setActive };
}
