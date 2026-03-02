
import { initEditor, getContent, setContent } from './assets/editor/editor.js';

let currentPageId = 1;

window.onload = () => {
  initEditor('editor');
  loadPage(1);
};

async function loadSpaces() {
  const res = await fetch('/api/spaces');
  const data = await res.json();
  const list = document.getElementById('spaces');
  list.innerHTML = '';
  data.forEach(s => {
    const li = document.createElement('li');
    li.innerText = s.name;
    list.appendChild(li);
  });
}

async function loadPage(id) {
  const res = await fetch('/api/pages?id='+id);
  const page = await res.json();
  document.getElementById('pageTitle').innerText = page?.title || "Sample Page";
  setContent('editor', page?.body || "");
}

window.savePage = async function() {
  const body = getContent('editor');
  await fetch('/api/pages', {
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({id:currentPageId, body})
  });
};
