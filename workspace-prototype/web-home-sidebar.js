import { byId, closeDialog, element, icon, iconButton, showDialog } from './desktop-ui.js';

export function orderedChats(threads, preferences, group) {
  if (preferences[`${group}ChatOrder`] !== 'manual') return threads;
  const rank = new Map(preferences[`${group}ManualOrder`].split(',').map((id, index) => [id, index]));
  return [...threads].sort((left, right) => (rank.get(left.id) ?? Infinity) - (rank.get(right.id) ?? Infinity));
}

export function createHomeSidebar({ getState, currentThreadId, openThread, startInProject, addProject, toggleThreadPin, menus }) {
  const openProjects = new Set(['agent-server']);
  const manuallyExpanded = new Set();
  let showAll = false;

  function threadRow(thread, child = false) {
    const row = element('div', 'sidebar-hover-row');
    const button = element('button', `sidebar-row${child ? ' child' : ''}`, thread.title);
    button.type = 'button';
    button.title = thread.title;
    if (child && thread.id === currentThreadId()) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => openThread(thread));
    const actions = element('div', 'sidebar-row-actions');
    const more = iconButton('more', '聊天操作', () => menus.openThreadRow(more, thread));
    more.setAttribute('aria-haspopup', 'menu');
    const pinLabel = thread.pinned ? '取消置顶聊天' : '置顶聊天';
    actions.append(iconButton('pin', pinLabel, () => toggleThreadPin(thread)), more);
    row.append(button, actions);
    return row;
  }

  function projectRow(project, threads) {
    const group = element('div', 'project-entry');
    const row = element('div', 'sidebar-hover-row');
    const open = openProjects.has(project.id);
    const button = element('button', 'sidebar-row project-row');
    button.type = 'button';
    button.id = `project-${project.id}`;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-controls', `threads-${project.id}`);
    button.append(icon(open ? 'folder-open' : 'folder'), element('span', '', project.name));
    button.addEventListener('click', () => {
      if (openProjects.has(project.id)) openProjects.delete(project.id);
      else {
        openProjects.add(project.id);
        manuallyExpanded.add(project.id);
      }
      render();
      byId(button.id)?.focus({ preventScroll: true });
    });

    const actions = element('div', 'sidebar-row-actions');
    const more = iconButton('more', `${project.name} 的项目操作`, () => menus.openProjectRow(more, project));
    more.setAttribute('aria-haspopup', 'menu');
    actions.append(more, iconButton('edit', `在 ${project.name} 中开启新聊天`, () => startInProject(project)));
    row.append(button, actions);

    const list = element('div', 'project-threads');
    list.id = `threads-${project.id}`;
    list.hidden = !open;
    const matches = threads.filter((thread) => thread.projectId === project.id && !thread.pinned && !thread.detached);
    const selected = matches.find(({ id }) => id === currentThreadId());
    const visible = manuallyExpanded.has(project.id) ? matches : [selected ?? matches[0]].filter(Boolean);
    list.append(...visible.map((thread) => threadRow(thread, true)));
    group.append(row, list);
    return group;
  }

  function render() {
    const { threads, projects, preferences, projectId } = getState();
    const visible = threads.filter(({ archived, deleted }) => !archived && !deleted);
    const pinned = visible.filter(({ pinned }) => pinned);
    const recent = visible.filter((thread) => !thread.pinned &&
      (preferences.recentProjectChats !== 'false' || thread.detached) &&
      (preferences.recentChatMode === 'all' || preferences.recentChatMode === (thread.mode ?? 'work')));
    const sortedProjects = projects.filter(({ hidden }) => !hidden)
      .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)));
    const sortedProjectChats = orderedChats(visible, preferences, 'project');
    byId('pinned-group').hidden = pinned.length === 0;
    byId('pinned').replaceChildren(...pinned.map((thread) => threadRow(thread)));
    const projectsInSidebar = showAll ? sortedProjects : sortedProjects.slice(0, 5);
    const activeProject = sortedProjects.find(({ id }) => id === projectId);
    if (activeProject && !projectsInSidebar.includes(activeProject)) projectsInSidebar.push(activeProject);
    byId('projects').replaceChildren(...projectsInSidebar.map((project) => projectRow(project, sortedProjectChats)));
    byId('recent').replaceChildren(...orderedChats(recent, preferences, 'recent').map((thread) => threadRow(thread)));
    byId('show-projects').textContent = showAll ? '收起显示' : '展开显示';
    byId('show-projects').setAttribute('aria-expanded', String(showAll));
    byId('show-projects').hidden = sortedProjects.length <= 5;
  }

  for (const [trigger, target] of [['projects-toggle', 'projects-body'], ['recent-toggle', 'recent']]) {
    byId(trigger).addEventListener('click', () => {
      const expanded = byId(target).hidden;
      byId(target).hidden = !expanded;
      byId(trigger).setAttribute('aria-expanded', String(expanded));
    });
  }
  byId('show-projects').addEventListener('click', () => { showAll = !showAll; render(); });
  byId('add-project').addEventListener('click', addProject);
  byId('project-options').addEventListener('click', (event) => menus.openProjectOptions(event.currentTarget));
  byId('recent-options').addEventListener('click', (event) => menus.openRecentOptions(event.currentTarget));
  return { render, expand: (id) => openProjects.add(id) };
}

