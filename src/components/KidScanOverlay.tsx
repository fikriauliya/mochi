import * as React from "react";
import { X, Camera, RefreshCcw, Sparkles } from "lucide-react";
import { Mochi } from "./Mochi";
import { scanWorksheet } from "@/lib/api";

/**
 * Reverse worksheet → app. Captures a photo of a printed sheet via
 * `getUserMedia` (rear camera if available), POSTs the JPEG bytes to
 * `/api/scan/worksheet`, then hands the returned spec to `onPrompt`.
 * Parent kicks off the build via the normal /api/apps create flow —
 * this overlay never touches the registry directly.
 *
 * Camera APIs need a secure context: works on localhost and Tailscale
 * https tunnels; HTTP-on-LAN browsers will hit the `permission` /
 * `error` branch. The Android shell is fine (it bypasses the secure-
 * context check) but needs `CAMERA` runtime permission added.
 */

type Phase = "requesting" | "capturing" | "preview" | "submitting" | "error";

export function KidScanOverlay({
  onClose,
  onPrompt,
}: {
  onClose: () => void;
  onPrompt: (spec: string) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const objectUrlRef = React.useRef<string | null>(null);

  const [phase, setPhase] = React.useState<Phase>("requesting");
  const [imageBlob, setImageBlob] = React.useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState("");

  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = React.useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // facingMode is a hint — desktops just use the only webcam they have.
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {
          /* autoplay can race with mount; the stream is still live */
        });
      }
      setPhase("capturing");
    } catch (err) {
      console.warn("camera failed", err);
      setErrorMsg(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera blocked — ask a grown-up to allow it."
          : "Couldn't open the camera.",
      );
      setPhase("error");
    }
  }, []);

  React.useEffect(() => {
    void startCamera();
    return () => {
      stopCamera();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [startCamera, stopCamera]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErrorMsg("Couldn't grab the frame — try again.");
          setPhase("error");
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setImageBlob(blob);
        setImageUrl(url);
        setPhase("preview");
        // Free the camera while previewing — the user might linger.
        stopCamera();
      },
      "image/jpeg",
      0.85,
    );
  };

  const retake = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setImageBlob(null);
    setImageUrl(null);
    setErrorMsg("");
    setPhase("requesting");
    void startCamera();
  };

  const submit = async () => {
    if (!imageBlob) return;
    setPhase("submitting");
    try {
      const result = await scanWorksheet(imageBlob);
      onPrompt(result.spec);
    } catch (err) {
      console.warn("scan failed", err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Mochi couldn't read this one.",
      );
      setPhase("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-cream/95 backdrop-blur-md flex flex-col items-center justify-center p-6">
      <button
        onClick={onClose}
        aria-label="Cancel"
        className="
          absolute top-4 right-4 size-12 2xl:size-14 rounded-full
          bg-paper border border-line flex items-center justify-center
          text-ink-soft hover:bg-cream-deep transition-colors
          focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
        "
      >
        <X className="size-5 2xl:size-6" />
      </button>

      {phase === "requesting" && (
        <p className="text-ink-soft italic text-base 2xl:text-lg">
          Asking the camera nicely…
        </p>
      )}

      {phase === "capturing" && (
        <div className="flex flex-col items-center gap-6 w-full max-w-xl">
          <div className="relative w-full aspect-[3/4] rounded-3xl overflow-hidden bg-ink/10 border-2 border-dashed border-mochi-deep/40">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-4 rounded-2xl border-2 border-mochi-deep/60 pointer-events-none" />
          </div>
          <p className="text-ink-soft text-sm 2xl:text-base text-center">
            Hold the worksheet flat in the frame.
          </p>
          <button
            onClick={capture}
            autoFocus
            className="
              inline-flex items-center justify-center gap-2
              min-h-14 2xl:min-h-16 px-8 rounded-full
              bg-mochi-deep text-paper font-bold text-lg 2xl:text-2xl
              shadow-[0_8px_20px_-8px_rgba(224,114,107,0.7)]
              hover:scale-[1.02] active:scale-95 transition-transform
              focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
            "
          >
            <Camera className="size-5 2xl:size-6" />
            Snap it!
          </button>
        </div>
      )}

      {phase === "preview" && imageUrl && (
        <div className="flex flex-col items-center gap-6 w-full max-w-xl">
          <img
            src={imageUrl}
            alt="captured worksheet"
            className="w-full max-h-[60vh] object-contain rounded-3xl border border-line bg-paper"
          />
          <div className="flex flex-wrap items-center justify-center gap-3 w-full">
            <button
              onClick={submit}
              autoFocus
              className="
                flex-1 min-w-[12rem] inline-flex items-center justify-center gap-2
                min-h-14 2xl:min-h-16 px-6 rounded-full
                bg-mochi-deep text-paper font-bold text-lg 2xl:text-2xl
                shadow-[0_8px_20px_-8px_rgba(224,114,107,0.7)]
                hover:scale-[1.02] active:scale-95 transition-transform
                focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
              "
            >
              <Sparkles className="size-5 2xl:size-6" />
              Make it!
            </button>
            <button
              onClick={retake}
              className="
                inline-flex items-center gap-2
                min-h-12 px-5 2xl:px-6 rounded-full
                bg-paper border border-line text-ink font-semibold
                hover:bg-cream-deep transition-colors
                focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
              "
            >
              <RefreshCcw className="size-4" />
              Retake
            </button>
          </div>
        </div>
      )}

      {phase === "submitting" && (
        <div className="flex flex-col items-center gap-4">
          <Mochi typing size={200} />
          <p className="text-ink-soft italic text-base 2xl:text-lg">
            Mochi is reading it…
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col items-center gap-4 max-w-xl text-center">
          <p className="text-mom font-semibold text-lg 2xl:text-xl">
            {errorMsg || "Something went wrong."}
          </p>
          <button
            onClick={retake}
            className="
              inline-flex items-center gap-2
              min-h-14 px-6 rounded-full
              bg-mochi-deep text-paper font-bold text-base 2xl:text-lg
              hover:scale-[1.02] active:scale-95 transition-transform
              focus:outline-none focus-visible:ring-4 focus-visible:ring-mochi-soft
            "
          >
            <RefreshCcw className="size-4" />
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
