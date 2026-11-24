const $=s=>document.querySelector(s);
const storeKey='codex-replica-v2';let state;try{state=JSON.parse(localStorage.getItem(storeKey))}catch{}state ||= {chats:[],theme:'light',project:'agent-server'};let active=null;const welcome=$('#welcome').outerHTML;const save=()=>localStorage.setItem(storeKey,JSON.stringify(state));
function renderList(query=''){const root=$('#threads');root.replaceChildren();state.chats.filter(c=>c.title.toLowerCase().includes(query.toLowerCase())).forEach(c=>{let b=document.createElement('button');b.textContent=c.title;b.title=c.title;b.classList.toggle('active',c.id===active);b.onclick=()=>openChat(c.id);root.append(b)})}
function message(m){const d=document.createElement('div');d.className='message '+m.role;const label=document.createElement('small');label.textContent=m.role==='user'?'你':'Codex · 演示';const text=document.createElement('div');text.textContent=m.text;d.append(label,text);$('#stage').append(d)}
function openChat(id){rememberView(()=>openChat(id));active=id;const c=state.chats.find(c=>c.id===id);$('#stage').replaceChildren();$('#title').textContent=c.title;c.messages.forEach(message);renderList();$('#stage').scrollTop=$('#stage').scrollHeight}
function newChat(){rememberView(newChat);selectSection('Codex');active=null;$('#stage').innerHTML=welcome;$('#title').textContent='新建聊天';$('#input').value='';renderList();bindSuggestions();project()}
function bindSuggestions(){document.querySelectorAll('.suggestions button').forEach(b=>b.onclick=()=>{$('#input').value=b.textContent.slice(1).trim();$('#input').focus()})}
function applyTheme(){document.body.classList.toggle('dark',state.theme==='dark')}applyTheme();
$('#theme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';save();applyTheme()};$('#new').onclick=newChat;
$('#toggle').onclick=()=>document.body.classList.toggle('sidebar-hidden');
function selectSection(name){$('#section-name').textContent=name;document.querySelectorAll('.app-rail nav button').forEach(b=>b.classList.toggle('rail-current',name==='Codex'?b.dataset.section==='home':b.dataset.view===name))}
document.querySelectorAll('[data-section=home]').forEach(b=>b.onclick=newChat);
$('#attach').onclick=()=>$('#file').click();$('#file').onchange=()=>{const file=$('#file').files[0];if(file)$('#input').value+=' @'+file.name};
$('#search').onclick=()=>{let box=$('#chat-search');if(!box){box=document.createElement('input');box.id='chat-search';box.placeholder='搜索聊天…';box.setAttribute('aria-label','搜索聊天');$('#threads').before(box);box.oninput=()=>renderList(box.value)}box.focus()};
$('#add').onclick=()=>{const name=prompt('项目名称',state.project);if(name?.trim()){state.project=name.trim();save();project()}};function project(){$('aside .workspace').textContent='⌄　▱　'+state.project;$('#info-project').textContent=state.project;$('#composer-project').textContent='▱ '+state.project;const name=$('#welcome-project');if(name)name.textContent=state.project}project();
function panel(title,description,controls){rememberView(()=>panel(title,description,controls));active=null;$('#title').textContent=title;$('#stage').replaceChildren();const d=document.createElement('section');d.className='panel';const h=document.createElement('h1');h.textContent=title;const p=document.createElement('p');p.textContent=description;d.append(h,p);if(controls)d.append(controls);$('#stage').append(d);renderList()}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{const v=b.dataset.view;selectSection(v);if(v==='设置'){const button=document.createElement('button');button.className='project';button.textContent='切换浅色 / 深色';button.onclick=()=>$('#theme').click();panel(v,'外观设置保存在当前浏览器中。',button)}else if(v==='定时任务'){panel(v,'暂无自动化任务。此界面演示尚未连接任务调度服务。')}else if(v==='技能'){panel(v,'REA · Reverse Engineer Anything\n界面分析与重建工作流。此演示不执行本机工具。')}else if(v==='探索你的下一个想法')newChat();else panel(v,v==='项目'?'当前项目：'+state.project:'此模块尚未连接服务。')});
$('#open').onclick=()=>{panel('项目','当前项目：'+state.project+'。此独立原型尚未连接本地编辑器。')};
$('#form').onsubmit=e=>{e.preventDefault();const text=$('#input').value.trim();if(!text)return;if(!active){const c={id:crypto.randomUUID(),title:text.slice(0,40),messages:[]};state.chats.unshift(c);active=c.id}const c=state.chats.find(c=>c.id===active);c.messages.push({role:'user',text});c.messages.push({role:'assistant',text:'已收到你的任务。\n\n这是界面交互演示，尚未接入模型或本地执行服务。你的消息与会话已保存在当前浏览器。'});save();openChat(active);$('#input').value='';$('#input').focus()};$('#input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#form').requestSubmit()}};document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='n'){e.preventDefault();newChat()}});renderList();bindSuggestions();

