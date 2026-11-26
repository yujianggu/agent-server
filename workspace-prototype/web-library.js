import { closeDialog, element, icon, iconButton, notify, openMenu, showDialog } from './desktop-ui.js';

const categories = ['推荐', '页面', '幻灯片', '电子表格', '图像', '站点'];
const scopes = ['全部', '你的条目', '与你共享', '回收站'];
const spaces = ['工作区资料', '项目笔记'];
const initialFiles = [
  { name: '项目交付清单', kind: '页面', detail: '跟踪本地原型的交付和验证进度。', time: '1 周前', space: spaces[1] },
  { name: '工作区介绍', kind: '幻灯片', detail: '介绍工作区的主要功能。', time: '2 周前', space: spaces[0] },
  { name: '本周任务', kind: '电子表格', detail: '本周工作计划、负责人和进度。', time: '2 周前', space: spaces[1] },
];
const templates = [
  { name: '待办事项清单', type: '页面模板', style: 'checklist', kind: '页面' },
  { name: '项目展示', type: '幻灯片模板', style: 'portfolio', kind: '幻灯片' },
  { name: '浏览所有模板', type: '', style: 'gallery' },
];

function button(className, label, action, iconName) {
  const control = element('button', className);
  control.type = 'button';
  if (iconName) control.append(icon(iconName));
  control.append(element('span', '', label));
  control.addEventListener('click', action);
  return control;
}

function disclosureGroup(label, items, extra = null) {
  const section = element('section', 'sidebar-group');
  const header = element('div', 'web-library-sidebar-group-header');
  const disclosure = button('web-library-sidebar-disclosure', label, () => {
    items.hidden = !items.hidden;
    disclosure.setAttribute('aria-expanded', String(!items.hidden));
  });
  disclosure.setAttribute('aria-expanded', 'true');
  disclosure.append(icon('chevron-right'));
  const heading = element('h2');
  heading.append(disclosure);
  header.append(heading);
  if (extra) header.append(extra);
  section.append(header, items);
  return section;
}

function nameDialog(title, presetName, onCreate, description) {
  const form = element('form', 'rename-form');
  if (description) form.append(element('p', 'dialog-empty', description));
  const label = element('label', '', '名称');
  const input = element('input');
  input.required = true;
  input.maxLength = 80;
  input.value = presetName;
  label.append(input);
  const submit = element('button', 'primary-button', '创建');
  submit.type = 'submit';
  form.append(label, submit);
  input.addEventListener('input', () => input.setCustomValidity(''));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    const error = name ? onCreate(name) : '请输入名称。';
    if (error) {
      input.setCustomValidity(error);
      input.reportValidity();
      return;
    }
    closeDialog();
  });
  showDialog(title, form);
  input.focus();
}

function templatePreview(template) {
  const preview = element('span', `web-library-preview web-library-preview--${template.style}`);
  preview.setAttribute('aria-hidden', 'true');
  if (template.style === 'checklist') {
    const sheet = element('span', 'web-library-preview-sheet');
    sheet.append(element('strong', '', template.name), element('b', '', '今天'));
    for (let index = 0; index < 3; index += 1) sheet.append(element('i'));
    preview.append(sheet);
  } else if (template.style === 'portfolio') {
    const sheet = element('span', 'web-library-preview-sheet');
    sheet.append(element('strong', '', 'Studio Portfolio'));
    for (let index = 0; index < 3; index += 1) sheet.append(element('i'));
    preview.append(sheet);
  } else {
    preview.append(
      element('i', '', 'Design'), element('i', '', 'Portfolio'), element('i', '', 'Ideas'),
    );
  }
  return preview;
}

