import { closeDialog, element, icon, iconButton, notify, openMenu, showDialog } from './desktop-ui.js';

const catalog = [
  { name: 'Gmail', description: 'Read and manage Gmail', glyph: 'M', color: '#c83c32', group: '热门' },
  { name: 'Google Drive', description: 'Drive, Docs, Sheets or Slides', glyph: '▲', color: '#188653', group: '热门' },
  { name: 'Google Calendar', description: 'Manage Google Calendar events', glyph: '31', color: '#2869d5', group: '热门' },
  { name: 'Slack', description: 'Read and manage Slack', glyph: '#', color: '#7a317a', group: '热门' },
  { name: 'GitHub', description: 'Triage PRs, issues, CI, and publish flows', icon: 'github', color: '#151515', group: '热门' },
  { name: 'Outlook Email', description: 'Triage Outlook inboxes', glyph: 'O', color: '#0766b9', group: '热门' },
  { name: 'iCloud Mail', description: 'Read and manage iCloud email', glyph: '✉', color: '#1676cf', group: '新品推荐' },
  { name: 'ElevenLabs', description: 'Voice agents and media', glyph: 'Ⅱ', color: '#242424', group: '新品推荐' },
  { name: 'iCloud Calendar', description: 'Read and manage iCloud events', glyph: '1', color: '#bd3543', group: '新品推荐' },
  { name: 'Shotproof', description: '将截图转成网页原型并进行视觉校验', icon: 'monitor', color: '#4164ba', group: '本地示例', providesSkill: true },
];

