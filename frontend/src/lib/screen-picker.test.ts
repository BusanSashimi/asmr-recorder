import { describe, expect, it, vi } from "vitest";
import { ScreenPickerController, sameDisplayGeometry } from "./screen-picker";
import type { DisplayInfo } from "./native-screen";

const display = (id: number, primary = false): DisplayInfo => ({ displayId: id, index: id,
  width: 2560, height: 1440, pointPixelScale: 2, isPrimary: primary });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function setup(displays = [display(2), display(1, true)]) {
  let counter = 0;
  const api = {
    list: vi.fn(async () => displays),
    capture: vi.fn<(display: DisplayInfo, dimension: number, current: () => boolean) => Promise<string>>(async () => `blob:${++counter}`),
    release: vi.fn(), visible: vi.fn(() => true),
  };
  const controller = new ScreenPickerController(api);
  return { controller, api };
}
const finished = async (controller: ScreenPickerController) => {
  await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
};

describe("screen picker resource and selection lifecycle", () => {
  it("sorts primary first, selects it, and captures sequentially at gallery size", async () => {
    const { controller, api } = setup();
    const first = deferred<string>();
    api.capture.mockImplementationOnce(() => first.promise);
    controller.open();
    await vi.waitFor(() => expect(api.capture).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot().selectedId).toBe(1);
    expect(api.capture.mock.calls[0][1]).toBe(480);
    first.resolve("blob:first");
    await finished(controller);
    expect(api.capture.mock.calls.map(call => call[0].displayId)).toEqual([1, 2]);
  });

  it("preserves selection by ID after reordering and revokes superseded URLs", async () => {
    const { controller, api } = setup();
    controller.open(); await finished(controller);
    controller.select(2);
    const previous = controller.getSnapshot().entries.map(e => e.url);
    api.list.mockResolvedValue([display(1, true), display(2)]);
    await controller.refresh();
    expect(controller.getSnapshot().selectedId).toBe(2);
    previous.forEach(url => expect(api.release).toHaveBeenCalledWith(url));
  });

  it("clears a disconnected selection rather than selecting a different screen", async () => {
    const { controller, api } = setup();
    controller.open(); await finished(controller);
    controller.select(2);
    api.list.mockResolvedValue([display(1, true)]);
    await controller.refresh();
    expect(controller.getSnapshot().selectedId).toBeNull();
  });

  it("rejects changed geometry before crop and distinguishes Retina scale", async () => {
    const { controller, api } = setup([display(1, true)]);
    controller.open(); await finished(controller);
    api.list.mockResolvedValue([{ ...display(1, true), pointPixelScale: 1 }]);
    await controller.continue();
    expect(controller.getSnapshot().phase).toBe("gallery");
    expect(controller.getSnapshot().selectedId).toBeNull();
    expect(controller.getSnapshot().error?.kind).toBe("geometryChanged");
    expect(sameDisplayGeometry(display(1), { ...display(1), pointPixelScale: 1 })).toBe(false);
  });

  it("releases late results after cancellation without starting more captures", async () => {
    const { controller, api } = setup();
    const pending = deferred<string>();
    api.capture.mockImplementationOnce(() => pending.promise);
    controller.open();
    await vi.waitFor(() => expect(api.capture).toHaveBeenCalledTimes(1));
    controller.close(); pending.resolve("blob:late");
    await vi.waitFor(() => expect(api.release).toHaveBeenCalledWith("blob:late"));
    expect(api.capture).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().entries).toEqual([]);
  });

  it("ignores an older refresh result without overwriting the current image", async () => {
    const { controller, api } = setup([display(1)]);
    const pending = deferred<string>();
    api.capture.mockImplementationOnce(() => pending.promise);
    controller.open();
    await vi.waitFor(() => expect(api.capture).toHaveBeenCalledTimes(1));
    await controller.refresh();
    const current = controller.getSnapshot().entries[0].url;
    pending.resolve("blob:stale");
    await vi.waitFor(() => expect(api.release).toHaveBeenCalledWith("blob:stale"));
    expect(controller.getSnapshot().entries[0].url).toBe(current);
  });

  it("shows the thumbnail during larger capture and keeps it on failure", async () => {
    const { controller, api } = setup([display(1)]);
    controller.open(); await finished(controller);
    const thumbnail = controller.getSnapshot().entries[0].url;
    api.capture.mockRejectedValueOnce(new Error("temporary failure"));
    await controller.continue();
    await vi.waitFor(() => expect(controller.getSnapshot().cropLoading).toBe(false));
    expect(controller.getSnapshot().phase).toBe("crop");
    expect(controller.getSnapshot().cropUrl).toBe(thumbnail);
    expect(api.capture.mock.calls.at(-1)?.[1]).toBe(1600);
    controller.close();
    expect(api.release.mock.calls.filter(([url]) => url === thumbnail)).toHaveLength(1);
  });

  it("stops further requests after permission denial or hiding", async () => {
    const { controller, api } = setup();
    api.capture.mockRejectedValueOnce({ kind: "permissionDenied", message: "Denied" });
    controller.open(); await finished(controller);
    expect(api.capture).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().error?.kind).toBe("permissionDenied");
    api.visible.mockReturnValue(false);
    await controller.refresh();
    expect(api.capture).toHaveBeenCalledTimes(1);
  });

  it("retains working previews when refresh fails", async () => {
    const { controller, api } = setup([display(1)]);
    controller.open(); await finished(controller);
    const previous = controller.getSnapshot().entries[0].url;
    api.capture.mockRejectedValueOnce(new Error("Transient failure"));
    await controller.refresh();
    expect(controller.getSnapshot().entries[0].url).toBe(previous);
    expect(api.release).not.toHaveBeenCalledWith(previous);
  });

  it("returns to gallery if final capture reports a removed display", async () => {
    const { controller } = setup([display(1)]);
    controller.open(); await finished(controller);
    await controller.continue();
    const success = await controller.confirm(async () => { throw { kind: "displayUnavailable", message: "Disconnected" }; });
    expect(success).toBe(false);
    expect(controller.getSnapshot().phase).toBe("gallery");
    expect(controller.getSnapshot().selectedId).toBeNull();
  });
});
