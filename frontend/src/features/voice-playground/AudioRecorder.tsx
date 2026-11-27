import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, AlertCircle, PhoneCall, PhoneOff, Radio, Send } from "lucide-react";

interface AudioRecorderProps {
  onAudioRecorded: (blob: Blob, mimeType: string) => void;
  onBargeIn?: () => void;
  isProcessing: boolean;
  disabled?: boolean;
}

const MIN_SPEECH_THRESHOLD = Number(import.meta.env.VITE_VAD_MIN_THRESHOLD ?? 0.035);
const MAX_SPEECH_THRESHOLD = Number(import.meta.env.VITE_VAD_MAX_THRESHOLD ?? 0.12);
const SPEECH_ONSET_FRAMES = Number(import.meta.env.VITE_VAD_ONSET_FRAMES ?? 4); // 50ms per frame (4 = 200ms)
const BARGE_IN_MULTIPLIER = Number(import.meta.env.VITE_VAD_BARGE_IN_MULTIPLIER ?? 1.4); // Multiplier while bot is speaking
const SILENCE_TIMEOUT_MS = Number(import.meta.env.VITE_VAD_SILENCE_TIMEOUT_MS ?? 1000); // 1.0s pause triggers end of turn
const MAX_UTTERANCE_MS = 15000; // 15s safety cap per utterance

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onAudioRecorded,
  onBargeIn,
  isProcessing,
  disabled = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveCallActive, setIsLiveCallActive] = useState(false);
  const [liveVadState, setLiveVadState] = useState<"idle" | "calibrating" | "listening" | "speaking">("idle");
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  // Refs to avoid stale closures inside setInterval / MediaRecorder callbacks
  const onAudioRecordedRef = useRef(onAudioRecorded);
  const onBargeInRef = useRef(onBargeIn);
  const isProcessingRef = useRef(isProcessing);
  useEffect(() => {
    onAudioRecordedRef.current = onAudioRecorded;
  }, [onAudioRecorded]);
  useEffect(() => {
    onBargeInRef.current = onBargeIn;
  }, [onBargeIn]);
  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  // Live Call VAD Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const isCapturingUtteranceRef = useRef<boolean>(false);
  const captureStartTimestampRef = useRef<number>(0);
  const lastSpeechTimestampRef = useRef<number>(0);

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

  // Manual Push-to-Talk Recording
  const startManualRecording = async () => {
    setPermissionError(null);
    audioChunksRef.current = [];
    if (onBargeInRef.current) onBargeInRef.current();

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
          onAudioRecordedRef.current(fullBlob, mimeType);
        } else {
          setPermissionError("Recording was too short or empty. Please speak clearly.");
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      recorder.start(250);
      setIsRecording(true);
      setDurationSec(0);

      timerRef.current = window.setInterval(() => {
        setDurationSec((prev) => prev + 1);
      }, 1000);
    } catch (err: unknown) {
      handleMicError(err);
    }
  };

  const stopManualRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Live Call Mode (Continuous Adaptive VAD + Barge-In)
  const startUtteranceCapture = useCallback((stream: MediaStream) => {
    if (isCapturingUtteranceRef.current) return;
    isCapturingUtteranceRef.current = true;
    captureStartTimestampRef.current = Date.now();
    setLiveVadState("speaking");
    audioChunksRef.current = [];

    // Trigger immediate barge-in to halt AI audio playback and abort stale streams
    if (onBargeInRef.current) onBargeInRef.current();

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
      isCapturingUtteranceRef.current = false;
      setLiveVadState("listening");
      if (fullBlob.size > 600) {
        onAudioRecordedRef.current(fullBlob, mimeType);
      }
    };

    recorder.start(100);
  }, []);

  const stopUtteranceCapture = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startLiveCall = async () => {
    setPermissionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Float32Array(analyser.fftSize);
      let consecutiveSpeechFrames = 0;
      let calibrationFrames = 0;
      let ambientSum = 0;
      let dynamicThreshold = 0.025;

      setIsLiveCallActive(true);
      setLiveVadState("calibrating");

      vadIntervalRef.current = window.setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(dataArray);

        // Compute RMS energy
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        setVolumeLevel(Math.min(100, Math.round(rms * 500)));

        // Calibrate ambient noise floor during first 300ms (6 frames)
        if (calibrationFrames < 6) {
          ambientSum += rms;
          calibrationFrames += 1;
          if (calibrationFrames === 6) {
            const avgAmbient = ambientSum / 6;
            dynamicThreshold = Math.max(
              MIN_SPEECH_THRESHOLD,
              Math.min(MAX_SPEECH_THRESHOLD, avgAmbient * 3.0)
            );
            setLiveVadState("listening");
          }
          return;
        }

        const now = Date.now();
        const activeThreshold =
          !isCapturingUtteranceRef.current && isProcessingRef.current
            ? dynamicThreshold * BARGE_IN_MULTIPLIER
            : dynamicThreshold;

        if (rms > activeThreshold) {
          consecutiveSpeechFrames += 1;
          lastSpeechTimestampRef.current = now;

          if (!isCapturingUtteranceRef.current && consecutiveSpeechFrames >= SPEECH_ONSET_FRAMES) {
            startUtteranceCapture(stream);
          }
        } else {
          consecutiveSpeechFrames = 0;
          if (isCapturingUtteranceRef.current) {
            const silentMs = now - lastSpeechTimestampRef.current;
            const totalMs = now - captureStartTimestampRef.current;
            if (silentMs >= SILENCE_TIMEOUT_MS || totalMs >= MAX_UTTERANCE_MS) {
              stopUtteranceCapture();
            }
          }
        }
      }, 50);
    } catch (err: unknown) {
      handleMicError(err);
    }
  };

  const stopLiveCall = () => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    isCapturingUtteranceRef.current = false;
    setIsLiveCallActive(false);
    setLiveVadState("idle");
    setVolumeLevel(0);
  };

  const handleMicError = (err: unknown) => {
    console.error("Microphone access error:", err);
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      setPermissionError("Microphone permission was denied. Please allow microphone access in your browser settings.");
    } else {
      setPermissionError("Unable to access microphone. Please verify that a microphone is connected.");
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
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

      {/* Live Call Active UI */}
      {isLiveCallActive ? (
        <div className="flex flex-col items-center gap-3 w-full max-w-lg">
          <div className="flex items-center justify-between w-full rounded-full border border-emerald-200 bg-emerald-50/80 px-5 py-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-600"></span>
              </span>
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {liveVadState === "calibrating"
                  ? "Calibrating microphone..."
                  : liveVadState === "speaking"
                  ? "Hearing you... (pause 1s to send)"
                  : isProcessing
                  ? "AI responding (speak anytime to interrupt)..."
                  : "Live Call Active — Speak whenever ready"}
              </span>
            </div>

            {/* Live Mic Volume Bar */}
            <div className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-emerald-600" />
              <div className="h-2 w-16 overflow-hidden rounded-full bg-emerald-200 dark:bg-emerald-900">
                <div
                  className="h-full bg-emerald-600 transition-all duration-75"
                  style={{ width: `${volumeLevel}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {liveVadState === "speaking" && (
              <Button
                variant="secondary"
                size="lg"
                className="h-11 gap-2 rounded-full px-5 shadow-sm"
                onClick={stopUtteranceCapture}
              >
                <Send className="h-4 w-4" />
                <span>Send Now</span>
              </Button>
            )}

            <Button
              variant="destructive"
              size="lg"
              className="h-11 gap-2 rounded-full px-7 shadow-md"
              onClick={stopLiveCall}
            >
              <PhoneOff className="h-4 w-4" />
              <span>End Live Call</span>
            </Button>
          </div>
        </div>
      ) : (
        /* Standard Controls: Live Call Start or Push-to-Talk */
        <div className="flex flex-wrap items-center justify-center gap-3">
          {!isRecording ? (
            <>
              <Button
                size="lg"
                className="h-14 gap-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-7 text-sm font-semibold shadow-md transition-all hover:shadow-lg"
                onClick={startLiveCall}
                disabled={isProcessing || disabled}
              >
                <PhoneCall className="h-4 w-4" />
                <span>Start Live Call (Hands-Free + Barge-In)</span>
              </Button>

              <Button
                size="lg"
                variant="outline"
                className="h-14 gap-2.5 rounded-full px-6 text-sm shadow-sm transition-all"
                onClick={startManualRecording}
                disabled={isProcessing || disabled}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" />
                    <span>Push to Talk</span>
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 dark:border-red-900/40 dark:bg-red-950/40">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600"></span>
                </span>
                <span className="font-mono">{formatDuration(durationSec)}</span>
                <span className="text-xs font-normal text-red-500">(Recording...)</span>
              </div>

              <Button
                variant="destructive"
                size="lg"
                className="h-14 gap-2 rounded-full px-6 shadow-md"
                onClick={stopManualRecording}
              >
                <Square className="h-4 w-4 fill-current" />
                <span>Done</span>
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="text-center text-xs text-muted-foreground">
        {isLiveCallActive
          ? "Speak naturally — pausing for 1 second automatically sends your turn. Speaking while AI talks interrupts immediately."
          : isRecording
          ? "Push-to-Talk mode: Click 'Done' when finished speaking."
          : isProcessing
          ? "Transcribing audio with Google STT, running backend tools with Gemini, and streaming speech..."
          : "Click the green 'Start Live Call' button for a continuous hands-free phone call."}
      </div>
    </div>
  );
};
