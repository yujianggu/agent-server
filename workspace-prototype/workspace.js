import {
  createTitle, loadWorkspace, localReply, referenceThreadId, resolveLocation,
  saveWorkspace, searchThreads, storageKey,
} from './workspace-state.js';
import {
  byId, closeDialog, copyText, element, icon, iconButton, notify,
  openMenu, populateIcons, showDialog, showInformation,
} from './desktop-ui.js';
import { createLibraryView } from './web-library.js';
import { createSchedulesView } from './web-schedules.js';
import { createPluginsView } from './web-plugins.js';
import { createExploreMenu, openExploreDestination } from './web-explore.js';
import { createHomeMenus } from './web-home-menus.js';
import { confirmRemoval, createHomeSidebar, organizeSidebar, projectForm, settingsForm, threadNameForm } from './web-home-sidebar.js';

const desktop = byId('desktop');
const chatMain = byId('chat-main');
const composer = byId('composer');
const messageInput = byId('message');
const conversation = byId('conversation');
const navigationToggle = byId('navigation-toggle');
const smallWindow = matchMedia('(max-width: 640px)');
const drafts = new Map();
const reactions = new Set();
const createSection = {
  pages: () => createLibraryView({ openPluginCatalog: () => openLocation({ ...location(), section: 'plugins' }) }),
  schedules: createSchedulesView,
  plugins: createPluginsView,
};
const sections = new Map();

let storage;
try {
  storage = window.localStorage;
} catch {
  storage = null;
}
let state = loadWorkspace(storage);
let historyIndex = 0;
let sectionId = 'home';
let history = [{ ...location(), section: sectionId }];
let desktopSidebar = true;
let mobileSidebar = false;
let temporaryThread;
let chosenWorkProject;
const homeMenus = createHomeMenus({
  getPreferences: () => state.preferences,
  setPreference,
  organize: organizeHome,
  getProjects,
  editProject,
  removeProject: (project) => confirmRemoval('删除项目', project.name, () => changeProject(project.id, { hidden: true })),
  changeProject,
  renameThread,
  changeThread,
  archiveThread,
  deleteThread: (thread) => confirmRemoval('删除聊天', thread.title, () => changeThread(thread.id, { deleted: true })),
  showInformation,
});
const homeSidebar = createHomeSidebar({
  getState: () => state,
  currentThreadId: () => temporaryThread ? null : state.activeId,
  openThread,
  startInProject,
  addProject: () => editProject(),
  toggleThreadPin: (thread) => changeThread(thread.id, { pinned: !thread.pinned }),
  menus: homeMenus,
});
const explore = createExploreMenu({
  anchor: byId('more'),
  pinnedContainer: byId('rail-pinned'),
  pinDivider: byId('rail-pinned-divider'),
  onNavigate: (id) => openExploreDestination(id, {
    openSites: () => openLocation({ ...location(), section: 'sites' }),
    getProjects, startInProject, showInformation,
  }),
});

function location() {
  const { activeId, projectId } = state;
  return { activeId, projectId };
}

function activeThread() {
  return temporaryThread ?? state.threads.find(({ id, deleted }) => !deleted && id === state.activeId);
}

function getProjects() {
  return state.projects.filter(({ hidden }) => !hidden);
}

function draftKey() {
  return temporaryThread?.id ?? state.activeId ?? `new:${state.projectId}`;
}

function draft() {
  return drafts.get(draftKey()) ?? { text: '', attachments: [] };
}

function updateDraft(change) {
  drafts.set(draftKey(), { ...draft(), ...change });
}

async function updateWorkspace(change, nextLocation = location()) {
  const commit = () => {
    const changed = change(loadWorkspace(storage, state));
    state = { ...changed, ...resolveLocation(changed, nextLocation) };
    if (storage && !saveWorkspace(storage, state)) {
      storage = null;
      notify('浏览器无法保存更改，刷新后更改会丢失。');
    }
  };
  if (storage && navigator.locks) await navigator.locks.request(storageKey, commit);
  else commit();
}

