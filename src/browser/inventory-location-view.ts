// Mini-Karte in der Detailansicht: nur Anzeige, kein Mausrad-Zoom (Seite soll scrollbar bleiben).
import L from "leaflet";

const el = document.getElementById("location-view-map")!;
const ll: L.LatLngTuple = [Number(el.dataset.lat), Number(el.dataset.lng)];
const map = L.map(el, { scrollWheelZoom: false }).setView(ll, 17);
L.tileLayer("/tiles/{z}/{x}/{y}.png", { maxZoom: 19, attribution: el.dataset.attribution ?? "", referrerPolicy: "no-referrer" } as L.TileLayerOptions).addTo(map);
// shortcut: neutraler Punkt statt Statusfarben-Pin (Karte B teilt das Symbol noch nicht), bei Bedarf Pin-Modul extrahieren.
L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map);
