// Kartenseite /inventory/map: liest data-markers vom Kartenelement (Server rendert Popup-HTML und Icon-SVG mit).
import L from "leaflet";
import "leaflet.markercluster";
import { COLOR, pin, type Status } from "./pin.js";

declare module "leaflet" { interface MarkerCluster extends Marker { getAllChildMarkers(): Marker[]; getChildCount(): number } }

type Marker = { id: string; name: string; lat: number; lng: number; status: Status; icon: string; popup: string };

const RANK: Record<Status, number> = { none: 0, ok: 1, soon: 2, overdue: 3 };

const el = document.getElementById("inventory-map")!;
const markers: Marker[] = JSON.parse(el.dataset.markers ?? "[]");

const map = L.map(el, { zoomControl: true }).setView([51.1657, 10.4515], 6);
L.tileLayer("/tiles/{z}/{x}/{y}.png", { maxZoom: 19, attribution: el.dataset.attribution ?? "", referrerPolicy: "no-referrer" } as L.TileLayerOptions).addTo(map);

const cluster = (L as any).markerClusterGroup({
  disableClusteringAtZoom: 18,
  spiderfyOnMaxZoom: true,
  iconCreateFunction: (c: L.MarkerCluster) => {
    const worst = c.getAllChildMarkers().reduce<Status>((a: Status, ch: L.Marker) => (RANK[(ch.options as any).status as Status] > RANK[a] ? (ch.options as any).status : a), "none");
    return L.divIcon({
      className: "",
      iconSize: [40, 40],
      html: `<div class="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white text-sm font-bold text-white shadow" style="background:${COLOR[worst]}">${c.getChildCount()}</div>`,
    });
  },
});

const byId = new Map<string, L.Marker>();
for (const m of markers) {
  const marker = L.marker([m.lat, m.lng], { icon: pin(m.status, m.icon), title: "", keyboard: true, status: m.status } as L.MarkerOptions);
  marker.bindTooltip(m.name).bindPopup(m.popup, { minWidth: 220 });
  byId.set(m.id, marker);
  cluster.addLayer(marker);
}
map.addLayer(cluster);

const focus = new URLSearchParams(location.search).get("focus");
const target = focus ? byId.get(focus) : undefined;
if (target) {
  map.setView(target.getLatLng(), 17);
  cluster.zoomToShowLayer(target, () => target.openPopup());
} else if (markers.length === 1) map.setView([markers[0].lat, markers[0].lng], 17);
else if (markers.length > 1) map.fitBounds(L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number])), { padding: [30, 30] });
