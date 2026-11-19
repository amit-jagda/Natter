"""Live Voice Pipeline Integration Test Script.

Tests the full STT -> LLM -> TTS loop using actual configured providers:
- Google Gemini STT
- Google Gemini LLM
- Piper TTS (or Mock/gTTS fallback if local runtime is not yet installed)

Usage:
    python backend/scripts/test_voice_turn.py
"""

import asyncio
import os
import sys
import time
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.adapters.llm.base import LLMMessage
from app.adapters.llm.gemini import GeminiLLMAdapter
from app.adapters.stt.google import GoogleSTTAdapter
from app.adapters.tts.piper import PiperTTSAdapter
from app.core.config import settings
from app.services.voice_orchestrator import voice_orchestrator


def generate_test_wav_bytes(duration_sec: float = 1.0, freq: int = 440) -> bytes:
    """Generate minimal valid PCM WAV bytes with a sine-wave tone for testing."""
    import io
    import math
    import wave

    sample_rate = 16000
    num_samples = int(sample_rate * duration_sec)
    buf = io.BytesIO()

    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        data = bytearray()
        for i in range(num_samples):
            val = int(32767.0 * 0.3 * math.sin(2.0 * math.pi * freq * (i / sample_rate)))
            data.extend(val.to_bytes(2, byteorder="little", signed=True))
        wf.writeframes(data)

    return buf.getvalue()


async def main():
    print("=" * 70)
    print("Live Voice Engine Integration Test")
    print("=" * 70)

    # 1. Inspect Environment & Credentials
    api_key = settings.GOOGLE_API_KEY or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    has_key = bool(api_key and not api_key.startswith("your_") and len(api_key) > 15)

    print(f"STT Provider:       {settings.STT_PROVIDER}")
    print(f"LLM Provider:       {settings.LLM_PROVIDER}")
    print(f"TTS Provider:       {settings.TTS_PROVIDER}")
    print(f"Google API Key:     {'CONFIGURED (' + api_key[:6] + '...)' if has_key else 'NOT CONFIGURED'}")

    # 2. Check Piper Runtime Status
    piper_adapter = PiperTTSAdapter()
    piper_ok, piper_msg = piper_adapter.check_runtime_status()
    print(f"Piper Runtime:      {'READY (' + piper_msg + ')' if piper_ok else 'UNAVAILABLE: ' + piper_msg}")

    print("\n" + "-" * 70)

    if not has_key:
        print("[NOTICE] GOOGLE_API_KEY is not set in .env or environment.")
        print("To test real Google Gemini STT and LLM, add your API key to .env:")
        print("  GOOGLE_API_KEY=AIzaSy...")
        print("Running tests with mock adapters instead...\n")
        settings.STT_PROVIDER = "mock"
        settings.LLM_PROVIDER = "mock"
        settings.TTS_PROVIDER = "mock"

    # 3. Test Live Gemini LLM if key is present
    if has_key:
        print("[1/3] Testing Google Gemini LLM Adapter...")
        gemini = GeminiLLMAdapter(api_key=api_key)
        test_messages = [
            LLMMessage(role="system", content="You are a helpful conversational AI assistant. Keep responses brief."),
            LLMMessage(role="user", content="Hello! How are you doing today?"),
        ]
        t0 = time.perf_counter()
        try:
            llm_reply = await gemini.complete(test_messages)
            llm_time = (time.perf_counter() - t0) * 1000.0
            print(f"  Response: {llm_reply}")
            print(f"  Latency:  {llm_time:.1f}ms [OK]")
        except Exception as exc:
            print(f"  LLM Error: {exc} [FAILED]")

        print("\n[2/3] Testing Google Gemini STT Adapter...")
        stt = GoogleSTTAdapter(api_key=api_key)
        test_audio = generate_test_wav_bytes(duration_sec=1.0)
        t0 = time.perf_counter()
        try:
            stt_result = await stt.transcribe(test_audio, content_type="audio/wav")
            stt_time = (time.perf_counter() - t0) * 1000.0
            print(f"  Transcript: '{stt_result.transcript}'")
            print(f"  Latency:    {stt_time:.1f}ms [OK]")
        except Exception as exc:
            print(f"  STT Note/Error: {exc} (Note: Tone audio may produce empty transcript, which is expected)")

    # 4. Test TTS
    print("\n[3/3] Testing TTS Adapter...")
    if piper_ok:
        try:
            t0 = time.perf_counter()
            tts_res = await piper_adapter.synthesize("Hello, testing Piper text to speech.")
            tts_time = (time.perf_counter() - t0) * 1000.0
            print(f"  Generated WAV size: {len(tts_res.audio)} bytes")
            print(f"  Latency:            {tts_time:.1f}ms [OK]")
        except Exception as exc:
            print(f"  Piper TTS Error: {exc}")
    else:
        print(f"  Piper is not ready on this machine: {piper_msg}")
        print("  Testing Mock TTS fallback...")
        from app.adapters.tts.base import MockTTSAdapter
        mock_tts = MockTTSAdapter()
        t0 = time.perf_counter()
        tts_res = await mock_tts.synthesize("Mock speech audio")
        tts_time = (time.perf_counter() - t0) * 1000.0
        print(f"  Generated Mock WAV size: {len(tts_res.audio)} bytes ({tts_time:.1f}ms) [OK]")

    # 5. Test Full Pipeline via Voice Orchestrator
    print("\n" + "=" * 70)
    print("Testing End-to-End Turn via VoiceOrchestrator...")
    print("=" * 70)
    test_audio = generate_test_wav_bytes(duration_sec=1.0)

    try:
        result = await voice_orchestrator.execute_turn(
            audio_bytes=test_audio,
            content_type="audio/wav",
            session_id="integration-test-session",
            language="en",
        )
        print("Turn Result Summary:")
        print(f"  Session ID:    {result.session_id}")
        print(f"  Transcript:    '{result.transcript}'")
        print(f"  AI Response:   '{result.response_text}'")
        print(f"  Audio Output:  {'Generated (' + str(len(result.audio_base64 or '')) + ' chars base64)' if result.audio_base64 else 'None'}")
        if result.audio_error:
            print(f"  Audio Error:   {result.audio_error}")
        print(f"  Timings:       STT: {result.timings.stt_ms:.1f}ms | LLM: {result.timings.llm_ms:.1f}ms | TTS: {result.timings.tts_ms:.1f}ms | Total: {result.timings.total_ms:.1f}ms")
        print(f"  Providers:     STT={result.providers['stt']} | LLM={result.providers['llm']} | TTS={result.providers['tts']}")
        print("\nIntegration test executed successfully!")
    except Exception as exc:
        print(f"Pipeline Execution Failed: {exc}")


if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception:
            pass
    asyncio.run(main())

