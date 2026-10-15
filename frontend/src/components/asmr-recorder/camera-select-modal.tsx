import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Check, Loader2 } from "lucide-react";
import { useRecordingContext } from "@/contexts/recording-context";
import { cn, hasMediaApi } from "@/lib/utils";

interface CameraSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCamera: (deviceId: string, deviceName: string, stream: MediaStream) => void;
  sectionIndex: number;
}

export function CameraSelectModal({
  open,
  onOpenChange,
  onSelectCamera,
  sectionIndex,
}: CameraSelectModalProps) {
  const { browserDevices, fetchBrowserDevices } = useRecordingContext();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Filter to only video input devices
  const cameras = browserDevices.filter(device => device.kind === "videoinput");

  // Fetch devices when modal opens
  useEffect(() => {
    if (open) {
      fetchBrowserDevices();
    }
  }, [open, fetchBrowserDevices]);

  // Start preview when device is selected
  useEffect(() => {
    if (!selectedDeviceId || !open) return;

    const startPreview = async () => {
      setIsLoading(true);
      setError(null);

      // Stop previous stream
      if (previewStream) {
        previewStream.getTracks().forEach(track => track.stop());
      }

      if (!hasMediaApi("getUserMedia")) {
        setError(
          "Camera access is unavailable in this webview (navigator.mediaDevices is missing). It requires a secure context and camera permissions.",
        );
        setIsLoading(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedDeviceId } },
          audio: false,
        });
        setPreviewStream(stream);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Failed to access camera:", err);
        setError("Failed to access camera. Please check permissions.");
      } finally {
        setIsLoading(false);
      }
    };

    startPreview();
  }, [selectedDeviceId, open]);

  // Cleanup on close
  useEffect(() => {
    if (!open && previewStream) {
      previewStream.getTracks().forEach(track => track.stop());
      setPreviewStream(null);
      setSelectedDeviceId(null);
    }
  }, [open]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (previewStream) {
        previewStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleConfirm = () => {
    if (selectedDeviceId && previewStream) {
      const device = cameras.find(d => d.deviceId === selectedDeviceId);
      const deviceName = device?.label || `Camera ${cameras.findIndex(d => d.deviceId === selectedDeviceId) + 1}`;

      // Don't stop the stream - pass it to the parent
      onSelectCamera(selectedDeviceId, deviceName, previewStream);
      setPreviewStream(null); // Clear local reference without stopping
      setSelectedDeviceId(null);
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    if (previewStream) {
      previewStream.getTracks().forEach(track => track.stop());
      setPreviewStream(null);
    }
    setSelectedDeviceId(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleCancel();
      else onOpenChange(isOpen);
    }}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Select Camera</DialogTitle>
          <DialogDescription>
            Choose a camera for Section {sectionIndex + 1}
          </DialogDescription>
        </DialogHeader>

        {/* Camera Preview */}
        <div className="aspect-video bg-stage rounded-lg overflow-hidden relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-white/60 animate-spin" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-destructive text-caption p-4 text-center">
              {error}
            </div>
          )}
          {!selectedDeviceId && !isLoading && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-white/50">
                <Camera className="h-10 w-10 mx-auto mb-2" />
                <p className="text-callout">Select a camera to preview</p>
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn("w-full h-full object-cover", !previewStream && "hidden")}
          />
        </div>

        {/* Camera List */}
        <div className="flex flex-col gap-1">
          <p className="text-headline text-foreground">Available Cameras</p>
          {cameras.length === 0 ? (
            <p className="text-callout text-muted-foreground">
              No cameras found. Please connect a camera and try again.
            </p>
          ) : (
            <div className="flex flex-col max-h-48 overflow-y-auto">
              {cameras.map((device, index) => (
                <button
                  key={device.deviceId}
                  className={cn(
                    "flex items-center gap-2 h-8 rounded-md px-2 text-body transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    selectedDeviceId === device.deviceId
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-fill"
                  )}
                  onClick={() => setSelectedDeviceId(device.deviceId)}
                >
                  <Camera className="h-4 w-4 shrink-0" />
                  <span className="truncate flex-1">
                    {device.label || `Camera ${index + 1}`}
                  </span>
                  {selectedDeviceId === device.deviceId && (
                    <Check className="h-4 w-4 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="default" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={handleConfirm}
            disabled={!selectedDeviceId || !previewStream || isLoading}
          >
            Use Camera
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
