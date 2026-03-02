
export function initEditor(id) {
  const el = document.getElementById(id);
  el.contentEditable = true;
}
export function getContent(id) {
  return document.getElementById(id).innerHTML;
}
export function setContent(id, html) {
  document.getElementById(id).innerHTML = html || "";
}
