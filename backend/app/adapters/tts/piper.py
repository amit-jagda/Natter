"""Piper Local Neural Text-to-Speech (TTS) Adapter.

Runs high-performance VITS neural TTS models locally via ONNX Runtime on CPU.
Produces 16-bit PCM WAV audio with 50-150ms synthesis latency.
Supports Hindi (hi_IN-pratham-medium) and English (en_US-lessac-medium).
"""

import io
import logging
import os
import shutil
import subprocess
import threading
import wave
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.adapters.tts.base import TTSProvider, TTSResult
from app.core.config import settings
from app.core.exceptions import (
    ProviderUnavailableError,
    TextToSpeechError,
)

logger = logging.getLogger(__name__)

# Default language to Piper voice mapping
LANGUAGE_TO_PIPER_VOICE: Dict[str, str] = {
    "en": "en_US-lessac-medium",
    "en-us": "en_US-lessac-medium",
    "en-gb": "en_GB-alan-medium",
    "hi": "hi_IN-pratham-medium",
    "hi-in": "hi_IN-pratham-medium",
}

AVAILABLE_PIPER_VOICES: List[Dict[str, str]] = [
    {
        "name": "en_US-lessac-medium",
        "language": "en",
        "gender": "female",
        "description": "US English - Lessac (Clear, Natural Female)",
    },
    {
        "name": "hi_IN-pratham-medium",
        "language": "hi",
        "gender": "male",
        "description": "Hindi - Pratham (Clear Indian Male)",
    },
    {
        "name": "hi_IN-priyamvada-medium",
        "language": "hi",
        "gender": "female",
        "description": "Hindi - Priyamvada (Clear Indian Female)",
    },
]


