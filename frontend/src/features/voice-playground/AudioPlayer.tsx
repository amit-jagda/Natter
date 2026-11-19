import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw, Volume2 } from "lucide-react";

interface AudioPlayerProps {
  base64Audio: string;
  mimeType?: string;
  autoPlay?: boolean;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  base64Audio,
  mimeType = "audio/wav",
  autoPlay = true,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);

  const audioSrc = `data:${mimeType};base64,${base64Audio}`;

  useEffect(() => {
    if (autoPlay && audioRef.current) {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          // Autoplay may be blocked by browser policy until user gesture
          console.warn("Autoplay deferred until user interaction:", err);
          setIsPlaying(false);
        });
    }
  }, [base64Audio, autoPlay]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          setHasEnded(false);
        })
        .catch((err) => console.error("Playback error:", err));
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setHasEnded(true);
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5">
      <audio
        ref={audioRef}
        src={audioSrc}
        onEnded={handleEnded}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full text-primary hover:bg-primary/10"
        onClick={togglePlay}
        title={isPlaying ? "Pause audio" : "Play response"}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : hasEnded ? (
          <RotateCcw className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 fill-current" />
        )}
      </Button>

      <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
        <Volume2 className="h-3.5 w-3.5 text-primary" />
        {isPlaying ? "Playing..." : hasEnded ? "Replay Audio" : "Voice Response"}
      </span>
    </div>
  );
};

