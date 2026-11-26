import { closeDialog, element, icon, openMenu, showDialog } from './desktop-ui.js';

const examples = [
  ['💼', '行业动态简报', '每周一整理本周值得关注的行业新闻。', '每周一'],
  ['🤖', 'AI 研究进展', '每周五整理近期的研究与工具更新。', '每周五'],
  ['💻', '工程实践精选', '每周分享几篇实用的工程技术文章。', '每周五'],
  ['📖', '周末阅读推荐', '每周六整理一份适合周末阅读的清单。', '每周六'],
  ['🏷️', '价格提醒', '每天检查关注产品的价格变动。', '每天'],
  ['🎟️', '演出资讯', '每周查找近期的音乐与文化活动。', '每周四'],
  ['🎉', '周末活动计划', '每周四整理值得安排的本地活动。', '每周四'],
];

const frequencies = ['每天', '每周一', '每周四', '每周五', '每周六', '每月'];
const statusLabels = { enabled: '已开启', paused: '已暂停', completed: '已完成' };

function button(text, className, onClick) {
  const control = element('button', className, text);
  control.type = 'button';
  control.addEventListener('click', onClick);
  return control;
}

function formField(label, control) {
  const field = element('label', 'web-schedule-field');
  field.append(element('span', '', label), control);
  return field;
}

export function createSchedulesView() {
  const sidebar = element('div', 'web-section-sidebar-content');
  const content = element('section', 'web-section-page web-schedules');
  let tasks = [];
  let selectedId = null;
  let showPaused = false;
  let filters = { enabled: true, paused: true, completed: true };

  const select = (id) => {
    selectedId = id;
    render();
    content.querySelector('h2').focus();
  };

  function renderSidebar() {
    const add = button('新建任务', 'sidebar-row', () => editTask());
    add.prepend(icon('plus'));
    const visible = tasks.filter(({ status }) => filters[status]);
    const rows = visible.filter(({ status }) => status !== 'paused').map(taskButton);
    if (!filters.paused) {
      sidebar.replaceChildren(add, ...rows);
      return;
    }
    const paused = element('div', 'sidebar-group web-schedule-paused');
    const toggle = button(statusLabels.paused, 'sidebar-row web-schedule-paused-toggle', () => {
      showPaused = !showPaused;
      renderSidebar();
      sidebar.querySelector('.web-schedule-paused-toggle').focus();
    });
    toggle.append(icon(showPaused ? 'chevron-down' : 'chevron-right'));
    toggle.setAttribute('aria-expanded', String(showPaused));
    paused.append(toggle);
    if (showPaused) {
      const pausedTasks = visible.filter(({ status }) => status === 'paused');
      paused.append(...(pausedTasks.length ? pausedTasks.map(taskButton) : [element('p', 'dialog-empty', '暂无暂停任务')]));
    }
    sidebar.replaceChildren(add, ...rows, paused);
  }

  function taskButton(task) {
    const row = button(task.name, 'sidebar-row', () => select(task.id));
    row.prepend(icon('calendar'));
    if (task.id === selectedId) row.setAttribute('aria-current', 'page');
    return row;
  }

  function buildIntro() {
    const intro = element('header', 'web-schedule-intro');
    const heading = element('h2', '', '安排任务');
    heading.tabIndex = -1;
    intro.append(icon('calendar'), heading,
      element('p', '', '把持续性的工作安排成定时任务。'));
    const grid = element('div', 'web-schedule-grid');
    grid.append(...examples.map(([symbol, name, prompt, frequency]) => {
      const card = button(undefined, 'web-schedule-card', () => editTask({ name, prompt, frequency }));
      const graphic = element('span', 'web-schedule-card-icon', symbol);
      graphic.setAttribute('aria-hidden', 'true');
      const copy = element('span', 'web-schedule-card-copy');
      copy.append(element('strong', '', name), element('span', '', prompt));
      card.append(graphic, copy);
      return card;
    }));
    return [intro, grid];
  }

  function buildDetail(task) {
    const detail = element('article', 'web-schedule-detail');
    const heading = element('h2', '', task.name);
    heading.tabIndex = -1;
    detail.append(button('安排任务', 'web-schedule-back', () => select(null)), heading,
      element('p', '', `${task.frequency} · ${statusLabels[task.status]} · 本地任务`),
      element('p', '', task.prompt), button('编辑', 'web-section-primary', () => editTask(task)));
    if (task.status !== 'completed') {
      const nextStatus = task.status === 'paused' ? 'enabled' : 'paused';
      const toggle = button(nextStatus === 'enabled' ? '恢复' : '暂停', 'web-tab web-schedule-status', () => {
        if (nextStatus === 'paused') showPaused = true;
        tasks = tasks.map((entry) => entry.id === task.id ? { ...entry, status: nextStatus } : entry);
        render();
        content.querySelector('.web-schedule-status').focus();
      });
      detail.append(toggle);
    }
    return detail;
  }

  function editTask(task = {}) {
    const form = element('form', 'web-schedule-form');
    const name = element('input');
    name.required = true;
    name.maxLength = 100;
    name.value = task.name ?? '';
    const prompt = element('textarea');
    prompt.required = true;
    prompt.rows = 3;
    prompt.maxLength = 1000;
    prompt.value = task.prompt ?? '';
    const frequency = element('select');
    frequency.append(...frequencies.map((value) => element('option', '', value)));
    frequency.value = task.frequency ?? frequencies[0];
    const save = element('button', 'web-section-primary', '保存本地任务');
    save.type = 'submit';
    form.append(formField('任务名称', name), formField('任务内容', prompt), formField('频率', frequency), save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const empty = [name, prompt].find((input) => !input.value.trim());
      if (empty) {
        empty.value = '';
        empty.reportValidity();
        return;
      }
      const record = { id: task.id ?? crypto.randomUUID(), name: name.value.trim(),
        prompt: prompt.value.trim(), frequency: frequency.value, status: task.status ?? 'enabled' };
      tasks = task.id ? tasks.map((entry) => entry.id === task.id ? record : entry) : [...tasks, record];
      closeDialog();
      select(record.id);
    });
    showDialog(task.id ? '编辑任务' : '新建任务', form);
    name.focus();
  }

  function render() {
    renderSidebar();
    const selected = tasks.find(({ id }) => id === selectedId);
    content.replaceChildren(...(selected ? [buildDetail(selected)] : buildIntro()));
  }

  function openFilter(anchor) {
    openMenu(anchor, Object.entries(statusLabels).map(([status, label]) => ({
      label,
      active: filters[status],
      checkbox: true,
      select: () => {
        filters = { ...filters, [status]: !filters[status] };
        renderSidebar();
      },
    })));
  }

  function focusSearch() {
    const search = element('div', 'search-panel');
    const input = element('input');
    input.type = 'search';
    input.placeholder = '搜索定时任务';
    input.setAttribute('aria-label', '搜索定时任务');
    const results = element('div', 'dialog-results');
    const update = () => {
      const query = input.value.trim().toLocaleLowerCase();
      const matches = tasks.filter(({ name }) => name.toLocaleLowerCase().includes(query));
      results.replaceChildren(...matches.map((task) => button(task.name, 'dialog-row', () => {
        closeDialog();
        select(task.id);
      })));
      if (!matches.length) results.append(element('p', 'dialog-empty', '没有匹配的任务'));
    };
    input.addEventListener('input', update);
    search.append(input, results);
    update();
    showDialog('搜索定时任务', search);
    input.focus();
  }

  render();
  return { title: '定时任务', sidebarTitle: '定时任务', sidebar, content, focusSearch, openFilter };
}
