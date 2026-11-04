# ADR 0003: Voice Engine & Telephony Adapter Boundaries

## Status
Accepted

## Context
Voice AI and telephony landscapes evolve rapidly. Hardcoding specific vendors (e.g., Exotel, Twilio, Deepgram, Piper, LiveKit) into the campaign and CRM business logic creates severe vendor lock-in.

## Decision
We introduce abstract adapter contracts (`app/adapters/`):
- `STTProvider` (Speech-to-Text)
- `TTSProvider` (Text-to-Speech)
- `LLMGateway` (Large Language Model)
- `TelephonyProvider` (Carrier / SIP trunking)
- `VoiceEngineSession` (Conversational runtime)

Business modules interact exclusively with these contracts. Concrete implementations are dynamically loaded based on tenant settings or environment configuration.

## Consequences
### Positive:
- **Zero Vendor Lock-in**: Can switch between Indian carriers (Exotel/Plivo) or global carriers (Twilio) with configuration changes.
- **Testability**: Fast, deterministic unit and integration tests using `Mock` adapters without live API keys or telephony billing.
- **Framework Flexibility**: Allows evaluating LiveKit Agents vs Pipecat without rewriting business features.

