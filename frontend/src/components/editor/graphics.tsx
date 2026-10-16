import { useState } from "react";
import { useEditor } from "@/contexts/editor-state";
import { Button } from "@/components/ui/button";
import { integer } from "@/lib/editor-time";
import { EffectInspector } from "./effects";
import { CommandsPanel } from "./commands";

export function GraphicsPanel({ time }: { time: string }) {
  const { snapshot, execute } = useEditor();
  const [text, setText] = useState("");
  const clip = snapshot?.sequence?.video_tracks
    .flatMap((t) => t.items)
    .find((c) => snapshot.state.selection.includes(c.id));
  const layers =
    clip?.effects.filter(
      (e) => e.effect === "graphic_text" || e.effect === "graphic_shape",
    ) ?? [];
  const run = (id: string, p = {}) => {
    void execute(id, { clip: clip ? integer(clip.id) : undefined, ...p }).catch(
      () => {},
    );
  };
  return (
    <div className="editor-panel-body">
      <textarea
        className="editor-input w-full"
        aria-label="New graphic text"
        placeholder="Title text"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap gap-1 my-2">
        <Button
          disabled={!snapshot?.sequence || !text}
          onClick={() =>
            run("graphics.newText", {
              text,
              time: integer(time),
              newClip: !layers.length,
            })
          }
        >
          Add Text Layer
        </Button>
        <Button
          disabled={!snapshot?.sequence}
          onClick={() =>
            run("graphics.newRectangle", {
              time: integer(time),
              newClip: !layers.length,
            })
          }
        >
          Rectangle
        </Button>
        <Button
          disabled={!snapshot?.sequence}
          onClick={() =>
            run("graphics.newEllipse", {
              time: integer(time),
              newClip: !layers.length,
            })
          }
        >
          Ellipse
        </Button>
      </div>
      {layers.map((layer, i) => (
        <section className="editor-effect" key={i}>
          <button
            className="editor-list-row"
            onClick={() => run("graphics.selectLayer", { layers: [i] })}
          >
            {layer.params.text?.value.Text ?? `Shape ${i + 1}`}
          </button>
          <div className="flex gap-1">
            <Button
              size="sm"
              onClick={() =>
                run("graphics.arrangeLayer", { layer: i, to: "forward" })
              }
            >
              Forward
            </Button>
            <Button
              size="sm"
              onClick={() =>
                run("graphics.arrangeLayer", { layer: i, to: "backward" })
              }
            >
              Backward
            </Button>
            <Button
              size="sm"
              onClick={() => run("graphics.deleteLayer", { layer: i })}
            >
              Delete
            </Button>
          </div>
        </section>
      ))}
      {!!layers.length && (
        <details open>
          <summary className="editor-section-title">Layer Properties</summary>
          <EffectInspector time={time} />
        </details>
      )}
      <details>
        <summary className="editor-section-title">
          Templates, Layout & Animation
        </summary>
        <CommandsPanel category="graphics" />
      </details>
    </div>
  );
}
