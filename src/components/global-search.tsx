import { t } from "../i18n/index.js";
import { Icon } from "./icon.js";

const hx = (target: string) => ({
  "hx-get": "/search", "hx-trigger": "input changed delay:250ms, focus", "hx-sync": "this:replace", "hx-target": target, "hx-swap": "innerHTML", name: "q",
});

// Kürzel (Strg/Cmd+K, /), Pfeiltasten und Enter. Unter 2 Zeichen keine Anfrage, nur Hinweis.
export const GLOBAL_SEARCH_SCRIPT = `(function(){
var lg=matchMedia("(min-width: 640px)"),dlg=document.getElementById("gs-dialog"),inputs=[document.getElementById("gs-input"),document.getElementById("gs-input-m")];
if(!dlg||!inputs[0])return;
if(/Mac|iPhone|iPad/.test(navigator.platform))document.querySelectorAll("[data-gs-mod]").forEach(function(k){k.textContent="\\u2318 K"});
var res=function(i){return document.getElementById(i.id==="gs-input"?"gs-results":"gs-results-m")};
inputs.forEach(function(i){
  i.addEventListener("keydown",function(e){
    var r=res(i),it=[].slice.call(r.querySelectorAll("[data-gs-item]")),cur=it.findIndex(function(a){return a.getAttribute("aria-selected")==="true"});
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){if(!it.length)return;e.preventDefault();var n=(cur+(e.key==="ArrowDown"?1:-1)+it.length)%it.length;it.forEach(function(a,k){a.setAttribute("aria-selected",k===n?"true":"false")});it[n].scrollIntoView({block:"nearest"})}
    else if(e.key==="Enter"&&it[cur]){e.preventDefault();it[cur].click()}
    else if(e.key==="Escape"&&i===inputs[0]){i.value="";r.innerHTML="";i.blur()}
  });
});
var toggle=function(){
  if(lg.matches){if(document.activeElement===inputs[0]){inputs[0].blur()}else inputs[0].focus()}
  else if(dlg.open)dlg.close();else{dlg.showModal();inputs[1].focus()}
};
window.openGlobalSearch=toggle;
dlg.addEventListener("close",function(){inputs[1].value="";document.getElementById("gs-results-m").innerHTML=""});
document.addEventListener("keydown",function(e){
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==="k"){e.preventDefault();toggle();return}
  if(e.key==="/"&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    var a=document.activeElement;
    if(a&&(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)||a.isContentEditable))return;
    e.preventDefault();if(lg.matches)inputs[0].focus();else toggle();
  }
});
})();`;

// Feld in der Navbar-Mitte (ab lg) plus Lupen-Button und Dialog darunter.
export function GlobalSearch() {
  return (
    <>
      <div class="group relative mx-auto hidden w-full min-w-0 max-w-64 sm:block lg:max-w-md">
        <label class="input input-sm flex w-full items-center gap-2">
          <Icon name="icon-[tabler--search]" class="h-4 w-4 opacity-60" />
          <input id="gs-input" type="search" class="grow" placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} autocomplete="off" data-hint={t("search.minChars")} {...hx("#gs-results")} />
          <kbd class="kbd kbd-xs max-lg:hidden">/</kbd><kbd class="kbd kbd-xs max-sm:hidden" data-gs-mod>Strg K</kbd>
        </label>
        <div id="gs-results" role="listbox" class="absolute inset-x-0 top-full z-50 mt-1 hidden max-h-96 overflow-auto rounded-box border border-base-300 bg-base-200 py-1 shadow group-focus-within:block empty:hidden!" />
      </div>
      <button type="button" class="btn btn-ghost btn-sm btn-square sm:hidden" aria-label={t("search.open")} title={t("search.open")} onclick="openGlobalSearch()">
        <Icon name="icon-[tabler--search]" class="h-5 w-5" />
      </button>
      <dialog id="gs-dialog" class="modal modal-top">
        <div class="modal-box p-2">
          <label class="input flex w-full items-center gap-2">
            <Icon name="icon-[tabler--search]" class="h-4 w-4 opacity-60" />
            <input id="gs-input-m" type="search" class="grow" placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} autocomplete="off" data-hint={t("search.minChars")} {...hx("#gs-results-m")} />
          </label>
          <div id="gs-results-m" role="listbox" class="mt-2 max-h-[60dvh] overflow-auto" />
        </div>
        <form method="dialog" class="modal-backdrop"><button type="submit" aria-label={t("common.cancel")} /></form>
      </dialog>
    </>
  );
}
