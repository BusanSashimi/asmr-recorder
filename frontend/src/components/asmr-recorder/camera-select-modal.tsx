import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Camera, Check, Loader2 } from "lucide-react";
import { useRecordingContext } from "@/contexts/recording-context";

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Camera for Section {sectionIndex + 1}</DialogTitle>
          <DialogDescription>
            Choose a camera input to record in this section
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Camera Preview */}
          <Card className="aspect-video bg-black/90 overflow-hidden relative">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-white animate-spin" />
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center text-destructive text-sm p-4 text-center">
                {error}
              </div>
            )}
            {!selectedDeviceId && !isLoading && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-white/60">
                  <Camera className="h-12 w-12 mx-auto mb-2" />
                  <p className="text-sm">Select a camera to preview</p>
                </div>
              </div>
            )}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${!previewStream ? "hidden" : ""}`}
            />
          </Card>

          {/* Camera List */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Available Cameras</p>
            {cameras.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cameras found. Please connect a camera and try again.</p>
            ) : (
              <div className="grid gap-2 max-h-48 overflow-y-auto">
                {cameras.map((device, index) => (
                  <Button
                    key={device.deviceId}
                    variant={selectedDeviceId === device.deviceId ? "default" : "outline"}
                    className="w-full justify-start gap-2 h-auto py-3"
                    onClick={() => setSelectedDeviceId(device.deviceId)}
                  >
                    <Camera className="h-4 w-4 shrink-0" />
                    <span className="truncate flex-1 text-left">
                      {device.label || `Camera ${index + 1}`}
                    </span>
                    {selectedDeviceId === device.deviceId && (
                      <Check className="h-4 w-4 shrink-0" />
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!selectedDeviceId || !previewStream || isLoading}
          >
            Use This Camera
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
