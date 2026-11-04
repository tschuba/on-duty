// Mini-Karte in der Detailansicht: nur Anzeige, kein Mausrad-Zoom (Seite soll scrollbar bleiben).
import L from "leaflet";
import { pin, type Status } from "./pin.js";

const el = document.getElementById("location-view-map")!;
const ll: L.LatLngTuple = [Number(el.dataset.lat), Number(el.dataset.lng)];
const map = L.map(el, { scrollWheelZoom: false }).setView(ll, 17);
L.tileLayer("/tiles/{z}/{x}/{y}.png", { maxZoom: 19, attribution: el.dataset.attribution ?? "", referrerPolicy: "no-referrer" } as L.TileLayerOptions).addTo(map);
L.marker(ll, { icon: pin((el.dataset.status ?? "none") as Status, el.dataset.icon ?? ""), keyboard: false }).addTo(map);