export function projectForm(project, save) {
  const form = element('form', 'rename-form');
  const label = element('label', '', '项目名称');
  const name = element('input');
  name.id = 'local-project-name';
  label.htmlFor = name.id;
  name.value = project?.name ?? '';
  name.maxLength = 60;
  name.required = true;
  const submit = element('button', 'primary-button', project ? '保存' : '创建');
  submit.type = 'submit';
  form.append(label, name, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (name.value.trim()) save(name.value.trim());
  });
  showDialog(project ? '项目设置' : '新建项目', form);
  name.select();
}

export function organizeSidebar(threads, currentOrder, apply) {
  let ordered = orderedChats(threads, { recentChatOrder: 'manual', recentManualOrder: currentOrder }, 'recent');
  const list = element('div', 'sidebar-order-list');
  function render() {
    list.replaceChildren(...ordered.map((thread, index) => {
      const row = element('div', 'sidebar-order-row');
      const title = element('span', '', thread.title);
      const up = element('button', 'web-tab', '上移');
      up.type = 'button';
      up.disabled = index === 0;
      up.setAttribute('aria-label', `上移 ${thread.title}`);
      up.addEventListener('click', () => {
        ordered = [...ordered.slice(0, index - 1), thread, ordered[index - 1], ...ordered.slice(index + 1)];
        render();
      });
      row.append(title, up);
      return row;
    }));
  }
  const content = element('div', 'settings-panel');
  const save = element('button', 'primary-button', '保存顺序');
  save.type = 'button';
  save.addEventListener('click', () => apply(ordered.map(({ id }) => id).join(',')));
  render();
  content.append(list, save);
  showDialog('整理侧边栏', content);
}

export function confirmRemoval(title, name, remove) {
  const content = element('div', 'settings-panel');
  const confirm = element('button', 'primary-button', '删除');
  confirm.type = 'button';
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    await remove();
    closeDialog();
  });
  content.append(element('p', '', `从本地原型移除「${name}」？`), confirm);
  showDialog(title, content);
}

export function threadNameForm(thread, saveName) {
  const form = element('form', 'rename-form');
  const label = element('label', '', '聊天名称');
  label.htmlFor = 'rename-input';
  const input = element('input');
  input.id = 'rename-input';
  input.value = thread.title;
  input.maxLength = 90;
  input.required = true;
  const save = element('button', 'primary-button', '保存');
  save.type = 'submit';
  form.append(label, input, save);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) {
      input.setCustomValidity('请输入聊天名称。');
      input.reportValidity();
      return;
    }
    await saveName(title);
    closeDialog();
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  showDialog('重命名聊天', form);
  input.select();
}

export function settingsForm(effort, setEffort, openArchive) {
  const content = element('div', 'settings-panel');
  const label = element('label', '', '推理强度');
  label.htmlFor = 'effort-setting';
  const select = element('select');
  select.id = 'effort-setting';
  select.append(...['轻度', '低', '中', '高', '超高'].map((level) => element('option', '', level)));
  select.value = effort;
  select.addEventListener('change', () => setEffort(select.value));
  const archive = element('button', 'dialog-row', '已归档的聊天');
  archive.type = 'button';
  archive.addEventListener('click', openArchive);
  content.append(label, select, archive, element('p', 'dialog-empty', '这些设置仅应用于当前浏览器中的复刻。'));
  showDialog('设置', content);
}
