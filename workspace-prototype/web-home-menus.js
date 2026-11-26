import { openMenu } from './desktop-ui.js';

const ordering = [
  ['最近更新', 'recent'],
  ['手动排序', 'manual'],
];

const recentModes = [
  ['全部', 'all'],
  ['工作', 'work'],
  ['聊天', 'chat'],
];

export function createHomeMenus({
  getPreferences, setPreference, organize, getProjects, editProject, removeProject, changeProject,
  renameThread, changeThread, archiveThread, deleteThread, showInformation,
}) {
  function radioOptions(choices, key, fallback) {
    const current = getPreferences()[key] ?? fallback;
    return choices.map(([label, value]) => ({
      label,
      active: current === value,
      select: () => setPreference(key, value),
    }));
  }

  function openProjectOptions(anchor) {
    openMenu(anchor, [
      { label: '整理侧边栏', icon: 'sliders', select: () => organize('projects') },
      { label: '聊天排序方式', submenu: radioOptions(ordering, 'projectChatOrder', 'recent') },
    ]);
  }

  function openRecentOptions(anchor) {
    const includesProjectChats = getPreferences().recentProjectChats !== 'false';
    openMenu(anchor, [
      { label: '整理侧边栏', icon: 'sliders', select: () => organize('recent') },
      { label: '排序方式', submenu: radioOptions(ordering, 'recentChatOrder', 'recent') },
      {
        label: '显示',
        submenu: [
          ...radioOptions(recentModes, 'recentChatMode', 'all'),
          {
            label: '项目聊天',
            active: includesProjectChats,
            checkbox: true,
            select: () => setPreference('recentProjectChats', String(!includesProjectChats)),
          },
        ],
      },
    ]);
  }

  function openProjectRow(anchor, project) {
    openMenu(anchor, [
      {
        label: project.pinned ? '取消置顶项目' : '置顶项目',
        icon: 'pin',
        select: () => changeProject(project.id, { pinned: !project.pinned }),
      },
      { label: '项目设置', icon: 'sliders', select: () => editProject(project) },
      { label: '删除项目', disabled: project.isDefault === true, select: () => removeProject(project) },
    ]);
  }

  function openThreadRow(anchor, thread) {
    const destinations = getProjects()
      .filter((project) => thread.detached || project.id !== thread.projectId)
      .map((project) => ({
        label: project.name,
        icon: 'folder',
        select: () => changeThread(thread.id, { projectId: project.id, detached: false }),
      }));
    const options = [
      {
        label: thread.pinned ? '取消置顶' : '置顶',
        icon: 'pin',
        select: () => changeThread(thread.id, { pinned: !thread.pinned }),
      },
      { label: '重命名', icon: 'edit', select: () => renameThread(thread) },
      { label: '分享', select: () => showInformation('分享', '此聊天保存在当前浏览器。分享链接需要连接会话服务。') },
      { label: thread.locked ? '解锁' : '锁定', select: () => changeThread(thread.id, { locked: !thread.locked }) },
      { label: '移至项目', icon: 'folder', submenu: destinations, disabled: destinations.length === 0 },
    ];
    if (thread.projectId && !thread.detached) {
      options.push({ label: '从项目中移除', select: () => changeThread(thread.id, { detached: true }) });
    }
    options.push(
      { label: thread.archived ? '取消归档' : '归档', select: () => archiveThread(thread) },
      { label: '删除', select: () => deleteThread(thread) },
    );
    openMenu(anchor, options);
  }

  return { openProjectOptions, openRecentOptions, openProjectRow, openThreadRow };
}
