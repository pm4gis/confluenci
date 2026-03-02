import { initEditor, exec, getHTML, setHTML } from '/assets/editor.js';

const state = {
  user: null,
  spaces: [],
  currentSpace: null,
  pages: [],
  currentPage: null,
  versions: [],
  comments: [],
  tasks: [],
  reactions: [],
  notifications: [],
  searchResults: []
};

const EMOJIS = ['👍','❤️','🔥','🎉','👀'];

function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k === 'class') n.className = v;
    else if(k === 'html') n.innerHTML = v;
    else if(k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for(const c of children){
    if(typeof c === 'string') n.appendChild(document.createTextNode(c));
    else if(c) n.appendChild(c);
  }
  return n;
}

async function api(path, opts={}){
  const res = await fetch(path, { ...opts, headers: { 'Content-Type':'application/json', ...(opts.headers||{}) } });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if(!res.ok) throw new Error(data?.error || data || 'Request failed');
  return data;
}

async function apiForm(path, form){
  const res = await fetch(path, { method:'POST', body: form });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function render(){
  const root = document.getElementById('app');
  root.innerHTML = '';

  if(!state.user){
    root.appendChild(renderLogin());
    return;
  }

  root.appendChild(el('div', { class:'sidebar' }, [
    el('div', { class:'sideTop' }, [
      el('h1', {}, ['Firewall Wiki']),
      el('span', { class:'pill' }, [state.user.username]),
      el('button', { onclick: logout }, ['Logout'])
    ]),
    el('div', { class:'sideBody' }, [
      el('div', { class:'card' }, [
        el('div', { class:'rowWrap' }, [
          el('button', { onclick: () => createSpace() }, ['New space']),
          el('button', { onclick: () => loadAll() }, ['Refresh'])
        ]),
        el('div', { class:'small' }, ['Spaces'])
      ]),
      el('div', { class:'list' }, state.spaces.filter(s=>!s.archived).map(s => {
        const active = state.currentSpace && state.currentSpace.id === s.id;
        return el('div', { class:'item' + (active?' active':''), onclick: () => openSpace(s.id) }, [
          el('div', {}, [s.name]),
          el('div', { class:'small' }, [s.space_key])
        ]);
      })),
      state.currentSpace ? renderTree() : el('div', { class:'card small' }, ['Select a space'])
    ])
  ]));

  root.appendChild(el('div', { class:'main' }, [
    el('div', { class:'topbar' }, [
      el('input', { id:'searchBox', placeholder:'Search pages', value:'' }),
      el('button', { onclick: doSearch }, ['Search']),
      el('button', { onclick: () => loadNotifications() }, ['Notifications']),
      state.user.role === 'admin' ? el('button', { onclick: () => showAudit() }, ['Audit']) : null,
      state.currentSpace ? el('button', { onclick: () => exportSpace() }, ['Export']) : null,
      el('button', { onclick: () => importSpace() }, ['Import'])
    ]),
    el('div', { class:'content' }, [
      renderPageArea(),
      renderSidePanel()
    ])
  ]));
}

function renderLogin(){
  const u = el('input', { id:'u', placeholder:'Username', value:'admin' });
  const p = el('input', { id:'p', placeholder:'Password', type:'password', value:'admin' });
  const msg = el('div', { class:'small', id:'msg' }, ['First login uses admin/admin']);
  const box = el('div', { class:'card', style:'max-width:420px;margin:40px auto;' }, [
    el('h2', {}, ['Login']),
    el('div', { class:'small' }, ['This runs on Cloudflare Pages with D1 and optional R2.']),
    el('div', { style:'height:10px' }),
    u, p,
    el('button', { onclick: async () => {
      try{
        const data = await api('/api/auth', { method:'POST', body: JSON.stringify({ username:u.value, password:p.value }) });
        state.user = data.user;
        await loadAll();
      }catch(e){ msg.textContent = e.message; }
    } }, ['Login']),
    msg
  ]);
  return el('div', { style:'width:100%;display:block;padding:20px;' }, [box]);
}

function renderTree(){
  const pagesByParent = new Map();
  for(const p of state.pages){
    const key = p.parent_id || 0;
    if(!pagesByParent.has(key)) pagesByParent.set(key, []);
    pagesByParent.get(key).push(p);
  }
  for(const [k, arr] of pagesByParent) arr.sort((a,b)=> (a.sort_order-b.sort_order) || a.title.localeCompare(b.title));

  function nodeList(parentId, level){
    const arr = pagesByParent.get(parentId||0) || [];
    return el('div', { class: level ? 'indent' : 'tree' }, arr.map(p => {
      const active = state.currentPage && state.currentPage.id === p.id;
      const row = el('div', { class:'treeNode' + (active?' active':''), onclick: () => openPage(p.id) }, [
        el('span', { class:'k' }, ['•']),
        el('span', { class:'t' }, [p.title])
      ]);
      return el('div', {}, [row, nodeList(p.id, level+1)]);
    }));
  }

  return el('div', { class:'card' }, [
    el('div', { class:'rowWrap' }, [
      el('div', { class:'small' }, ['Pages']),
      el('button', { onclick: () => createPage() }, ['New page'])
    ]),
    nodeList(0, 0)
  ]);
}

function renderPageArea(){
  if(!state.currentPage){
    return el('div', { class:'page' }, [
      el('div', { class:'card' }, ['Select a page'])
    ]);
  }

  const titleInput = el('input', { id:'title', value: state.currentPage.title });
  titleInput.style.width = '100%';
  titleInput.style.background = 'var(--panel)';
  titleInput.style.border = '1px solid var(--border)';
  titleInput.style.color = 'var(--text)';
  titleInput.style.padding = '10px 12px';
  titleInput.style.borderRadius = '12px';

  const toolbar = el('div', { class:'editorToolbar' }, [
    el('button', { onclick: () => exec('bold') }, ['Bold']),
    el('button', { onclick: () => exec('italic') }, ['Italic']),
    el('button', { onclick: () => exec('insertUnorderedList') }, ['List']),
    el('button', { onclick: () => exec('formatBlock','H2') }, ['H2']),
    el('button', { onclick: () => exec('formatBlock','H3') }, ['H3']),
    el('button', { onclick: () => exec('insertHorizontalRule') }, ['Rule']),
    el('button', { onclick: () => exec('createLink', prompt('Link URL') || '') }, ['Link'])
  ]);

  const editor = el('div', { class:'editor', id:'editor' }, []);
  initEditor(editor);
  setHTML(editor, state.currentPage.body_html);

  const meta = el('div', { class:'small' }, [
    `Updated ${state.currentPage.updated_at || ''}`
  ]);

  const saveBtn = el('button', { onclick: async () => {
    await savePage(titleInput.value, getHTML(editor));
  } }, ['Save']);

  const delBtn = el('button', { onclick: async () => {
    if(confirm('Delete this page?')) await deletePage();
  } }, ['Delete']);

  const watchBtn = el('button', { onclick: async () => toggleWatch('page', state.currentPage.space_id, state.currentPage.id) }, ['Watch']);

  return el('div', { class:'page' }, [
    el('div', { class:'card' }, [
      titleInput,
      meta,
      el('div', { class:'editorWrap' }, [toolbar, editor]),
      el('div', { class:'rowWrap' }, [saveBtn, delBtn, watchBtn])
    ]),
    renderSearchResults()
  ]);
}

function renderSearchResults(){
  if(!state.searchResults.length) return el('div', {}, []);
  return el('div', { class:'card' }, [
    el('div', { class:'rowWrap' }, [
      el('strong', {}, ['Search results']),
      el('span', { class:'small' }, [String(state.searchResults.length)])
    ]),
    el('div', { class:'list' }, state.searchResults.map(r => el('div', { class:'item', onclick: ()=> openPage(r.page_id) }, [r.title])))
  ]);
}

function renderSidePanel(){
  const panel = el('div', { class:'panel' }, []);
  panel.appendChild(el('div', { class:'card' }, [
    el('div', { class:'rowWrap' }, [
      el('strong', {}, ['Reactions']),
      ...EMOJIS.map(em => el('button', { onclick: ()=> react(em) }, [em]))
    ]),
    el('div', { class:'small', id:'reactCounts' }, [''])
  ]));

  panel.appendChild(el('div', { class:'card' }, [
    el('div', { class:'rowWrap' }, [
      el('strong', {}, ['Tasks']),
      el('button', { onclick: ()=> addTask() }, ['Add'])
    ]),
    el('div', { id:'taskList', class:'list' }, [])
  ]));

  panel.appendChild(el('div', { class:'card' }, [
    el('div', { class:'rowWrap' }, [
      el('strong', {}, ['Comments']),
      el('button', { onclick: ()=> addComment() }, ['Add'])
    ]),
    el('div', { id:'commentList', class:'list' }, [])
  ]));

  panel.appendChild(el('div', { class:'card' }, [
    el('div', { class:'rowWrap' }, [
      el('strong', {}, ['Versions']),
      el('button', { onclick: ()=> loadVersions() }, ['Refresh'])
    ]),
    el('div', { id:'versionList', class:'list' }, [])
  ]));

  panel.appendChild(el('div', { class:'card' }, [
    el('div', { class:'rowWrap' }, [
      el('strong', {}, ['Attachments']),
      el('input', { id:'file', type:'file' })
    ]),
    el('button', { onclick: ()=> uploadAttachment() }, ['Upload']),
    el('div', { id:'attachList', class:'list' }, [])
  ]));

  // Populate if page open
  setTimeout(()=> refreshSide(), 0);
  return panel;
}

async function refreshSide(){
  if(!state.currentPage) return;

  await Promise.allSettled([loadReactions(), loadTasks(), loadComments(), loadVersions(), loadAttachments()]);
}

async function logout(){
  await api('/api/logout', { method:'POST', body:'{}' }).catch(()=>{});
  state.user = null;
  state.spaces = [];
  state.pages = [];
  state.currentSpace = null;
  state.currentPage = null;
  state.searchResults = [];
  render();
}

async function loadAll(){
  const who = await api('/api/auth');
  state.user = who.user;
  const s = await api('/api/spaces');
  state.spaces = s.spaces || [];
  if(!state.currentSpace && state.spaces.length) await openSpace(state.spaces[0].id);
  render();
}

async function openSpace(spaceId){
  const s = await api('/api/spaces');
  state.spaces = s.spaces || [];
  state.currentSpace = state.spaces.find(x=>x.id===spaceId) || null;

  const p = await api('/api/pages?space_id='+encodeURIComponent(spaceId));
  state.pages = p.pages || [];

  // Auto-open first page
  const first = state.pages.find(x=>!x.parent_id) || state.pages[0];
  if(first) await openPage(first.id);
  state.searchResults = [];
  render();
}

async function openPage(pageId){
  const d = await api('/api/pages?id='+encodeURIComponent(pageId));
  state.currentPage = d.page;
  state.searchResults = [];
  render();
  await refreshSide();
}

async function createSpace(){
  const space_key = prompt('Space key (letters only)') || '';
  const name = prompt('Space name') || '';
  if(!space_key.trim() || !name.trim()) return;
  await api('/api/spaces', { method:'POST', body: JSON.stringify({ space_key, name }) });
  await loadAll();
}

async function createPage(){
  if(!state.currentSpace) return;
  const title = prompt('Page title') || 'Untitled';
  const parent_id = state.currentPage ? state.currentPage.id : null;
  const r = await api('/api/pages', { method:'POST', body: JSON.stringify({ space_id: state.currentSpace.id, parent_id, title, body_html:'' }) });
  await openSpace(state.currentSpace.id);
  if(r.id) await openPage(r.id);
}

async function savePage(title, body_html){
  if(!state.currentPage) return;
  await api('/api/pages', { method:'PUT', body: JSON.stringify({ id: state.currentPage.id, title, body_html }) });
  await openPage(state.currentPage.id);
}

async function deletePage(){
  if(!state.currentPage) return;
  const id = state.currentPage.id;
  await api('/api/pages?id='+encodeURIComponent(id), { method:'DELETE' });
  await openSpace(state.currentSpace.id);
}

async function loadComments(){
  const d = await api('/api/comments?page_id='+encodeURIComponent(state.currentPage.id));
  state.comments = d.comments || [];
  const box = document.getElementById('commentList');
  if(!box) return;
  box.innerHTML = '';
  for(const c of state.comments){
    box.appendChild(el('div', { class:'item' }, [
      el('div', {}, [c.content]),
      el('div', { class:'small' }, [`${c.author_username} • ${c.created_at}`])
    ]));
  }
}

async function addComment(){
  if(!state.currentPage) return;
  const content = prompt('Comment') || '';
  if(!content.trim()) return;
  await api('/api/comments', { method:'POST', body: JSON.stringify({ page_id: state.currentPage.id, content }) });
  await loadComments();
}

async function loadReactions(){
  const d = await api('/api/reactions?page_id='+encodeURIComponent(state.currentPage.id));
  state.reactions = d.counts || [];
  const map = new Map();
  for(const r of state.reactions) map.set(r.emoji, r.count);
  const line = EMOJIS.map(e => `${e} ${(map.get(e)||0)}`).join('   ');
  const elc = document.getElementById('reactCounts');
  if(elc) elc.textContent = line;
}

async function react(emoji){
  if(!state.currentPage) return;
  await api('/api/reactions', { method:'POST', body: JSON.stringify({ page_id: state.currentPage.id, emoji }) });
  await loadReactions();
}

async function loadTasks(){
  const d = await api('/api/tasks?page_id='+encodeURIComponent(state.currentPage.id));
  state.tasks = d.tasks || [];
  const box = document.getElementById('taskList');
  if(!box) return;
  box.innerHTML = '';
  for(const t of state.tasks){
    const chk = el('input', { type:'checkbox' });
    chk.checked = !!t.completed;
    chk.addEventListener('change', async () => {
      await api('/api/tasks', { method:'PUT', body: JSON.stringify({ id: t.id, completed: chk.checked }) });
      await loadTasks();
    });
    box.appendChild(el('div', { class:'item' }, [
      el('div', { class:'row' }, [chk, el('div', {}, [t.description])]),
      el('div', { class:'small' }, [`${t.assigned_to || 'unassigned'} ${t.due_date ? '• '+t.due_date : ''}`])
    ]));
  }
}

async function addTask(){
  if(!state.currentPage) return;
  const description = prompt('Task description') || '';
  if(!description.trim()) return;
  const assigned_to = prompt('Assign to (username)') || '';
  const due_date = prompt('Due date (YYYY-MM-DD)') || '';
  await api('/api/tasks', { method:'POST', body: JSON.stringify({ page_id: state.currentPage.id, description, assigned_to, due_date }) });
  await loadTasks();
}

async function loadVersions(){
  if(!state.currentPage) return;
  const d = await api('/api/versions?page_id='+encodeURIComponent(state.currentPage.id));
  state.versions = d.versions || [];
  const box = document.getElementById('versionList');
  if(!box) return;
  box.innerHTML = '';
  for(const v of state.versions.slice(0,10)){
    box.appendChild(el('div', { class:'item', onclick: ()=> viewVersion(v.version_number) }, [
      el('div', {}, [`Version ${v.version_number}`]),
      el('div', { class:'small' }, [v.created_at])
    ]));
  }
}

async function viewVersion(version_number){
  const d = await api('/api/versions', { method:'POST', body: JSON.stringify({ page_id: state.currentPage.id, version_number }) });
  const v = d.version;
  if(!v) return;
  alert(`Version ${v.version_number} from ${v.created_at}`);
}

async function toggleWatch(scope, space_id, page_id){
  try{
    const q = scope === 'space' ? `scope=space&space_id=${space_id}` : `scope=page&page_id=${page_id}`;
    const existing = await api('/api/watch?'+q);
    if((existing.watches || []).length){
      await api('/api/watch?'+q, { method:'DELETE' });
      alert('Unwatched');
    }else{
      await api('/api/watch', { method:'POST', body: JSON.stringify({ scope, space_id, page_id }) });
      alert('Watching');
    }
  }catch(e){ alert(e.message); }
}

async function loadNotifications(){
  const d = await api('/api/notifications');
  state.notifications = d.notifications || [];
  const lines = state.notifications.slice(0,25).map(n => `${n.read ? '[read] ' : ''}${n.message}`).join('\n');
  alert(lines || 'No notifications');
}

async function doSearch(){
  const q = document.getElementById('searchBox')?.value || '';
  const d = await api('/api/search?q='+encodeURIComponent(q)+(state.currentSpace?`&space_id=${state.currentSpace.id}`:''));
  state.searchResults = d.results || [];
  render();
}

async function exportSpace(){
  const url = '/api/export?space_id='+encodeURIComponent(state.currentSpace.id);
  window.location.href = url;
}

async function importSpace(){
  const pick = document.createElement('input');
  pick.type = 'file';
  pick.accept = 'application/json';
  pick.onchange = async () => {
    const file = pick.files[0];
    if(!file) return;
    const text = await file.text();
    await api('/api/import', { method:'POST', body: text, headers:{'Content-Type':'application/json'} });
    await loadAll();
  };
  pick.click();
}

async function loadAttachments(){
  const d = await api('/api/attachments?page_id='+encodeURIComponent(state.currentPage.id));
  const box = document.getElementById('attachList');
  if(!box) return;
  box.innerHTML = '';
  for(const a of (d.attachments || [])){
    box.appendChild(el('div', { class:'item' }, [
      el('a', { href: '/api/attachments?download='+encodeURIComponent(a.r2_key) }, [a.filename]),
      el('div', { class:'small' }, [a.uploaded_at])
    ]));
  }
}

async function uploadAttachment(){
  const input = document.getElementById('file');
  const file = input?.files?.[0];
  if(!file) { alert('Choose a file'); return; }
  const form = new FormData();
  form.append('page_id', String(state.currentPage.id));
  form.append('file', file);
  await apiForm('/api/attachments', form);
  input.value = '';
  await loadAttachments();
}

async function showAudit(){
  const d = await api('/api/audit');
  const lines = (d.audit || []).slice(0,50).map(a => `${a.created_at} ${a.username} ${a.action} ${a.entity_type}:${a.entity_id}`).join('\n');
  alert(lines || 'No audit entries');
}

loadAll().catch(()=> render());
render();