async function openLocation(destination, record = true) {
  endTemporaryChat();
  const { activeId, section = 'home' } = destination;
  const moved = activeId && state.threads.find(({ id }) => id === activeId);
  const projectId = moved?.projectId ?? destination.projectId;
  if (record && (state.activeId !== activeId || state.projectId !== projectId || sectionId !== section)) {
    history = [...history.slice(0, historyIndex + 1), { activeId, projectId, section }];
    historyIndex = history.length - 1;
  }
  await updateWorkspace((latest) => latest, { activeId, projectId });
  sectionId = section;
  if (section !== 'home') setSidePanel(false);
  if (activeId && section === 'home') homeSidebar.expand(projectId);
  if (mobileSidebar) setMobileSidebar(false);
  render();
}

async function openThread(thread) {
  await openLocation({ activeId: thread.id, projectId: thread.projectId });
}

async function startThread() {
  await openLocation({ activeId: null, projectId: state.projectId });
  messageInput.focus();
}

async function startInProject(project) {
  chosenWorkProject = project;
  homeSidebar.expand(project.id);
  await openLocation({ activeId: null, projectId: project.id });
  messageInput.focus();
}

function endTemporaryChat() {
  if (!temporaryThread) return;
  drafts.delete(temporaryThread.id);
  temporaryThread = undefined;
}

function toggleTemporaryChat() {
  if (temporaryThread) {
    endTemporaryChat();
  } else {
    temporaryThread = {
      id: `temporary:${crypto.randomUUID()}`,
      title: '临时聊天',
      projectId: state.projectId,
      messages: [],
    };
  }
  render();
  messageInput.focus();
}

function setMobileSidebar(open, focus = false) {
  if (open) setSidePanel(false);
  mobileSidebar = open;
  syncNavigation();
  if (!focus) return;
  const sectionAction = byId('web-section-sidebar').querySelector('button');
  const firstAction = sectionId === 'home' ? byId('new-thread') : sectionAction ?? byId('sidebar-collapse');
  (open ? firstAction : navigationToggle).focus();
}

function syncNavigation() {
  const sidebarOpen = smallWindow.matches ? mobileSidebar : desktopSidebar;
  desktop.dataset.sidebarHidden = String(!smallWindow.matches && !desktopSidebar);
  desktop.dataset.sidebarOpen = String(smallWindow.matches && mobileSidebar);
  byId('navigation-scrim').hidden = !(smallWindow.matches && mobileSidebar);
  byId('toolbar-new-thread').parentElement.hidden = sidebarOpen;
  document.querySelector('.desktop-main').inert = smallWindow.matches && mobileSidebar;
  const label = sidebarOpen ? '隐藏侧边栏' : '显示侧边栏';
  navigationToggle.setAttribute('aria-expanded', String(sidebarOpen));
  navigationToggle.setAttribute('aria-label', label);
  navigationToggle.parentElement.dataset.tooltip = label;
}

function toggleSidebar() {
  if (smallWindow.matches) {
    setMobileSidebar(!mobileSidebar, true);
  } else {
    desktopSidebar = !desktopSidebar;
    syncNavigation();
    if (!desktopSidebar) navigationToggle.focus();
  }
}

function renderHighlighted(text, phrases = []) {
  const paragraph = element('p');
  const phrase = phrases.find((item) => text.includes(item));
  if (!phrase) {
    paragraph.textContent = text;
    return paragraph;
  }
  const start = text.indexOf(phrase);
  paragraph.append(text.slice(0, start), element('strong', '', phrase), text.slice(start + phrase.length));
  return paragraph;
}

function userMessage(message) {
  const article = element('article', 'chat-user');
  if (message.text) article.append(element('p', '', message.text));
  if (message.attachments?.length) {
    const files = element('ul', 'message-attachments');
    files.append(...message.attachments.map(({ name }) => element('li', '', name)));
    article.append(files);
  }
  return article;
}

function elapsedDetails(message) {
  const container = element('div', 'elapsed-summary');
  const button = element('button', 'elapsed', message.elapsed);
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.append(icon('chevron-right'));
  const summary = element('ul', 'elapsed-activity');
  summary.hidden = true;
  summary.append(...message.activity.map((item) => element('li', '', item)));
  button.addEventListener('click', () => {
    summary.hidden = !summary.hidden;
    button.setAttribute('aria-expanded', String(!summary.hidden));
  });
  container.append(button, summary);
  return container;
}

