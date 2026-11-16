# Changelog

## 4.2.1 (2026-11-16)

- `CloudApiError.detail`: what the backend said about a rejected input, with 422 `backend_rejected`. For SSML, `{ code, message, position }`, e.g. `UNSUPPORTED_TAG` at position 13. Before, the SDK dropped it and only `code` was seen.

## 4.2.0 (2026-11-16)

- `SpeechSession.streamUrl`: the WebSocket address of a live STT or TTS session (`serverUrl` + `/v1/stream`), from the cloud's new `stream_url`. Built from `serverUrl` when an older cloud does not send it.
- A speech session key serves one connection: after a disconnect, create a new session.
- `extendToken`: extend before `expiresAt`. The cloud removes a participant a minute after an unextended token expires, and later calls throw `session_not_extendable` (409). `additional` is seconds or a string such as `'15m'`.
- Transcription `language` is `en` by default (`auto` is not accepted for files); the type comment said it was detected.

Earlier versions are described in their commit messages.
