import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Monitor, Camera } from "lucide-react";

interface RecordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectOption: (option: "screen" | "camera") => void;
  sectionIndex: number;
  hasExistingSource?: boolean;
  onClear?: () => void;
}

export function RecordModal({
  open,
  onOpenChange,
  onSelectOption,
  sectionIndex,
  hasExistingSource = false,
  onClear,
}: RecordModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[380px]">
        <DialogHeader>
          <DialogTitle>
            {hasExistingSource ? "Change" : "Add Source to"} Section{" "}
            {sectionIndex + 1}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <button
            className="h-24 rounded-xl bg-fill hover:bg-fill-hover flex flex-col items-center justify-center gap-2 motion-safe:active:scale-[0.98] transition-[transform,background-color,color] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            onClick={() => {
              onSelectOption("screen");
              onOpenChange(false);
            }}
          >
            <Monitor className="h-7 w-7 text-foreground" />
            <span className="text-headline text-foreground">Screen</span>
            <span className="text-caption text-muted-foreground">
              Capture a display or region
            </span>
          </button>
          <button
            className="h-24 rounded-xl bg-fill hover:bg-fill-hover flex flex-col items-center justify-center gap-2 motion-safe:active:scale-[0.98] transition-[transform,background-color,color] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            onClick={() => {
              onSelectOption("camera");
              onOpenChange(false);
            }}
          >
            <Camera className="h-7 w-7 text-foreground" />
            <span className="text-headline text-foreground">Camera</span>
            <span className="text-caption text-muted-foreground">
              Use a connected camera
            </span>
          </button>
        </div>
        {hasExistingSource && onClear && (
          <div className="flex border-t border-separator pt-3">
            <Button
              variant="destructive"
              onClick={() => {
                onClear();
                onOpenChange(false);
              }}
            >
              Clear Section
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