function assistantMessage(message, index) {
  const article = element('article', 'chat-assistant');
  if (message.elapsed) article.append(elapsedDetails(message));
  const body = element('div', 'assistant-body');
  body.append(renderHighlighted(message.text, message.highlight));
  if (message.followup || message.link) {
    const paragraph = element('p', '', message.followup ?? '');
    if (message.link) {
      const link = element('a');
      link.href = 'https://github.com/deserteaglemj/shotproof';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(icon('github'), message.link.title);
      paragraph.append(' ', link);
    }
    body.append(paragraph);
  }
  const tools = element('div', 'message-tools');
  const feedbackKey = `${activeThread()?.id}:${index}`;
  const dislike = iconButton('dislike', '标记为不满意', () => {
    if (reactions.has(feedbackKey)) reactions.delete(feedbackKey);
    else reactions.add(feedbackKey);
    dislike.setAttribute('aria-pressed', String(reactions.has(feedbackKey)));
  });
  dislike.setAttribute('aria-pressed', String(reactions.has(feedbackKey)));
  const speak = iconButton('speaker', '朗读回复', () => {
    if (!window.speechSynthesis) {
      notify('当前浏览器不支持朗读。');
      return;
    }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      return;
    }
    const speech = new SpeechSynthesisUtterance(body.innerText);
    speech.lang = 'zh-CN';
    window.speechSynthesis.speak(speech);
  });
  const more = iconButton('more', '更多回复选项', () => openMenu(more, [
    { label: '复制回复', select: () => copyText(body.innerText) },
    { label: '定位到回复', select: () => article.scrollIntoView({ block: 'center' }) },
  ]));
  tools.append(iconButton('copy', '复制回复', () => copyText(body.innerText)), dislike, speak, more);
  article.append(body, tools);
  return article;
}

function renderConversation({ scrollToEnd = false, preserveScroll = false } = {}) {
  const thread = activeThread();
  const previousScroll = conversation.scrollTop;
  const title = currentSection()?.sidebarTitle ?? thread?.title ?? '开始聊天';
  const heading = byId('thread-title');
  heading.textContent = title;
  heading.title = title;
  document.title = `${title} · Codex`;
  conversation.hidden = sectionId !== 'home' || !thread?.messages.length;
  byId('messages').replaceChildren(...(thread?.messages.map((message, index) => (
    message.role === 'user' ? userMessage(message) : assistantMessage(message, index)
  )) ?? []));
  byId('back').disabled = historyIndex <= 0;
  byId('forward').disabled = historyIndex >= history.length - 1;
  conversation.scrollTop = scrollToEnd ? conversation.scrollHeight : preserveScroll ? previousScroll : 0;
}

function renderComposer() {
  const { text, attachments } = draft();
  const attachmentList = byId('attachments');
  attachmentList.hidden = attachments.length === 0;
  attachmentList.replaceChildren(...attachments.map(({ name }, index) => {
    const item = element('span', 'attachment-chip');
    const remove = iconButton('x', `移除附件 ${name}`, () => {
      updateDraft({ attachments: attachments.filter((_, position) => position !== index) });
      renderComposer();
      attachmentList.querySelector('button')?.focus();
    });
    item.append(element('span', '', name), remove);
    return item;
  }));
  renderWebLayout();
  updateComposerControls(text, attachments);
  const { model, effort } = state.preferences;
  byId('model-label').textContent = model;
  byId('effort-label').textContent = effort;
}

function updateComposerControls(text, attachments) {
  const locked = Boolean(activeThread()?.locked);
  const canSend = !locked && Boolean(text.trim() || attachments.length);
  const suggest = !temporaryThread && !text && !attachments.length && state.activeId === referenceThreadId;
  byId('suggestion').hidden = locked || !suggest;
  messageInput.readOnly = locked;
  byId('add-attachment').disabled = locked;
  messageInput.placeholder = locked ? '聊天已锁定' : suggest ? '' : composerPlaceholder();
  byId('send').hidden = !canSend;
  byId('voice').hidden = canSend;
}

function composerPlaceholder() {
  if (temporaryThread) return '发送消息';
  return state.preferences.mode === 'chat' ? '询问任何问题' : '使用 ChatGPT Work';
}