export function createLibraryView({ initialCategory = '推荐', openPluginCatalog } = {}) {
  let files = initialFiles;
  let scope = '全部';
  let category = categories.includes(initialCategory) ? initialCategory : '推荐';
  let grid = false;

  const sidebar = element('div', 'web-section-sidebar-content web-library-sidebar');
  const content = element('section', 'web-section-page web-library');
  const header = element('div', 'web-section-heading');
  const heading = element('h2', '', scope);
  const actions = element('div', 'web-section-actions');
  const searchbar = element('label', 'web-section-search');
  const search = element('input');
  search.type = 'search';
  search.placeholder = '搜索';
  search.setAttribute('aria-label', '搜索资料');
  search.addEventListener('input', render);
  searchbar.append(icon('search'), search);
  const create = button('web-section-primary', '创建', () => openCreateMenu(create));
  create.setAttribute('aria-haspopup', 'menu');
  create.setAttribute('aria-expanded', 'false');
  create.append(icon('chevron-down'));
  actions.append(searchbar, create);
  header.append(heading, actions);

  const tabBar = element('div', 'web-section-tabs');
  const tabs = categories.map((label) => button('web-tab', label, () => {
    category = label;
    render();
  }));
  const viewControls = element('div', 'web-library-view-controls');
  const gridControl = button('web-tab', '网格', () => { grid = true; render(); }, 'grid');
  const listControl = button('web-tab', '列表', () => { grid = false; render(); }, 'sliders');
  viewControls.append(gridControl, listControl);
  tabBar.append(...tabs, viewControls);

  const gallery = element('section', 'web-library-templates');
  gallery.append(element('p', 'web-library-template-label', '从模板开始'));
  const previewGrid = element('div', 'web-library-template-grid');
  templates.forEach((template) => {
    const tile = button('web-library-template', template.name, () => {
      if (template.kind) createItem(template.kind, template.name);
      else openTemplates();
    });
    tile.prepend(templatePreview(template));
    if (template.type) {
      tile.setAttribute('aria-label', template.name);
      tile.setAttribute('aria-description', template.type);
      tile.append(element('small', '', template.type));
    }
    previewGrid.append(tile);
  });
  gallery.append(previewGrid);
  const rows = element('div', 'web-library-rows');
  const picker = element('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.hidden = true;
  picker.addEventListener('change', () => {
    const uploads = Array.from(picker.files, ({ name, type }) => ({
      name,
      kind: type.startsWith('image/') ? '图像' : '文件',
      detail: '本地资料条目，已记录文件名称。',
      time: '刚刚',
    }));
    if (uploads.length) addFiles(uploads);
    picker.value = '';
  });
  content.append(header, tabBar, gallery, rows, picker);

  const navigation = element('div', 'sidebar-items');
  const recent = element('div', 'sidebar-items');
  function selectScope(label) {
    scope = label;
    category = '推荐';
    search.value = '';
    render();
  }
  const scopeButtons = scopes.map((label, index) => button(
    'sidebar-row', label, () => selectScope(label), ['pages', 'home', 'dot', 'trash'][index],
  ));
  navigation.append(...scopeButtons.slice(0, 3));
  const spacesList = element('div', 'sidebar-items');
  let spaceButtons = new Map(spaces.map((label) => [label, spaceButton(label)]));
  spacesList.append(...spaceButtons.values());
  const createSpace = iconButton('plus', '创建资料空间', openCreateSpace);
  createSpace.classList.add('web-library-space-create');
  const spacesGroup = disclosureGroup('资料空间', spacesList, createSpace);
  const recentGroup = disclosureGroup('最近', recent);
  const sidebarCreate = button('sidebar-row', '创建', () => openCreateMenu(sidebarCreate), 'plus');
  sidebarCreate.setAttribute('aria-haspopup', 'menu');
  sidebarCreate.setAttribute('aria-expanded', 'false');
  scopeButtons.at(-1).classList.add('web-library-trash');
  sidebar.append(sidebarCreate, navigation, spacesGroup, recentGroup, scopeButtons.at(-1));

  function spaceButton(label) {
    return button('sidebar-row', label, () => selectScope(label), 'folder');
  }

  function openCreateMenu(anchor) {
    openMenu(anchor, [
      { label: '从模板开始', icon: 'grid', select: openTemplates },
      { label: '页面', icon: 'pages', select: () => createItem('页面') },
      { label: '幻灯片', icon: 'monitor', select: () => createItem('幻灯片') },
      { label: '电子表格', icon: 'grid', disabled: true, badge: '即将推出' },
      { label: '站台', icon: 'monitor', select: () => createItem('站点') },
      { label: '图像', icon: 'pages', select: () => createItem('图像') },
      { label: '文件夹', icon: 'folder', select: () => createItem('文件夹') },
      { label: '资料空间', icon: 'folder-open', select: openCreateSpace },
      { label: '上传文件', icon: 'pages', select: () => picker.click() },
      { label: '连接插件', icon: 'plugin', select: openPluginCatalog ?? openPluginNotice },
    ]);
  }

  function openPluginNotice() {
    showDialog('连接插件', element('p', 'dialog-empty', '在插件目录浏览本地示例。'));
  }

  function openTemplates() {
    const options = element('div', 'dialog-results');
    options.append(...templates.filter(({ kind }) => kind).map(({ name, kind }) => (
      button('dialog-row', name, () => createItem(kind, name), 'pages')
    )));
    showDialog('浏览所有模板', options);
  }

  function openFile(file) {
    const description = element('div', 'settings-panel');
    description.append(element('p', 'dialog-empty', file.kind), element('p', '', file.detail));
    showDialog(file.name, description);
  }

  function addFiles(items) {
    const space = spaceButtons.has(scope) ? scope : undefined;
    files = [...items.map((item) => ({ ...item, space })), ...files];
    selectScope(space ?? '你的条目');
    notify(items.length > 1 ? `已添加 ${items.length} 项本地资料` : '已添加本地资料');
  }

  function createItem(kind, name = '') {
    nameDialog(`创建${kind === '站点' ? '站台' : kind}`, name, (title) => {
      addFiles([{ name: title, kind, detail: '创建于本地资料空间。', time: '刚刚' }]);
    }, kind === '图像' ? '在本地资料空间中创建图像名称记录。' : '');
  }

  function openCreateSpace() {
    nameDialog('创建资料空间', '', (name) => {
      if (spaceButtons.has(name) || scopes.includes(name)) return '此名称已使用。';
      const control = spaceButton(name);
      spaceButtons = new Map([...spaceButtons, [name, control]]);
      spacesList.append(control);
      selectScope(name);
      notify('已创建本地资料空间');
    });
  }

  function fileRow(file) {
    const control = button('web-library-row', file.name, () => openFile(file), file.kind === '文件夹' ? 'folder' : 'pages');
    control.setAttribute('aria-label', file.name);
    control.setAttribute('aria-description', `${file.kind}，${file.time}`);
    const label = control.lastElementChild;
    label.className = 'web-library-row-label';
    label.append(element('small', '', file.time));
    control.append(element('span', 'web-library-owner', '你'));
    return control;
  }

  function render() {
    heading.textContent = scope;
    function markScope(control, label) {
      const selected = label === scope;
      control.classList.toggle('selected', selected);
      if (selected) control.setAttribute('aria-current', 'page');
      else control.removeAttribute('aria-current');
    }
    scopeButtons.forEach((control, index) => markScope(control, scopes[index]));
    spaceButtons.forEach(markScope);
    tabs.forEach((control, index) => control.setAttribute('aria-pressed', String(categories[index] === category)));
    gridControl.setAttribute('aria-pressed', String(grid));
    listControl.setAttribute('aria-pressed', String(!grid));
    rows.classList.toggle('web-library-rows--grid', grid);
    const query = search.value.trim().toLocaleLowerCase();
    const matches = files.filter((file) =>
      (['全部', '你的条目'].includes(scope) || file.space === scope) &&
      (category === '推荐' || category === file.kind) &&
      file.name.toLocaleLowerCase().includes(query));
    gallery.hidden = scope !== '全部' || category !== '推荐' || Boolean(query);
    rows.replaceChildren(...(matches.length ? matches.map(fileRow) : [element('p', 'dialog-empty', '没有资料')]));
    recent.replaceChildren(...files.slice(0, 5).map((file) => button('sidebar-row', file.name, () => openFile(file), 'pages')));
  }

  render();
  return {
    title: '全部',
    sidebarTitle: '资料空间',
    sidebar,
    content,
    focusSearch: () => search.focus(),
    setCategory(next) {
      if (!categories.includes(next)) return;
      scope = '全部';
      category = next;
      search.value = '';
      render();
    },
  };
}
