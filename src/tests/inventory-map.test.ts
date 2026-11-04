import { describe, it, expect, vi, beforeEach } from "vitest";

function makeMap() {
  return { setView: vi.fn(() => map), addLayer: vi.fn(), fitBounds: vi.fn() };
}
let map: ReturnType<typeof makeMap>;
let tileLayer: { addTo: ReturnType<typeof vi.fn> };
let cluster: { addLayer: ReturnType<typeof vi.fn>; zoomToShowLayer: ReturnType<typeof vi.fn> };
let iconCreateFunction: (c: any) => any;
const markerInstances: any[] = [];

function setup(markers: unknown[], search = "") {
  vi.resetModules();
  markerInstances.length = 0;
  map = makeMap();
  tileLayer = { addTo: vi.fn() };
  cluster = { addLayer: vi.fn(), zoomToShowLayer: vi.fn() };

  vi.doMock("leaflet", () => {
    const L: any = {
      map: vi.fn(() => map),
      tileLayer: vi.fn(() => tileLayer),
      divIcon: vi.fn((opts: any) => ({ divIcon: true, ...opts })),
      marker: vi.fn((latlng: [number, number], options: any) => {
        const m = {
          latlng, options,
          bindTooltip: vi.fn(() => m),
          bindPopup: vi.fn(() => m),
          getLatLng: vi.fn(() => ({ lat: latlng[0], lng: latlng[1] })),
        };
        markerInstances.push(m);
        return m;
      }),
      latLngBounds: vi.fn((pts: unknown) => ({ bounds: pts })),
      markerClusterGroup: vi.fn((opts: any) => {
        iconCreateFunction = opts.iconCreateFunction;
        return cluster;
      }),
    };
    return { default: L };
  });
  vi.doMock("leaflet.markercluster", () => ({}));

  vi.stubGlobal("document", { getElementById: vi.fn(() => ({ dataset: { markers: JSON.stringify(markers) } })) });
  vi.stubGlobal("location", { search });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("browser inventory map", () => {
  it("adds a marker per item with coloured pin, sign and popup, clusters them and fits bounds", async () => {
    setup([
      { id: "a", name: "Pumpe", lat: 1, lng: 2, status: "overdue", icon: "<svg/>", popup: "<div>a</div>" },
      { id: "b", name: "Helm", lat: 3, lng: 4, status: "none", icon: "<svg/>", popup: "<div>b</div>" },
    ]);
    await import("../browser/inventory-map.js");

    expect(markerInstances).toHaveLength(2);
    const [a, b] = markerInstances;
    expect(a.options.icon.html).toContain("⚠");
    expect(a.options.icon.html).toContain("var(--color-error)");
    expect(b.options.icon.html).not.toContain("<span class=\"absolute -right-1");
    expect(a.bindTooltip).toHaveBeenCalledWith("Pumpe");
    expect(a.bindPopup).toHaveBeenCalledWith("<div>a</div>", { minWidth: 220 });
    expect(cluster.addLayer).toHaveBeenCalledTimes(2);
    expect(map.addLayer).toHaveBeenCalledWith(cluster);
    expect(map.fitBounds).toHaveBeenCalledWith({ bounds: [[1, 2], [3, 4]] }, { padding: [30, 30] });
  });

  it("picks the worst child status for the cluster icon", () => {
    const child = (status: string) => ({ options: { status } });
    const result = iconCreateFunction({
      getAllChildMarkers: () => [child("ok"), child("overdue"), child("soon")],
      getChildCount: () => 3,
    });
    expect(result.html).toContain("var(--color-error)");
    expect(result.html).toContain(">3<");
  });

  it("centers on the single marker when there is exactly one", async () => {
    setup([{ id: "a", name: "Pumpe", lat: 1, lng: 2, status: "ok", icon: "", popup: "" }]);
    await import("../browser/inventory-map.js");
    expect(map.setView).toHaveBeenCalledWith([1, 2], 17);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("opens the popup of the ?focus marker via spiderfy", async () => {
    setup([
      { id: "a", name: "Pumpe", lat: 1, lng: 2, status: "ok", icon: "", popup: "" },
      { id: "b", name: "Helm", lat: 3, lng: 4, status: "ok", icon: "", popup: "" },
    ], "?focus=b");
    await import("../browser/inventory-map.js");
    expect(map.setView).toHaveBeenCalledWith({ lat: 3, lng: 4 }, 17);
    expect(cluster.zoomToShowLayer).toHaveBeenCalledTimes(1);
    const openPopup = markerInstances[1].openPopup = vi.fn();
    cluster.zoomToShowLayer.mock.calls[0][1]();
    expect(openPopup).toHaveBeenCalled();
  });
});