function renderWebLayout() {
  const empty = !activeThread()?.messages.length;
  const isChat = state.preferences.mode === 'chat';
  const isTemporary = Boolean(temporaryThread);
  const showWorkTools = empty && !isChat && !isTemporary;
  chatMain.dataset.empty = String(empty);
  chatMain.dataset.mode = isChat ? 'chat' : 'work';
  chatMain.dataset.temporary = String(isTemporary);
  byId('thread-empty').hidden = !empty;
  byId('web-home-heading').textContent = isTemporary ? '临时聊天' :
    isChat ? '有什么可以帮你？' : '我们要做什么？';
  byId('temporary-note').hidden = !isTemporary;
  byId('temporary-chat').setAttribute('aria-pressed', String(isTemporary));
  byId('mode-chat').setAttribute('aria-pressed', String(isChat));
  byId('mode-work').setAttribute('aria-pressed', String(!isChat));
  byId('web-work-tools').hidden = !showWorkTools;
  byId('web-suggestions').hidden = !showWorkTools;
  const chosen = getProjects().find(({ id }) => id === chosenWorkProject?.id && id === state.projectId);
  const projectLabel = chosen?.name ?? '选择项目';
  byId('work-project-label').textContent = projectLabel;
}

function render(options) {
  renderSection();
  homeSidebar.render();
  messageInput.value = draft().text;
  renderComposer();
  renderConversation(options);
  if (!byId('side-panel').hidden) renderSidePanel();
}

function renderSection() {
  const isHome = sectionId === 'home';
  const section = currentSection();
  const sidebar = byId('web-section-sidebar');
  const view = byId('web-section-view');
  sidebar.hidden = isHome;
  view.hidden = isHome;
  byId('home-sidebar').hidden = !isHome;
  byId('web-chat-top').hidden = !isHome;
  byId('chat-stage').hidden = !isHome;
  byId('product-menu').textContent = section?.sidebarTitle ?? 'ChatGPT';
  byId('section-filter').hidden = sectionId !== 'schedules';
  byId('library-notifications').hidden = sectionId !== 'pages' && sectionId !== 'sites';
  const searchLabel = section?.searchLabel ?? (sectionId === 'schedules' ? '搜索定时任务' :
    isHome ? '搜索会话' : '搜索资料');
  byId('search-thread').setAttribute('aria-label', searchLabel);
  byId('search-thread').title = searchLabel;
  if (sectionId !== chatMain.dataset.section && (sectionId === 'pages' || sectionId === 'sites')) {
    section.setCategory(sectionId === 'sites' ? '站点' : '推荐');
  }
  chatMain.dataset.section = sectionId;
  explore.setActive(sectionId);
  for (const id of ['home', ...Object.keys(createSection)]) {
    const link = byId(id);
    link.classList.toggle('selected', id === sectionId);
    if (id === sectionId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (section && view.firstElementChild !== section.content) {
    sidebar.replaceChildren(section.sidebar);
    view.replaceChildren(section.content);
    view.scrollTop = 0;
  }
}

function currentSection() {
  const key = sectionId === 'sites' ? 'pages' : sectionId;
  const create = createSection[key];
  if (create && !sections.has(key)) sections.set(key, create());
  return sections.get(key);
}

async function sendMessage() {
  if (activeThread()?.locked) return;
  const { text, attachments } = draft();
  if (!text.trim() && !attachments.length) return;
  const thread = activeThread() ?? {
    id: crypto.randomUUID(), title: createTitle(text), projectId: state.projectId, messages: [],
    mode: state.preferences.mode, detached: !getProjects().some(({ id }) => id === state.projectId),
  };
  const user = { role: 'user', text: text.trim(), attachments };
  const reply = localReply(attachments);
  drafts.delete(draftKey());
  messageInput.value = '';
  updateComposerControls('', []);
  if (temporaryThread) {
    temporaryThread = { ...temporaryThread, messages: [...temporaryThread.messages, user, reply] };
    render({ scrollToEnd: true });
    byId('announcement').textContent = reply.text;
    messageInput.focus();
    return;
  }
  if (!state.activeId) {
    history = [...history.slice(0, historyIndex + 1), { activeId: thread.id, projectId: thread.projectId }];
    historyIndex = history.length - 1;
  }
  await updateWorkspace((latest) => {
    const saved = latest.threads.find(({ id }) => id === thread.id) ?? thread;
    const updated = { ...saved, messages: [...saved.messages, user, reply] };
    return { ...latest, threads: [updated, ...latest.threads.filter(({ id }) => id !== thread.id)] };
  }, { activeId: thread.id, projectId: thread.projectId });
  render({ scrollToEnd: true });
  byId('announcement').textContent = reply.text;
  messageInput.focus();
}

function searchDialog(archived = false) {
  const content = element('div', 'search-panel');
  const input = element('input');
  input.type = 'search';
  input.setAttribute('aria-label', '搜索会话');
  input.placeholder = '搜索会话';
  input.autofocus = true;
  const results = element('div', 'dialog-results');
  function renderResults() {
    const threads = searchThreads(state.threads, input.value, { archived });
    results.replaceChildren(...threads.map((thread) => {
      const result = element('button', 'dialog-row', thread.title);
      result.type = 'button';
      result.addEventListener('click', () => { closeDialog(); openThread(thread); });
      return result;
    }));
    if (!threads.length) results.append(element('p', 'dialog-empty', '没有找到会话'));
  }
  input.addEventListener('input', renderResults);
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') results.querySelector('button')?.click();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      results.querySelector('button')?.focus();
    }
  });
  content.append(input, results);
  renderResults();
  showDialog(archived ? '已归档的聊天' : '搜索会话', content);
  input.focus();
}