function button(text, className, action) {
  const control = element('button', className, text);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

function badge(plugin) {
  const node = element('span', 'web-plugin-badge');
  node.setAttribute('aria-hidden', 'true');
  node.style.color = plugin.color;
  node.append(plugin.icon ? icon(plugin.icon) : plugin.glyph);
  return node;
}

export function createPluginsView() {
  const searchLabel = '搜索已安装的插件';
  let entries = [...catalog];
  const installed = new Set(['Shotproof']);
  let kind = 'plugins';
  let tab = 'public';

  const sidebar = element('div', 'web-plugins-sidebar');
  const content = element('section', 'web-section-page web-plugins');
  const heading = element('div', 'web-section-heading');
  const intro = element('div', 'web-plugin-intro');
  const title = element('h2');
  const summary = element('p');
  const actions = element('div', 'web-section-actions');
  const search = element('label', 'web-section-search');
  const query = element('input');
  query.type = 'search';
  search.append(icon('search'), query);
  const add = button('添加', 'web-section-primary', () => openMenu(add, [
    { label: '创建插件', select: createExample },
    { label: '上传插件压缩包', select: previewArchive },
    { label: '添加自定义 MCP 服务器', select: () => createExample(true) },
  ]));
  add.setAttribute('aria-haspopup', 'menu');
  add.setAttribute('aria-expanded', 'false');
  add.append(icon('chevron-down'));
  actions.append(search, add);
  intro.append(title, summary);
  heading.append(intro, actions);
  const tabs = element('div', 'web-section-tabs');
  const publicTab = button('公开', 'web-tab', () => setTab('public'));
  const personalTab = button('个人', 'web-tab', () => setTab('personal'));
  tabs.append(publicTab, personalTab);
  const groups = element('div', 'web-plugin-groups');
  content.append(heading, tabs, groups);

  const pluginTab = sidebarButton('插件', 'plugin', () => setKind('plugins'));
  const skillTab = sidebarButton('技能', 'grid', () => setKind('skills'));
  const installedGroup = element('section', 'sidebar-group');
  const installedRows = element('div', 'sidebar-items');
  installedGroup.append(element('h2', '', '已安装'), installedRows);
  sidebar.append(pluginTab, skillTab, installedGroup);
  query.addEventListener('input', renderResults);

  function sidebarButton(label, image, action) {
    const control = button('', 'sidebar-row', action);
    control.append(icon(image), element('span', '', label));
    return control;
  }

  function setKind(nextKind) {
    kind = nextKind;
    query.value = '';
    render();
  }

  function setTab(nextTab) {
    tab = nextTab;
    render();
  }

  function openDetails(plugin, skill = false) {
    const detail = element('div', 'web-plugin-detail');
    detail.append(badge(plugin), element('p', '', plugin.description));
    if (skill) {
      showDialog(plugin.name, detail);
      return;
    }
    const active = installed.has(plugin.name);
    const toggle = button(active ? '移除' : '添加', 'web-section-primary', () => {
      if (active) installed.delete(plugin.name);
      else installed.add(plugin.name);
      closeDialog();
      render();
      query.focus();
      notify(active ? '已移除本地示例' : '已添加本地示例');
    });
    detail.append(element('p', 'dialog-empty', '安装状态仅保存在当前原型中。'), toggle);
    showDialog(plugin.name, detail);
    toggle.focus();
  }

  function createExample(server = false) {
    const form = element('form', 'rename-form');
    const label = element('label', '', server ? '服务器名称' : '示例插件名称');
    const name = element('input');
    label.append(name);
    name.required = true;
    name.maxLength = 50;
    form.append(label);
    if (server) {
      const address = element('label', '', '服务器 URL');
      const url = element('input');
      url.type = 'url';
      url.placeholder = 'https://example.com/mcp';
      url.required = true;
      address.append(url);
      form.append(address, element('p', 'dialog-empty', '此表单只创建本地示例条目。'));
    }
    const save = element('button', 'primary-button', '添加');
    save.type = 'submit';
    form.append(save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = name.value.trim();
      if (!value || entries.some((plugin) => plugin.name.toLowerCase() === value.toLowerCase())) {
        name.setCustomValidity(value ? '已有同名条目。' : '请输入名称。');
        name.reportValidity();
        return;
      }
      const description = server ? '自定义 MCP 服务器示例' : '在当前原型中添加的示例';
      entries = [...entries, { name: value, description, glyph: Array.from(value)[0],
        color: '#4164ba', group: '本地示例' }];
      installed.add(value);
      query.value = '';
      setTab('personal');
      closeDialog();
      query.focus();
      notify('已添加本地示例');
    });
    name.addEventListener('input', () => name.setCustomValidity(''));
    showDialog(server ? '添加自定义 MCP 服务器' : '创建插件', form);
    name.focus();
  }

  function previewArchive() {
    const content = element('div', 'rename-form');
    const label = element('label', '', '选择插件压缩包');
    const picker = element('input');
    picker.type = 'file';
    picker.accept = '.zip,application/zip';
    const filename = element('p', 'dialog-empty', '此原型仅显示所选文件的名称。');
    filename.setAttribute('role', 'status');
    picker.addEventListener('change', () => {
      if (picker.files[0]) filename.textContent = picker.files[0].name;
    });
    label.append(picker);
    content.append(label, filename);
    showDialog('上传插件压缩包', content);
    picker.focus();
  }

  function installedPlugins() {
    return entries.filter(({ name }) => installed.has(name));
  }

  function searchInstalled() {
    const body = element('div', 'search-panel');
    const input = element('input');
    input.type = 'search';
    input.placeholder = searchLabel;
    input.setAttribute('aria-label', searchLabel);
    const results = element('div', 'dialog-results');
    function showMatches() {
      const term = input.value.trim().toLowerCase();
      const matches = installedPlugins().filter(({ name }) => name.toLowerCase().includes(term));
      results.replaceChildren(...matches.map((plugin) => button(plugin.name, 'dialog-row', () => openDetails(plugin))));
      if (!matches.length) results.append(element('p', 'dialog-empty', '没有找到已安装的插件。'));
    }
    input.addEventListener('input', showMatches);
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
      }
      if (event.key === 'Enter') results.querySelector('button')?.click();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        results.querySelector('button')?.focus();
      }
    });
    body.append(input, results);
    showMatches();
    showDialog(searchLabel, body);
    input.focus();
  }

  function pluginRow(plugin) {
    const row = element('div', 'web-plugin-row');
    const skill = kind === 'skills';
    const open = () => openDetails(plugin, skill);
    const detail = button('', 'web-plugin-open', open);
    const copy = element('span', 'web-plugin-item-text');
    copy.append(element('strong', '', plugin.name), element('small', '', plugin.description));
    detail.append(badge(plugin), copy);
    const selected = installed.has(plugin.name);
    const actionLabel = skill ? '查看' : selected ? '管理' : '添加';
    const action = iconButton(skill || selected ? 'more' : 'plus', `${actionLabel} ${plugin.name}`, open);
    action.classList.add('web-plugin-action');
    row.append(detail, action);
    return row;
  }

  function renderResults() {
    const term = query.value.trim().toLowerCase();
    const matches = entries.filter((plugin) => {
      if (kind === 'skills' && !plugin.providesSkill) return false;
      if (kind === 'plugins' && tab === 'personal' && !installed.has(plugin.name)) return false;
      return `${plugin.name} ${plugin.description}`.toLowerCase().includes(term);
    });
    const categories = kind === 'skills' ? ['本地示例'] : ['热门', '新品推荐', '本地示例'];
    groups.replaceChildren(...categories.flatMap((category) => {
      const items = matches.filter(({ group }) => group === category);
      if (!items.length) return [];
      const section = element('section', 'web-plugin-group');
      const grid = element('div', 'web-plugin-grid');
      grid.append(...items.map(pluginRow));
      section.append(element('h3', '', category), grid);
      return [section];
    }));
    if (!matches.length) groups.append(element('p', 'web-plugin-empty', '没有找到匹配的条目。'));
  }

  function render() {
    const viewingPlugins = kind === 'plugins';
    const label = viewingPlugins ? '插件' : '技能';
    title.textContent = label;
    summary.textContent = viewingPlugins ? '连接插件，让 ChatGPT 在你的各类工具中协同工作' : '查看当前原型可用的技能';
    query.setAttribute('aria-label', `搜索${label}`);
    query.placeholder = `搜索${label}`;
    tabs.hidden = !viewingPlugins;
    add.hidden = !viewingPlugins;
    publicTab.setAttribute('aria-pressed', String(tab === 'public'));
    personalTab.setAttribute('aria-pressed', String(tab === 'personal'));
    pluginTab.classList.toggle('selected', viewingPlugins);
    skillTab.classList.toggle('selected', !viewingPlugins);
    pluginTab.setAttribute('aria-pressed', String(viewingPlugins));
    skillTab.setAttribute('aria-pressed', String(!viewingPlugins));
    installedRows.replaceChildren(...installedPlugins().map((plugin) => {
      const row = button('', 'sidebar-row', () => openDetails(plugin));
      row.append(badge(plugin), element('span', '', plugin.name));
      return row;
    }));
    installedGroup.hidden = installed.size === 0;
    renderResults();
  }

  render();
  return { title: '插件', sidebarTitle: '自定义', sidebar, content, searchLabel, focusSearch: searchInstalled };
}
