# Changelog

## 4.3.1 (2026-11-25)

[dTelecom SDK catalog](https://docs.dtelecom.org/reference/sdks/)

- Fresh CommonJS and ES module installations work on Node.js 20.18.0 and newer. Webhook registry lookups now use Solana’s HTTP RPC and address libraries.

## 4.3.0 (2026-11-24)

- `createToken` and `extendToken` return `region`: where the chosen node is (its city, else its country; empty when unknown).
- `getSession(sessionId)` reads a session of the project and its charge (`chargedMicrocredits`, `chargedUsd`, `final`, `coveredByAddon`); `listSessions(room, { since, limit })` lists a room's participant sessions and the service sessions linked to them, newest first, with totals. New types `SessionCharge`, `SessionCharges`, `ListSessionsOptions`.

## 4.2.4 (2026-11-23)

- Docs only: the README links [docs.dtelecom.org](https://docs.dtelecom.org). Code is the same as 4.2.3.

## 4.2.3 (2026-11-17)

- Docs only: moderation runs on your backend. The README and the `streamTicket` / `ModerationStream` comments no longer suggest handing the ticket to a browser: the backend gets the media (a bot subscribed to the room's tracks, or its own upload), sends it for moderation and acts on `flag` with its own code.

## 4.2.2 (2026-11-17)

- `RoomServiceClient` sends each call where the node can act on it. Calls about a participant (`removeParticipant`, `mutePublishedTrack`, `updateParticipant`, `updateSubscriptions`, `getParticipant`) go to the node hosting that participant; room-wide calls (`updateRoomMetadata`, `sendData`, `deleteRoom`) go to one hosting node and move to the next when a node is unreachable or answers 5xx; `listParticipants` asks every hosting node. Before, every call went to every hosting node, so in a room spread over two nodes a data message arrived twice.
- `updateSubscriptions` sends the tracks grouped by their publisher. Nodes released before 2026-11-17 answered the plain track list with 500 "operation cannot be completed".
- A room nobody has joined yet is no longer cached as having no nodes, so calls right after the first participant joins reach it.
- `WebhookReceiver` allows one minute of clock difference with the node for `nbf` and `exp`. A node clock a second ahead made deliveries fail as not valid yet.
- `updateParticipant` and `updateRoomMetadata` return the participant and the room from nodes released on 2026-11-17 or later; older nodes answer with an empty object although the change is applied.

## 4.2.1 (2026-11-16)

- `CloudApiError.detail`: what the backend said about a rejected input, with 422 `backend_rejected`. For SSML, `{ code, message, position }`, e.g. `UNSUPPORTED_TAG` at position 13. Before, the SDK dropped it and only `code` was seen.

## 4.2.0 (2026-11-16)

- `SpeechSession.streamUrl`: the WebSocket address of a live STT or TTS session (`serverUrl` + `/v1/stream`), from the cloud's new `stream_url`. Built from `serverUrl` when an older cloud does not send it.
- A speech session key serves one connection: after a disconnect, create a new session.
- `extendToken`: extend before `expiresAt`. The cloud removes a participant a minute after an unextended token expires, and later calls throw `session_not_extendable` (409). `additional` is seconds or a string such as `'15m'`.
- Transcription `language` is `en` by default (`auto` is not accepted for files); the type comment said it was detected.

Earlier versions are described in their commit messages.
