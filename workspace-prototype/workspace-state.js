export const projects = [
  { id: 'agent-server', name: 'agent-server' },
  { id: 'dsh-poc', name: 'dsh-poc' },
  { id: 'coa', name: 'coa-quality-order-backend' },
  { id: 'coding-agent', name: 'Coding Agent 闲聊' },
  { id: 'quality-kb', name: 'quality-kb' },
  { id: 'docs-workbench', name: '文档工作台' },
  { id: 'prototype-lab', name: '原型验证' },
];

export const referenceThreadId = 'install-shotproof';

const exampleThreads = [
  ['launch', '启动项目', 'agent-server'],
  ['vue', '使用 Vue 3 复刻 ChatGPT', 'coding-agent'],
  ['nav', '添加一级图标菜单', 'agent-server'],
  ['heading', '定位头部', 'agent-server'],
  ['instructions', '介绍工单系统自定义指令', 'coa'],
  ['greeting', 'Respond to greeting', 'coding-agent'],
  ['architecture', '输出工单系统当前技术架构图', 'coa'],
  ['quality-web', '确认车质网是否为官方网站', 'quality-kb'],
  ['quality-flow', '数据-质量安全流程', 'quality-kb'],
  ['mqe', '查找 MQE 的含义', 'quality-kb'],
  ['english', '新增英语构词法知识库', 'dsh-poc'],
];

export const initialThreads = [
  {
    id: referenceThreadId,
    title: '安装 shotproof',
    projectId: 'agent-server',
    messages: [
      { role: 'user', text: '安装 shotproof' },
      {
        role: 'assistant',
        text: '已在 Codex 安装并启用 Shotproof 0.4.3。本地测试通过了无头 Chromium 渲染和截图比对，SSIM 为 1.0000。',
        followup: '本次使用从上游下载的文件注册了本地插件源。下一轮对话上传截图后，输入「用 Shotproof 把这张截图转成 HTML」即可使用。',
        elapsed: '用时 5分钟 20秒',
        activity: ['确认插件来源', '安装 Shotproof 与 Chromium', '通过本地渲染与对比测试'],
        link: { title: '上游仓库' },
        highlight: ['Shotproof 0.4.3'],
      },
    ],
  },
  ...exampleThreads.map(([id, title, projectId]) => ({
    id, title, projectId, messages: [{ role: 'user', text: title }],
  })),
  {
    id: 'app-server-build',
    title: '整理 Codex App Server 构建步骤 (2)',
    projectId: 'agent-server',
    messages: [{ role: 'user', text: '整理 Codex App Server 构建步骤' }],
  },
];

export const storageKey = 'codex-desktop-replica-v1';
export const defaultPreferences = {
  access: '完全访问', model: 'GPT-6.2 Sol', effort: '轻度', mode: 'work',
  projectChatOrder: 'recent', recentChatOrder: 'recent', recentChatMode: 'all', recentProjectChats: 'true',
  projectManualOrder: '', recentManualOrder: '',
};
export const defaultLocation = { activeId: null, projectId: 'agent-server' };
const startingState = {
  ...defaultLocation,
  threads: initialThreads,
  projects,
  preferences: defaultPreferences,
};

export function resolveLocation(workspace, { activeId, projectId }) {
  const selected = workspace.threads.find(({ id, deleted }) => id === activeId && !deleted);
  const project = workspace.projects.find(({ id, hidden }) => id === projectId && !hidden)
    ?? workspace.projects.find(({ hidden }) => !hidden) ?? workspace.projects[0];
  return { activeId: selected?.id ?? null, projectId: selected?.projectId ?? project.id };
}

export function loadWorkspace(storage, fallback = startingState) {
  try {
    const saved = JSON.parse(storage?.getItem(storageKey) ?? 'null');
    if (!saved || !Array.isArray(saved.threads)) return fallback;
    const savedProjects = Array.isArray(saved.projects) ? saved.projects : projects;
    if (!savedProjects.length ||
        !savedProjects.every((project) => typeof project?.id === 'string' && typeof project.name === 'string') ||
        new Set(savedProjects.map(({ id }) => id)).size !== savedProjects.length) return fallback;
    const projectIds = new Set(savedProjects.map(({ id }) => id));
    if (!saved.threads.every((thread) => validThread(thread, projectIds))) return fallback;
    if (new Set(saved.threads.map(({ id }) => id)).size !== saved.threads.length) return fallback;
    const preferences = saved.preferences ?? {};
    return {
      ...saved,
      ...resolveLocation({ ...saved, projects: savedProjects }, saved),
      projects: savedProjects,
      preferences: Object.fromEntries(Object.entries(defaultPreferences).map(([name, value]) => [
        name, typeof preferences[name] === 'string' ? preferences[name] : value,
      ])),
    };
  } catch {
    return fallback;
  }
}

function validThread(thread, projectIds) {
  return thread && typeof thread.id === 'string' && typeof thread.title === 'string' &&
    projectIds.has(thread.projectId) && Array.isArray(thread.messages) &&
    thread.messages.every(validMessage);
}

function validMessage(message) {
  return message && ['user', 'assistant'].includes(message.role) && typeof message.text === 'string' &&
    (message.attachments === undefined || (Array.isArray(message.attachments) &&
      message.attachments.every((file) => typeof file?.name === 'string'))) &&
    (message.highlight === undefined || (Array.isArray(message.highlight) &&
      message.highlight.every((phrase) => typeof phrase === 'string'))) &&
    (message.followup === undefined || typeof message.followup === 'string') &&
    (message.link === undefined || typeof message.link?.title === 'string') &&
    (message.elapsed === undefined || (typeof message.elapsed === 'string' &&
      Array.isArray(message.activity) && message.activity.every((item) => typeof item === 'string')));
}

export function saveWorkspace(storage, workspace) {
  try {
    storage.setItem(storageKey, JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}

export function searchThreads(threads, query, { archived = false } = {}) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return threads.filter((thread) => {
    if (thread.deleted || Boolean(thread.archived) !== archived) return false;
    const content = [thread.title, ...thread.messages.map(({ text }) => text)].join(' ').toLowerCase();
    return terms.every((term) => content.includes(term));
  });
}

export function createTitle(text) {
  const firstLine = text.split('\n').find((line) => line.trim())?.trim() || '附件会话';
  const characters = Array.from(firstLine);
  return characters.length > 32 ? `${characters.slice(0, 32).join('')}…` : firstLine;
}

export function localReply(attachments) {
  const detail = attachments.length ? `已保留 ${attachments.length} 个附件的文件名。` : '';
  return { role: 'assistant', text: `本地演示：已保存这条消息。${detail}` };
}