async function changeThread(threadId, changes) {
  await updateWorkspace((latest) => ({
    ...latest,
    threads: latest.threads.map((thread) => thread.id === threadId ? { ...thread, ...changes } : thread),
  }));
  render({ preserveScroll: true });
}

async function archiveThread(thread) {
  await changeThread(thread.id, { archived: !thread.archived });
  if (!thread.archived && state.activeId === thread.id) await startThread();
}

async function changeProject(projectId, changes) {
  await updateWorkspace((latest) => ({
    ...latest,
    projects: latest.projects.map((project) => project.id === projectId ? { ...project, ...changes } : project),
    threads: changes.hidden ? latest.threads.map((thread) =>
      thread.projectId === projectId ? { ...thread, detached: true } : thread) : latest.threads,
  }));
  render({ preserveScroll: true });
}

function editProject(project) {
  projectForm(project, async (name) => {
    if (project) {
      await changeProject(project.id, { name });
      closeDialog();
      return;
    }
    const created = { id: crypto.randomUUID(), name };
    await updateWorkspace((latest) => ({ ...latest, projects: [...latest.projects, created] }));
    closeDialog();
    await startInProject(created);
  });
}

function organizeHome(group) {
  const key = group === 'projects' ? 'project' : 'recent';
  const threads = state.threads.filter(({ archived, deleted }) => !archived && !deleted);
  organizeSidebar(threads, state.preferences[`${key}ManualOrder`], async (order) => {
    await updateWorkspace((latest) => ({
      ...latest,
      preferences: { ...latest.preferences, [`${key}ManualOrder`]: order, [`${key}ChatOrder`]: 'manual' },
    }));
    homeSidebar.render();
    closeDialog();
  });
}

function renameThread(thread) {
  threadNameForm(thread, (title) => changeThread(thread.id, { title }));
}

function settingsDialog() {
  settingsForm(state.preferences.effort, (effort) => setPreference('effort', effort), () => searchDialog(true));
}

function openThreadOptions() {
  const thread = activeThread();
  const options = [{ label: '新聊天', select: startThread }];
  if (thread && !temporaryThread) options.unshift(
    { label: '重命名', select: () => renameThread(thread) },
    { label: thread.pinned ? '取消置顶' : '置顶', select: () => changeThread(thread.id, { pinned: !thread.pinned }) },
    { label: '复制聊天标题', select: () => copyText(thread.title) },
    { label: thread.archived ? '恢复聊天' : '归档聊天', select: () => archiveThread(thread) },
  );
  openMenu(byId('thread-options'), options);
}

async function setPreference(name, value) {
  await updateWorkspace((latest) => ({
    ...latest, preferences: { ...latest.preferences, [name]: value },
  }));
  if (name.startsWith('projectChat') || name.startsWith('recent')) homeSidebar.render();
  renderComposer();
}