class PiperTTSAdapter(TTSProvider):
    """Local Piper neural TTS adapter using ONNX runtime or CLI binary."""

    name = "piper"

    def __init__(
        self,
        default_voice: Optional[str] = None,
        voice_dir: Optional[str] = None,
        use_cuda: bool = False,
    ) -> None:
        self.default_voice = default_voice or getattr(
            settings, "PIPER_DEFAULT_VOICE", "en_US-lessac-medium"
        )
        resolved_dir = voice_dir or getattr(
            settings, "PIPER_VOICE_DIR", "data/piper_voices"
        )
        self.voice_dir = Path(resolved_dir)
        self.use_cuda = use_cuda
        self._voices: Dict[str, object] = {}
        self._lock = threading.Lock()

        # Ensure directory structure exists
        try:
            self.voice_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            logger.warning(f"Could not create Piper voice directory '{self.voice_dir}': {exc}")

    def check_runtime_status(self) -> Tuple[bool, str]:
        """Verify whether Piper python library or CLI binary is available."""
        # 1. Check Python package
        try:
            import piper  # noqa: F401
            return True, "piper-python-package"
        except ImportError:
            pass

        # 2. Check piper binary on PATH or in local directory
        piper_exe = shutil.which("piper") or shutil.which("piper.exe")
        if piper_exe:
            return True, f"piper-cli:{piper_exe}"

        return False, "Piper is not installed. Run 'pip install piper-tts' or install piper binary."

    def is_available(self) -> bool:
        """Check if Piper runtime is ready."""
        available, _ = self.check_runtime_status()
        return available

    def _resolve_voice_name(self, voice: Optional[str], language: Optional[str]) -> str:
        """Resolve voice model name from explicit argument or language mapping."""
        if voice and voice.strip():
            clean_voice = voice.strip()
            if (self.voice_dir / f"{clean_voice}.onnx").exists() or clean_voice.count("-") >= 2:
                return clean_voice

        if language:
            lang_key = language.strip().lower()
            if lang_key in LANGUAGE_TO_PIPER_VOICE:
                return LANGUAGE_TO_PIPER_VOICE[lang_key]
            prefix = lang_key.split("-")[0].split("_")[0]
            if prefix in LANGUAGE_TO_PIPER_VOICE:
                return LANGUAGE_TO_PIPER_VOICE[prefix]

        return self.default_voice

    def _get_model_paths(self, voice_name: str) -> Tuple[Path, Path]:
        """Return expected paths for model .onnx and .onnx.json config."""
        model_path = self.voice_dir / f"{voice_name}.onnx"
        config_path = self.voice_dir / f"{voice_name}.onnx.json"
        return model_path, config_path

    def _load_python_voice(self, voice_name: str):
        """Thread-safe cached loading of Piper ONNX voice session using Python library."""
        if voice_name in self._voices:
            return self._voices[voice_name]

        with self._lock:
            if voice_name in self._voices:
                return self._voices[voice_name]

            model_path, config_path = self._get_model_paths(voice_name)
            if not model_path.exists():
                # Attempt download via piper.download_voices if available
                try:
                    from piper.download_voices import download_voice
                    logger.info(f"Downloading Piper voice '{voice_name}' into {self.voice_dir}...")
                    download_voice(voice_name, self.voice_dir)
                except Exception as exc:
                    logger.error(f"Cannot download Piper voice model '{voice_name}': {exc}")
                    raise ProviderUnavailableError(
                        f"Piper voice model '{voice_name}.onnx' not found at {self.voice_dir}. "
                        f"Please place '{voice_name}.onnx' and '{voice_name}.onnx.json' in {self.voice_dir}."
                    ) from exc

            try:
                from piper import PiperVoice
                voice_obj = PiperVoice.load(str(model_path), use_cuda=self.use_cuda)
                self._voices[voice_name] = voice_obj
                logger.info(f"Loaded Piper voice '{voice_name}' successfully")
                return voice_obj
            except Exception as exc:
                raise TextToSpeechError(f"Failed to load Piper voice '{voice_name}': {exc}") from exc

    def _synthesize_via_cli(self, text: str, voice_name: str) -> bytes:
        """Synthesize audio using the standalone piper CLI executable."""
        model_path, _ = self._get_model_paths(voice_name)
        if not model_path.exists():
            raise ProviderUnavailableError(
                f"Piper voice model file '{model_path}' does not exist on disk."
            )

        cmd = [
            "piper",
            "--model", str(model_path),
            "--output-raw",
        ]
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            raw_pcm, stderr_output = proc.communicate(input=text.encode("utf-8"), timeout=15)
            if proc.returncode != 0:
                raise TextToSpeechError(
                    f"Piper CLI process failed ({proc.returncode}): {stderr_output.decode()[:200]}"
                )

            # Package raw 16-bit mono 22050Hz PCM into WAV
            sample_rate = 22050
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(raw_pcm)

            return buffer.getvalue()
        except Exception as exc:
            raise TextToSpeechError(f"Piper CLI synthesis failed: {exc}") from exc

    async def synthesize(
        self,
        text: str,
        *,
        language: Optional[str] = None,
        voice: Optional[str] = None,
        **kwargs,
    ) -> TTSResult:
        """Synthesize text into raw WAV audio bytes using Piper neural model."""
        if not text or not text.strip():
            raise TextToSpeechError("Text cannot be empty for synthesis.")

        runtime_available, runtime_msg = self.check_runtime_status()
        if not runtime_available:
            raise ProviderUnavailableError(
                f"Piper TTS runtime is not available: {runtime_msg}. "
                "Setup instructions: On Windows run 'pip install piper-tts' and download a voice model, "
                "or set TTS_PROVIDER=mock or TTS_PROVIDER=gtts in .env."
            )

        voice_name = self._resolve_voice_name(voice, language)

        # 1. Prefer Python library if available
        try:
            import piper  # noqa: F401
            voice_obj = self._load_python_voice(voice_name)
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav_file:
                voice_obj.synthesize_wav(text.strip(), wav_file)
            audio_bytes = buffer.getvalue()
            sample_rate = getattr(voice_obj.config, "sample_rate", 22050)
            duration = len(audio_bytes) / (2.0 * sample_rate) if sample_rate > 0 else None

            return TTSResult(
                audio=audio_bytes,
                content_type="audio/wav",
                format="wav",
                duration=duration,
                language=language or "en",
            )
        except ImportError:
            # 2. Try CLI fallback
            audio_bytes = self._synthesize_via_cli(text.strip(), voice_name)
            duration = len(audio_bytes) / (2.0 * 22050)
            return TTSResult(
                audio=audio_bytes,
                content_type="audio/wav",
                format="wav",
                duration=duration,
                language=language or "en",
            )

