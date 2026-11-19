import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, AlertCircle } from "lucide-react";

interface AudioRecorderProps {
  onAudioRecorded: (blob: Blob, mimeType: string) => void;
  isProcessing: boolean;
  disabled?: boolean;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onAudioRecorded,
  isProcessing,
  disabled = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const detectSupportedMimeType = (): string => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/wav",
    ];
    for (const mime of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return "audio/webm";
  };

  const startRecording = async () => {
    setPermissionError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mimeType = detectSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const fullBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (fullBlob.size > 100) {
          onAudioRecorded(fullBlob, mimeType);
        } else {
          setPermissionError("Recording was too short or empty. Please speak clearly.");
        }
        // Stop audio tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      recorder.start(250); // collect chunks every 250ms
      setIsRecording(true);
      setDurationSec(0);

      timerRef.current = window.setInterval(() => {
        setDurationSec((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      console.error("Microphone access error:", err);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPermissionError("Microphone permission was denied. Please allow microphone access in your browser settings.");
      } else {
        setPermissionError("Unable to access microphone. Please verify that a microphone is connected.");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const formatDuration = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60)
      .toString()
      .padStart(2, "0");
    const secs = (totalSec % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {permissionError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{permissionError}</span>
        </div>
      )}

      <div className="flex items-center gap-4">
        {!isRecording ? (
          <Button
            size="lg"
            className="h-14 gap-3 rounded-full px-8 text-base shadow-md transition-all hover:shadow-lg"
            onClick={startRecording}
            disabled={isProcessing || disabled}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Processing Turn...</span>
              </>
            ) : (
              <>
                <Mic className="h-5 w-5 text-primary-foreground" />
                <span>Start Speaking</span>
              </>
            )}
          </Button>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 dark:border-red-900/40 dark:bg-red-950/40">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600"></span>
              </span>
              <span className="font-mono">{formatDuration(durationSec)}</span>
              <span className="text-xs font-normal text-red-500">(Listening...)</span>
            </div>

            <Button
              variant="destructive"
              size="lg"
              className="h-14 gap-2 rounded-full px-6 shadow-md"
              onClick={stopRecording}
            >
              <Square className="h-4 w-4 fill-current" />
              <span>Done</span>
            </Button>
          </div>
        )}
      </div>

      <div className="text-center text-xs text-muted-foreground">
        {isRecording
          ? "Speak naturally in Hindi, English, or Hinglish. Click 'Done' when finished."
          : isProcessing
          ? "Transcribing audio with Google STT, querying Gemini LLM, and synthesizing speech..."
          : "Click 'Start Speaking' and speak a query (e.g. 'Hello, what services do you provide?')."}
      </div>
    </div>
  );
};