function showThreadSummary() {
  const thread = activeThread();
  if (!thread?.messages.length) {
    showInformation('摘要', '暂无会话消息。');
    return;
  }

  const summary = element('dl', 'thread-summary');
  const latestRequest = thread.messages.findLast(({ role }) => role === 'user');
  const latestReply = thread.messages.findLast(({ role }) => role === 'assistant');
  const fields = [
    ['会话名称', thread.title],
    ['消息数', String(thread.messages.length)],
    ['最近提问', latestRequest?.text],
    ['最近回复', latestReply?.text],
  ];
  fields.forEach(([label, text]) => {
    if (!text) return;
    const field = element('div');
    field.append(element('dt', '', label), element('dd', '', text));
    summary.append(field);
  });
  showDialog('摘要', summary);
}

function renderSidePanel() {
  const thread = activeThread();
  const files = thread?.messages.flatMap(({ attachments }) => attachments ?? []) ?? [];
  const content = byId('side-panel-body');
  const list = element('ul');
  list.append(...files.map(({ name }) => element('li', '', name)));
  content.replaceChildren(
    element('p', '', state.projects.find(({ id }) => id === state.projectId).name),
    element('p', 'dialog-empty', files.length ? '会话附件' : '暂无会话附件'),
    list,
  );
}

function setSidePanel(open) {
  if (open && mobileSidebar) setMobileSidebar(false);
  byId('side-panel').hidden = !open;
  desktop.dataset.sidePanelOpen = String(open);
  byId('side-panel-toggle').setAttribute('aria-expanded', String(open));
  if (open) renderSidePanel();
}

function moveHistory(change) {
  const next = historyIndex + change;
  if (!history[next]) return;
  historyIndex = next;
  openLocation(history[next], false);
}

function openProjectPicker() {
  openMenu(byId('work-project'), getProjects().map((project) => ({
    label: project.name,
    active: chosenWorkProject?.id === project.id && state.projectId === project.id,
    select: async () => {
      const previousKey = draftKey();
      const nextKey = `new:${project.id}`;
      chosenWorkProject = project;
      await openLocation({ activeId: null, projectId: project.id });
      if (draftKey() !== nextKey) return;
      const pending = drafts.get(previousKey);
      if (previousKey !== nextKey && (pending?.text || pending?.attachments.length)) {
        const destination = drafts.get(nextKey);
        if (destination?.text || destination?.attachments.length) {
          notify('已恢复此项目的草稿。');
        } else {
          drafts.delete(previousKey);
          drafts.set(nextKey, pending);
          messageInput.value = pending.text;
          renderComposer();
        }
      }
      messageInput.focus();
    },
  })));
}

function showPlugins() {
  const list = element('div', 'dialog-results');
  const plugin = element('button', 'dialog-row', 'Shotproof');
  plugin.type = 'button';
  plugin.append(element('span', 'dialog-empty', '本地示例'));
  plugin.addEventListener('click', () => showInformation('Shotproof', '将截图转换成网页原型，并在本地进行视觉校验。'));
  list.append(plugin);
  showDialog('插件', list);
}

function openPermissionMenu() {
  openMenu(byId('add-attachment'), ['默认权限', '完全访问'].map((access) => ({
    label: access,
    active: state.preferences.access === access,
    select: async () => {
      await setPreference('access', access);
      notify(`权限已切换为${access}`);
    },
  })));
}

function bindClick(id, handler) {
  byId(id).addEventListener('click', handler);
}

function searchCurrentSection() {
  const section = currentSection();
  if (section?.focusSearch) section.focusSearch();
  else searchDialog();
}

bindClick('back', () => moveHistory(-1));
bindClick('forward', () => moveHistory(1));
bindClick('toolbar-new-thread', startThread);
bindClick('home', startThread);
bindClick('new-thread', startThread);
bindClick('recent-new-thread', startThread);
bindClick('search-thread', searchCurrentSection);
bindClick('section-filter', (event) => currentSection()?.openFilter?.(event.currentTarget));
bindClick('library-notifications', () => showInformation('通知', '暂无本地通知。'));
bindClick('thread-options', openThreadOptions);
bindClick('side-panel-toggle', () => setSidePanel(byId('side-panel').hidden));
bindClick('side-panel-close', () => { setSidePanel(false); byId('side-panel-toggle').focus(); });
bindClick('thread-summary', showThreadSummary);
bindClick('navigation-toggle', toggleSidebar);
bindClick('sidebar-collapse', toggleSidebar);
bindClick('navigation-scrim', () => setMobileSidebar(false, true));
smallWindow.addEventListener('change', () => setMobileSidebar(false));

