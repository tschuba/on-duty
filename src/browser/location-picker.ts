// Ortserfassung (Inventar, Termine): Karte, Standortabfrage und Koordinatenfeld bleiben synchron.
// Ohne JS bleibt das Textfeld; der Picker ist bis hierher ausgeblendet.
import L from "leaflet";
import { parseCoordinates } from "../lib/coordinates.js";

const picker = document.getElementById("location-picker")!;
const input = document.getElementById("coordinates") as HTMLInputElement;
const mapEl = document.getElementById("location-map")!;
const status = picker.querySelector<HTMLElement>("[data-role=status]")!;
const apply = picker.querySelector<HTMLButtonElement>("[data-act=apply]")!;
const GERMANY: L.LatLngTuple = [51.1657, 10.4515];

picker.classList.remove("hidden");
picker.classList.add("flex");

const map = L.map(mapEl).setView(GERMANY, 6);
L.tileLayer("/tiles/{z}/{x}/{y}.png", { maxZoom: 19, attribution: picker.dataset.attribution ?? "", referrerPolicy: "no-referrer" } as L.TileLayerOptions).addTo(map);

// Marker neutral in Primärfarbe; shortcut: einfacher Kreis statt Pin, bis Marker-Symbol (Karte B) geteilt wird.
const dot = () => L.divIcon({ className: "", iconSize: [20, 20], iconAnchor: [10, 10], html: '<div style="width:20px;height:20px;border-radius:50%;background:var(--color-primary);border:3px solid white;box-shadow:0 0 3px #0006"></div>' });
let marker: L.Marker | undefined;
let circle: L.Circle | undefined;
let pending: L.LatLng | undefined; // gewählter, noch nicht übernommener Punkt

const fmt = (ll: L.LatLng) => `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;

function setMarker(ll: L.LatLng, accuracy?: number) {
  if (marker) marker.setLatLng(ll);
  else {
    marker = L.marker(ll, { icon: dot(), draggable: true }).addTo(map);
    marker.on("dragend", () => choose(marker!.getLatLng()));
  }
  circle?.remove();
  circle = accuracy ? L.circle(ll, { radius: accuracy, color: "var(--color-primary)", weight: 1 }).addTo(map) : undefined;
}

function choose(ll: L.LatLng, accuracy?: number) {
  ll = L.latLng(ll.lat, ((ll.lng + 540) % 360) - 180); // Weltkopien der Karte auf -180…180 zurückführen
  pending = ll;
  setMarker(ll, accuracy);
  apply.disabled = false;
}

// Feld -> Karte
function showFromInput() {
  const c = parseCoordinates(input.value);
  pending = undefined;
  apply.disabled = true;
  circle?.remove();
  circle = undefined;
  if (c.latitude && !c.error) {
    const ll = L.latLng(Number(c.latitude), Number(c.longitude));
    setMarker(ll);
    map.setView(ll, Math.max(map.getZoom(), 17));
  } else {
    marker?.remove();
    marker = undefined;
  }
}

map.on("click", (e: L.LeafletMouseEvent) => choose(e.latlng));
input.addEventListener("change", showFromInput);

apply.addEventListener("click", () => {
  if (!pending) return;
  input.value = fmt(pending);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  showFromInput();
});
// Standortknopf als Karten-Steuerelement (Leaflet-Control, oben links unter dem Zoom).
const Locate = L.Control.extend({
  onAdd() {
    const b = L.DomUtil.create("button", "btn btn-square btn-sm bg-base-100 border-base-300 shadow") as HTMLButtonElement;
    b.type = "button";
    b.innerHTML = picker.querySelector("template")!.innerHTML;
    b.title = b.ariaLabel = picker.dataset.locateLabel ?? "";
    L.DomEvent.disableClickPropagation(b);
    b.addEventListener("click", locate);
    return b;
  },
});
new Locate({ position: "topleft" }).addTo(map);

function locate() {
  status.textContent = "";
  if (!navigator.geolocation) { status.textContent = picker.dataset.geoError ?? ""; return; }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const ll = L.latLng(p.coords.latitude, p.coords.longitude);
      choose(ll, p.coords.accuracy);
      map.setView(ll, 17);
    },
    () => { status.textContent = picker.dataset.geoError ?? ""; },
    { enableHighAccuracy: true, timeout: 15000 },
  );
}

// Verwerfen im Kopf setzt das Feld zurück, ohne change-Ereignis.
input.form?.addEventListener("reset", () => setTimeout(() => { status.textContent = ""; showFromInput(); }));
showFromInput();
if (!marker) map.setView(GERMANY, 6);
// Die Karte liegt in einer Sektion, die per Feld-Schalter ein-/ausgeblendet wird.
// Standortabfrage erst, wenn die Karte sichtbar ist (sonst Berechtigungsdialog aus versteckter Sektion), einmal pro Seitenaufruf.
// Nur zentrieren: kein Marker, nichts übernommen. Verworfen, sobald Marker gesetzt oder Karte vom Nutzer gezogen wurde.
let dragged = false;
let centered = false;
map.on("dragstart", () => { dragged = true; });
new ResizeObserver(() => {
  map.invalidateSize();
  if (centered || !mapEl.clientWidth) return;
  centered = true;
  if (marker || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => { if (!marker && !dragged) map.setView([p.coords.latitude, p.coords.longitude], 17); },
    () => {},
    { timeout: 15000 },
  );
}).observe(mapEl);
