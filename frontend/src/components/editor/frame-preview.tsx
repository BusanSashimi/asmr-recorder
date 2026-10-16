import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const frames = new Map<string, ArrayBuffer>();
export function FramePreview({
  item,
  time,
  revision,
  label = "Media thumbnail",
  width = 160,
}: {
  item?: string;
  time: string;
  revision: string;
  label?: string;
  width?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const key = `${revision}:${item ?? "program"}:${time}:${width}`;
    const render = async () => {
      try {
        const raw =
          frames.get(key) ??
          (await invoke<ArrayBuffer>("editor_frame", {
            item,
            time,
            width,
            source: !!item,
          }));
        if (disposed || !canvas.current) return;
        const buffer =
          raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer;
        const header = new DataView(buffer);
        const w = header.getUint32(0, true),
          h = header.getUint32(4, true);
        if (8 + w * h * 4 !== buffer.byteLength) return;
        frames.set(key, buffer);
        if (frames.size > 32) frames.delete(frames.keys().next().value!);
        canvas.current.width = w;
        canvas.current.height = h;
        canvas.current
          .getContext("2d")
          ?.putImageData(
            new ImageData(new Uint8ClampedArray(buffer, 8), w, h),
            0,
            0,
          );
      } catch (e) {
        if (!disposed && String(e).includes("busy"))
          timer = setTimeout(() => {
            void render();
          }, 350);
      }
    };
    timer = setTimeout(() => {
      void render();
    }, 120);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [item, time, revision, width]);
  return (
    <canvas
      ref={canvas}
      className="max-w-full max-h-full object-contain bg-stage"
      aria-label={label}
    />
  );
}