bindClick('mode-chat', () => setPreference('mode', 'chat'));
bindClick('mode-work', () => setPreference('mode', 'work'));
bindClick('temporary-chat', toggleTemporaryChat);
bindClick('work-project', openProjectPicker);
bindClick('work-files', () => byId('attachment-picker').click());
bindClick('work-plugins', showPlugins);
bindClick('work-desktop', () => showInformation('打开桌面应用', '当前工作区在浏览器中预览。'));
document.querySelectorAll('.web-suggestion-card').forEach((card) => {
  card.addEventListener('click', () => {
    messageInput.value = card.dataset.prompt;
    updateDraft({ text: messageInput.value });
    updateComposerControls(messageInput.value, draft().attachments);
    messageInput.focus();
  });
});

bindClick('model', () => openMenu(byId('model'), [
  { label: state.preferences.model, active: true, select: settingsDialog },
  ...['轻度', '低', '中', '高', '超高'].map((effort) => ({
    label: `推理强度 · ${effort}`,
    active: state.preferences.effort === effort,
    select: () => setPreference('effort', effort),
  })),
]));
bindClick('add-attachment', () => openMenu(byId('add-attachment'), [
  { label: '上传文件', select: () => byId('attachment-picker').click() },
  { label: '权限', select: openPermissionMenu },
]));
bindClick('voice', () => showInformation('语音', '本地复刻未连接语音服务。'));
bindClick('dictation', () => showInformation('听写', '本地复刻未连接听写服务。'));

bindClick('product-menu', startThread);
bindClick('profile', () => openMenu(byId('profile'), [
  { label: '本地工作区', disabled: true },
  { label: '个性化', select: () => showInformation('个性化', '当前使用原型的默认外观。') },
  { label: '个人资料', select: () => showInformation('个人资料', '本地工作区') },
  { label: '设置', select: settingsDialog },
  { label: '帮助', submenu: [{ label: '关于此原型', select: () => showInformation('帮助', '此工作区在本地浏览器运行。') }] },
  { label: '退出登录', select: () => showInformation('退出登录', '本地原型无需登录。') },
]));
bindClick('more', explore.toggle);
bindClick('usage', () => openMenu(byId('usage'), [
  { label: '每周限额', disabled: true },
  { label: '额度', disabled: true },
  { label: '管理用量', select: () => showInformation('管理用量', '本地会话没有模型用量。') },
]));
Object.keys(createSection).forEach((section) => {
  bindClick(section, () => openLocation({ ...location(), section }));
});
[
  ['dot', 'Dot', '本地原型未连接 Dot。'],
].forEach(([id, title, text]) => bindClick(id, () => showInformation(title, text)));

byId('attachment-picker').addEventListener('change', (event) => {
  const previous = draft().attachments;
  const next = Array.from(event.currentTarget.files, ({ name }) => ({ name }));
  updateDraft({ attachments: [...previous, ...next].slice(0, 8) });
  if (previous.length + next.length > 8) notify('每条消息最多附加 8 个文件。');
  event.currentTarget.value = '';
  renderComposer();
});
messageInput.addEventListener('input', () => {
  updateDraft({ text: messageInput.value });
  updateComposerControls(messageInput.value, draft().attachments);
});
messageInput.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Tab' && !event.shiftKey && !byId('suggestion').hidden) {
    event.preventDefault();
    messageInput.value = byId('suggestion-text').textContent;
    updateDraft({ text: messageInput.value });
    renderComposer();
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});
composer.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(); });

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && mobileSidebar && !byId('workspace-dialog').open && !event.defaultPrevented) {
    setMobileSidebar(false, true);
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchCurrentSection();
  }
});
window.addEventListener('storage', (event) => {
  if (event.key !== storageKey || storage !== event.storageArea) return;
  const previous = activeThread();
  const { threads, projects: savedProjects, preferences } = loadWorkspace(storage, state);
  const merged = { ...state, threads, projects: savedProjects, preferences };
  state = { ...merged, ...resolveLocation(merged, state) };
  homeSidebar.render();
  if (JSON.stringify(previous) !== JSON.stringify(activeThread())) {
    renderConversation({ preserveScroll: true });
    if (!byId('side-panel').hidden) renderSidePanel();
  }
  renderComposer();
});

populateIcons();
syncNavigation();
render();
