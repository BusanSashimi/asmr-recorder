import { useEditor } from "@/contexts/editor-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ParameterControl, NumberField } from "./effects";
import { integer, frameTick } from "@/lib/editor-time";

export function TransitionDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { snapshot, effects, execute } = useEditor();
  const seq = snapshot?.sequence;
  const transition = [
    ...(seq?.video_tracks ?? []),
    ...(seq?.audio_tracks ?? []),
  ]
    .flatMap((t) => t.transitions)
    .find((t) => t.id === id);
  const definition = effects.find((e) => e.id === transition?.effect.effect);
  if (!transition || !definition || !seq) return null;
  const run = (p: Record<string, unknown>) => {
    void execute("sequence.setTransition", {
      transition: integer(id),
      ...p,
    }).catch(() => {});
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{definition.name}</DialogTitle>
          <DialogDescription>
            Adjust the transition between clips.
          </DialogDescription>
        </DialogHeader>
        <label className="text-caption">
          Duration in Frames
          <NumberField
            id="Transition duration"
            min={1}
            value={Math.round(
              Number(BigInt(transition.duration)) /
                Number(frameTick(1n, seq.settings.frame_rate)),
            )}
            onCommit={(frames) => run({ frames: Math.round(frames) })}
          />
        </label>
        <label className="text-caption">
          Alignment
          <select
            className="editor-input w-full"
            defaultValue=""
            onChange={(e) => run({ align: e.target.value })}
          >
            <option value="" disabled>
              Choose Alignment…
            </option>
            <option value="center">Centered on Cut</option>
            <option value="start">Start at Cut</option>
            <option value="end">End at Cut</option>
          </select>
        </label>
        {definition.params.map((p) => (
          <label className="text-caption" key={p.id}>
            {p.label}
            <ParameterControl
              id={`transition-${p.id}`}
              definition={p}
              value={transition.effect.params[p.id]?.value ?? p.default}
              onCommit={(value) => run({ params: { [p.id]: value } })}
            />
          </label>
        ))}
        <Button
          variant="destructive"
          onClick={() => {
            void execute("sequence.removeTransition", {
              transitions: [integer(id)],
            })
              .then(onClose)
              .catch(() => {});
          }}
        >
          Remove Transition
        </Button>
      </DialogContent>
    </Dialog>
  );
}
