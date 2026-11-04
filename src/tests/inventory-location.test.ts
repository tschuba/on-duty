import { describe, it, expect, vi, beforeEach } from "vitest";

type Handler = (e?: any) => void;
let handlers: Record<string, Handler>;
let apply: any, input: any, status: any, picker: any, form: any;
let map: any, marker: any, circle: any, lastControl: any;
let geo: { getCurrentPosition: ReturnType<typeof vi.fn> } | undefined;

async function setup(value = "") {
  vi.resetModules();
  handlers = {};
  const classes = new Set(["hidden"]);
  apply = { disabled: true, addEventListener: (_: string, h: Handler) => (handlers.apply = h) };
  status = { textContent: "" };
  form = { addEventListener: (_: string, h: Handler) => (handlers.reset = h) };
  input = { value, form, addEventListener: (_: string, h: Handler) => (handlers.change = h), dispatchEvent: vi.fn() };
  picker = {
    dataset: { attribution: "© OSM", geoError: "geo failed", locateLabel: "Locate" },
    classList: { remove: (c: string) => classes.delete(c), add: (c: string) => classes.add(c) },
    querySelector: (s: string) => (s.includes("status") ? status : s.includes("apply") ? apply : { innerHTML: "<svg/>" }),
  };
  map = {
    setView: vi.fn(() => map), getZoom: () => 6, invalidateSize: vi.fn(),
    on: vi.fn((ev: string, h: Handler) => (handlers[`map:${ev}`] = h)),
  };
  marker = { setLatLng: vi.fn(), remove: vi.fn(), addTo: vi.fn(() => marker), on: vi.fn((_: string, h: Handler) => (handlers.dragend = h)), getLatLng: () => ({ lat: 1, lng: 2 }) };
  circle = { remove: vi.fn(), addTo: vi.fn(() => circle) };
  vi.doMock("leaflet", () => {
    const L: any = {
      map: vi.fn(() => map),
      tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
      divIcon: vi.fn((o: any) => o),
      marker: vi.fn(() => marker),
      circle: vi.fn(() => circle),
      latLng: (lat: number, lng: number) => ({ lat, lng }),
      Control: { extend: (def: any) => function (this: any) { this.addTo = () => { lastControl = def.onAdd(); }; } },
      DomUtil: { create: () => { const b: any = { addEventListener: (_: string, h: Handler) => (handlers.locate = h) }; return b; } },
      DomEvent: { disableClickPropagation: vi.fn() },
    };
    return { default: L };
  });
  vi.stubGlobal("document", { getElementById: (id: string) => (id === "location-picker" ? picker : id === "coordinates" ? input : {}) });
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  geo = { getCurrentPosition: vi.fn() };
  vi.stubGlobal("navigator", { geolocation: geo });
  vi.stubGlobal("Event", class { constructor(public type: string) {} });
  await import("../browser/inventory-location.js");
}

beforeEach(() => vi.unstubAllGlobals());

describe("browser inventory location picker", () => {
  it("shows the picker, a marker for existing coordinates and an empty map otherwise", async () => {
    await setup("48.1, 11.5");
    expect(marker.addTo).toHaveBeenCalled();
    expect(map.setView).toHaveBeenLastCalledWith({ lat: 48.1, lng: 11.5 }, 17);
    await setup("");
    expect(marker.addTo).not.toHaveBeenCalled();
    expect(map.setView).toHaveBeenLastCalledWith([51.1657, 10.4515], 6);
  });

  it("picks a point by click, normalises wrapped longitude and applies it to the field", async () => {
    await setup("");
    handlers["map:click"]({ latlng: { lat: 10, lng: 190 } });
    expect(apply.disabled).toBe(false);
    handlers.apply();
    expect(input.value).toBe("10.000000, -170.000000");
    expect(input.dispatchEvent).toHaveBeenCalled();
    expect(apply.disabled).toBe(true);
  });

  it("apply without a pending point and marker drag", async () => {
    await setup("");
    handlers.apply();
    expect(input.value).toBe("");
    handlers["map:click"]({ latlng: { lat: 1, lng: 2 } });
    handlers.dragend();
    expect(marker.setLatLng).toHaveBeenCalled();
  });

  it("follows manual field edits and invalid input removes the marker", async () => {
    await setup("48.1, 11.5");
    input.value = "junk";
    handlers.change();
    expect(marker.remove).toHaveBeenCalled();
  });

  it("locate: shows accuracy circle on success, error text on failure or missing geolocation", async () => {
    await setup("");
    expect(lastControl.title).toBe("Locate");
    handlers.locate();
    geo!.getCurrentPosition.mock.calls[0][0]({ coords: { latitude: 5, longitude: 6, accuracy: 30 } });
    expect(circle.addTo).toHaveBeenCalled();
    expect(map.setView).toHaveBeenLastCalledWith({ lat: 5, lng: 6 }, 17);
    geo!.getCurrentPosition.mock.calls[0][1]();
    expect(status.textContent).toBe("geo failed");
    vi.stubGlobal("navigator", {});
    handlers.locate();
    expect(status.textContent).toBe("geo failed");
  });

  it("form reset clears the status and re-reads the field", async () => {
    vi.useFakeTimers();
    await setup("");
    status.textContent = "x";
    handlers.reset();
    vi.runAllTimers();
    vi.useRealTimers();
    expect(status.textContent).toBe("");
  });
});
