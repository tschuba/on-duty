// Ortserfassung im Inventarformular: Karte, Standortabfrage und Koordinatenfeld bleiben synchron.
// Ohne JS bleibt das Textfeld; der Picker ist bis hierher ausgeblendet.
import L from "leaflet";
import { parseCoordinates } from "../lib/coordinates.js";

const picker = document.getElementById("location-picker")!;
const input = document.getElementById("coordinates") as HTMLInputElement;
const mapEl = document.getElementById("location-map")!;
const status = picker.querySelector<HTMLElement>("[data-role=status]")!;
const btn = (a: string) => picker.querySelector<HTMLButtonElement>(`[data-act=${a}]`)!;
const original = input.value;
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
  btn("apply").disabled = false;
}

// Feld -> Karte
function showFromInput() {
  const c = parseCoordinates(input.value);
  pending = undefined;
  btn("apply").disabled = true;
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

btn("apply").addEventListener("click", () => {
  if (!pending) return;
  input.value = fmt(pending);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  showFromInput();
});
btn("clear").addEventListener("click", () => {
  input.value = "";
  status.textContent = "";
  showFromInput();
});
btn("reset").addEventListener("click", () => {
  input.value = original;
  status.textContent = "";
  showFromInput();
});
btn("locate").addEventListener("click", () => {
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
});

showFromInput();
if (!marker) map.setView(GERMANY, 6);
// Die Karte liegt in einer Sektion, die per Feld-Schalter ein-/ausgeblendet wird.
new ResizeObserver(() => map.invalidateSize()).observe(mapEl);
