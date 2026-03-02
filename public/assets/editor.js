export function initEditor(el){
  el.setAttribute('contenteditable','true');
}
export function exec(cmd, value=null){
  document.execCommand(cmd,false,value);
}
export function getHTML(el){ return el.innerHTML || ""; }
export function setHTML(el, html){ el.innerHTML = html || ""; }
