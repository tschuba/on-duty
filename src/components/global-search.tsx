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
    else if(e.key==="Escape"&&i===inputs[0]){i.value="";delete i.dataset.gsPre;r.innerHTML="";i.blur();sync()}
  });
  i.addEventListener("input",function(){delete i.dataset.gsPre;if(ps&&ps.hasAttribute("data-client")&&ps.value&&i.value!==ps.value)go("");entry(i);sync()});
  i.addEventListener("focus",function(){entry(i)});
});
// Seitensuche: [data-page-search] (page-search.tsx) und Filterdialog [data-page-filter] (filter-dialog.tsx) der aktuellen Seite.
var pc=document.querySelector("[data-page-chip]"),ps=document.querySelector("[data-page-search]"),fd=document.querySelector("[data-page-filter]"),text=inputs[0].dataset.pageText;
var q=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};
function sync(){inputs.forEach(function(i){var c=i.closest("label").querySelector("[data-gs-chip]");if(c){c.classList.toggle("hidden",!pc);if(pc){c.href=pc.href;c.querySelector("[data-gs-chip-t]").textContent=pc.textContent}}var b=i.closest("label").querySelector("[data-gs-badge]");if(!b)return;var on=!!ps&&ps.value!==""&&i.value===ps.value;b.classList.toggle("hidden",!on);if(on)b.querySelector("[data-gs-badge-t]").textContent=ps.dataset.label})}
// Seiten ohne Formular (client) filtern selbst: nur ein input-Event auslösen.
function go(v){ps.value=v;if(!ps.hasAttribute("data-client"))ps.form.requestSubmit();else{ps.dispatchEvent(new Event("input",{bubbles:true}));if(dlg.open)dlg.close();else inputs[0].blur();sync()}}
function pre(i){i.value=ps?ps.value:"";if(i.value)i.dataset.gsPre=i.value;else delete i.dataset.gsPre}
function entry(i){
  var r=res(i);q("[data-gs-page]",r).forEach(function(a){a.remove()});
  var v=i.value.trim();if(!ps||!v||i.dataset.gsPre===v)return;
  q("[data-gs-item]",r).forEach(function(a){a.setAttribute("aria-selected","false")});
  var a=document.createElement("a");a.href="#";a.setAttribute("role","option");a.setAttribute("data-gs-item","");a.setAttribute("data-gs-page","");a.setAttribute("aria-selected","true");
  a.className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-300 aria-selected:bg-base-300";
  var ic=document.createElement("span");ic.className="icon-[tabler--search] h-5 w-5 shrink-0";
  var t=document.createElement("span");t.className="flex-1 truncate";t.textContent=text+": \u00ab"+v+"\u00bb";
  var l=document.createElement("span");l.className="text-sm opacity-60";l.textContent=ps.dataset.label;
  a.append(ic,t,l);r.insertBefore(a,r.firstChild);
}
// Vorbelegter Seitenbegriff löst keine globale Suche aus (Fokus-Trigger).
document.addEventListener("htmx:configRequest",function(e){var el=e.detail.elt;if(el.dataset&&el.dataset.gsPre!==undefined&&el.dataset.gsPre===el.value)e.preventDefault()});
document.addEventListener("htmx:afterSwap",function(e){inputs.forEach(function(i){if(e.detail.target===res(i))entry(i)})});
if(ps)inputs.forEach(pre);
sync();
if(pc||(ps&&ps.value))q("[data-gs-sbtn]").forEach(function(d){d.classList.add("btn-soft","btn-primary");d.querySelector("[data-gs-sdot]").classList.remove("hidden")});
if(fd){var n=+fd.dataset.count||0;q("[data-gs-filter]").forEach(function(b){b.classList.remove("hidden");b.classList.toggle("btn-ghost",!n);b.classList.toggle("btn-soft",n>0);b.classList.toggle("btn-primary",n>0);var c=b.querySelector("[data-gs-fcount]");c.textContent=n;c.classList.toggle("hidden",!n)})}
document.addEventListener("click",function(e){
  var a=e.target.closest("[data-gs-page]");
  if(a&&ps){e.preventDefault();go(inputs.filter(function(x){return res(x).contains(a)})[0].value.trim());return}
  if(ps&&e.target.closest("[data-gs-badge-x]")){e.preventDefault();inputs.forEach(function(x){x.value="";delete x.dataset.gsPre});go("");return}
  if(fd&&e.target.closest("[data-gs-filter]"))fd.showModal();
});
var toggle=function(){
  if(lg.matches){if(document.activeElement===inputs[0]){inputs[0].blur()}else inputs[0].focus()}
  else if(dlg.open)dlg.close();else{dlg.showModal();inputs[1].focus()}
};
window.openGlobalSearch=toggle;
dlg.addEventListener("close",function(){pre(inputs[1]);sync();document.getElementById("gs-results-m").innerHTML=""});
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
  const chip = (
    <a data-gs-chip class="badge badge-neutral badge-sm hidden max-w-28 gap-1" aria-label={t("search.pageReset")} title={t("search.pageReset")}>
      <span data-gs-chip-t class="truncate" /><Icon name="icon-[tabler--x]" class="h-3.5 w-3.5 shrink-0" />
    </a>
  );
  const badge = (
    <span data-gs-badge class="badge badge-primary badge-sm hidden max-w-32 gap-1 pr-0.5">
      <span data-gs-badge-t class="truncate" />
      <button type="button" data-gs-badge-x class="cursor-pointer" aria-label={t("search.pageReset")} title={t("search.pageReset")}><Icon name="icon-[tabler--x]" class="h-3.5 w-3.5" /></button>
    </span>
  );
  const filterBtn = (cls: string, label: boolean) => (
    <button type="button" data-gs-filter class={`btn btn-ghost btn-sm hidden ${label ? "" : "indicator "}${cls}`} aria-label={t("search.filter")} title={t("search.filter")}>
      <Icon name="icon-[tabler--filter]" class="h-4 w-4 shrink-0" />
      {label && <span class="max-lg:hidden">{t("search.filter")}</span>}
      <span data-gs-fcount class={`badge badge-primary badge-xs hidden ${label ? "" : "indicator-item"}`} />
    </button>
  );
  return (
    <>
      <div class="mx-auto hidden w-full min-w-0 max-w-72 items-center gap-2 sm:flex lg:max-w-xl">
        <div class="group relative min-w-0 flex-1">
          <label class="input input-sm flex w-full items-center gap-2">
            <Icon name="icon-[tabler--search]" class="h-4 w-4 opacity-60" />
            {chip}{badge}
            <input id="gs-input" type="search" class="grow" placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} autocomplete="off" data-hint={t("search.minChars")} data-page-text={t("search.thisPage")} {...hx("#gs-results")} />
            <kbd class="kbd kbd-xs max-lg:hidden">/</kbd><kbd class="kbd kbd-xs max-sm:hidden" data-gs-mod>Strg K</kbd>
          </label>
          <div id="gs-results" role="listbox" class="absolute inset-x-0 top-full z-50 mt-1 hidden max-h-96 overflow-auto rounded-box border border-base-300 bg-base-200 py-1 shadow group-focus-within:block empty:hidden!" />
        </div>
        {filterBtn("shrink-0 border-base-300 bg-base-200", true)}
      </div>
      <button type="button" class="btn btn-ghost btn-sm btn-square relative sm:hidden" data-gs-sbtn aria-label={t("search.open")} title={t("search.open")} onclick="openGlobalSearch()">
        <Icon name="icon-[tabler--search]" class="h-5 w-5" />
        <span data-gs-sdot class="absolute right-1 top-1 hidden size-2 rounded-full bg-primary ring-2 ring-base-100" />
      </button>
      {filterBtn("btn-square sm:hidden", false)}
      <dialog id="gs-dialog" class="modal modal-top">
        <div class="modal-box p-2">
          <label class="input flex w-full items-center gap-2">
            <Icon name="icon-[tabler--search]" class="h-4 w-4 opacity-60" />
            {chip}{badge}
            <input id="gs-input-m" type="search" class="grow" placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} autocomplete="off" data-hint={t("search.minChars")} {...hx("#gs-results-m")} />
          </label>
          <div id="gs-results-m" role="listbox" class="mt-2 max-h-[60dvh] overflow-auto" />
        </div>
        <form method="dialog" class="modal-backdrop"><button type="submit" aria-label={t("common.cancel")} /></form>
      </dialog>
    </>
  );
}
