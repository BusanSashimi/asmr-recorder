import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Monitor, Camera, X } from "lucide-react";

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasExistingSource ? "Change" : "Record to"} Section {sectionIndex + 1}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <Button
            variant="outline"
            className="h-32 flex flex-col gap-3 hover:bg-accent hover:border-primary bg-transparent"
            onClick={() => {
              onSelectOption("screen");
              onOpenChange(false);
            }}
          >
            <Monitor className="h-10 w-10" />
            <span className="font-medium">Record Screen</span>
            <span className="text-xs text-muted-foreground">
              Share your display
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-32 flex flex-col gap-3 hover:bg-accent hover:border-primary bg-transparent"
            onClick={() => {
              onSelectOption("camera");
              onOpenChange(false);
            }}
          >
            <Camera className="h-10 w-10" />
            <span className="font-medium">Record Camera</span>
            <span className="text-xs text-muted-foreground">
              Use webcam input
            </span>
          </Button>
        </div>
        
        {hasExistingSource && onClear && (
          <div className="border-t pt-4">
            <Button
              variant="ghost"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                onClear();
                onOpenChange(false);
              }}
            >
              <X className="h-4 w-4 mr-2" />
              Clear Section
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