// Navigation stays within this workspace rather than leaving the local page.
const viewHistory=[newChat];let viewIndex=0;let replayingView=false;
function rememberView(render){if(replayingView)return;viewHistory.splice(viewIndex+1);viewHistory.push(render);viewIndex=viewHistory.length-1;updateNavigation()}
function updateNavigation(){$('#nav-back').disabled=viewIndex===0;$('#nav-forward').disabled=viewIndex===viewHistory.length-1}
function navigateView(delta){const next=viewIndex+delta;if(next<0||next>=viewHistory.length)return;viewIndex=next;replayingView=true;try{viewHistory[viewIndex]()}finally{replayingView=false;updateNavigation()}}
$('#nav-back').onclick=()=>navigateView(-1);$('#nav-forward').onclick=()=>navigateView(1);updateNavigation();
$('#header-new').onclick=()=>{newChat();$('.header-more').open=false};
$('#header-list').onclick=()=>{document.body.classList.remove('sidebar-hidden');$('#search').click()};
$('#header-panel').onclick=()=>{const open=document.body.classList.toggle('info-open');$('#info-panel').classList.toggle('hidden',!open);$('#header-panel').setAttribute('aria-expanded',String(open))};
$('#header-panel').setAttribute('aria-expanded','false');
document.addEventListener('click',event=>{if(!event.target.closest('.header-more'))$('.header-more').open=false});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('.header-more').open=false;document.body.classList.remove('info-open');$('#info-panel').classList.add('hidden');$('#header-panel').setAttribute('aria-expanded','false')}});

const moreTrigger=$('#rail-more'), moreMenu=$('#rail-more-menu');
function positionMoreMenu(){const rect=moreTrigger.getBoundingClientRect();const top=Math.max(56,Math.min(rect.top,window.innerHeight-moreMenu.offsetHeight-12));moreMenu.style.setProperty('--more-top',top+'px')}
function closeMoreMenu(restoreFocus=false){moreMenu.classList.add('hidden');moreTrigger.setAttribute('aria-expanded','false');if(restoreFocus)moreTrigger.focus()}
function openMoreMenu(){moreMenu.classList.remove('hidden');moreTrigger.setAttribute('aria-expanded','true');positionMoreMenu()}
moreTrigger.onclick=()=>{if(moreTrigger.getAttribute('aria-expanded')==='true')closeMoreMenu();else openMoreMenu()};
moreTrigger.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();openMoreMenu();moreMenu.querySelector('button').focus()}};
moreMenu.addEventListener('click',event=>{if(event.target.closest('button'))closeMoreMenu()});
moreMenu.addEventListener('keydown',event=>{const items=[...moreMenu.querySelectorAll('button')];const index=items.indexOf(document.activeElement);let next;if(event.key==='ArrowDown')next=(index+1)%items.length;else if(event.key==='ArrowUp')next=(index-1+items.length)%items.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;if(next!==undefined){event.preventDefault();items[next].focus()}});
document.addEventListener('click',event=>{if(!moreMenu.contains(event.target)&&!moreTrigger.contains(event.target))closeMoreMenu()});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&moreTrigger.getAttribute('aria-expanded')==='true')closeMoreMenu(true)});
document.addEventListener('focusin',event=>{if(!moreMenu.contains(event.target)&&event.target!==moreTrigger)closeMoreMenu()});
window.addEventListener('resize',()=>{if(moreTrigger.getAttribute('aria-expanded')==='true')positionMoreMenu()});
