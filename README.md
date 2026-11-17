# dTelecom Cloud server SDK for JavaScript

`@dtelecom/server-sdk-js` 4.x talks to [dTelecom Cloud](https://dtelecom.org) from your backend: it issues participant tokens, extends sessions, administers rooms on the nodes and verifies webhooks. From 4.1 it also calls the hosted AI services: live speech-to-text and text-to-speech, file transcription, WAV synthesis, translation, vision and content moderation.

Version 4 is for projects created in dTelecom Cloud, which have an API key and secret. If your project holds a Solana keypair and signs tokens itself, stay on 3.x (branch [`dtelecom-db`](https://github.com/dTelecom/server-sdk-js/tree/dtelecom-db)).

## Installation

```shell
npm install @dtelecom/server-sdk-js
```

Node 18 or newer.

## Setup

```typescript
import { CloudClient } from '@dtelecom/server-sdk-js';

const cloud = new CloudClient({
  apiKey: process.env.DTELECOM_API_KEY,
  apiSecret: process.env.DTELECOM_API_SECRET,
  baseUrl: 'https://cloud.dtelecom.org',
});
```

Each option falls back to an environment variable: `DTELECOM_API_KEY`, `DTELECOM_API_SECRET` and `DTELECOM_CLOUD_URL`. Keep the client on the server: it holds the secret.

## Participant tokens

Your backend creates a token for each participant and hands `token` and `wsUrl` to the client SDK. Rooms are created when the first participant joins.

```typescript
const { token, wsUrl, sessionId, expiresAt } = await cloud.createToken({
  room: 'name-of-room',
  identity: 'user-name',
  name: 'Display name', // optional
  metadata: JSON.stringify({ role: 'host' }), // optional
  ttl: '2h', // default 6 hours, maximum 24 hours
  clientIp: req.ip, // picks the nearest node for this participant
});
```

The cloud checks the project's balance and concurrency limit and picks the node. Errors come as `CloudApiError` with the cloud's `code`, for example `insufficient_balance` (402) or `concurrency_limit` (429). A 503 with `code` `registry_sync_pending` or `nodes_unavailable` carries `retryAfter` in seconds.

### Permissions

Every participant can publish, subscribe and send data by default. Narrow that with `grants`:

```typescript
// A viewer: watches and chats, cannot publish media.
await cloud.createToken({
  room,
  identity,
  grants: { canPublish: false },
});

// A host who can kick and mute from the client SDK.
await cloud.createToken({
  room,
  identity,
  grants: { roomAdmin: true },
});
```

### Extending a session

A participant is removed from the room a minute after its token expires. Extend it before that; the client applies the new token on its next reconnect, so the current connection stays up. After that minute, `extendToken` throws `session_not_extendable`. A number is seconds; a string can be `'15m'` or `'2h'`.

```typescript
const { token, expiresAt } = await cloud.extendToken(sessionId, '30m');
```

## Managing rooms

`RoomServiceClient` calls the nodes' room API directly, authorised with short-lived admin tokens that the cloud mints for the project. A room's participants can sit on more than one node; the client sends each call to every node hosting the room.

```typescript
const svc = cloud.roomService();

await svc.removeParticipant('name-of-room', 'user-name');
const participants = await svc.listParticipants('name-of-room');
await svc.mutePublishedTrack('name-of-room', 'user-name', trackSid, true);
await svc.updateRoomMetadata('name-of-room', JSON.stringify({ topic: 'standup' }));
await svc.sendData('name-of-room', payload, DataPacket_Kind.RELIABLE, { topic: 'chat' });
await svc.deleteRoom('name-of-room');
```

A call to a room nobody has joined yet throws `RoomNotLiveError` (`deleteRoom` and `listParticipants` return quietly). A node's refusal is a `NodeApiError` with the node's `code`, such as `not_found`.

There is no `createRoom`: rooms exist from the first join. Room-level settings such as an empty timeout are not configurable per room in the cloud.

## Hosted services

Every service is billed from the project's balance at the rates in the dashboard. Errors are `CloudApiError`s, as for tokens; `id` names the job or request when the cloud returns one. A 422 `backend_rejected` carries `detail`, what the backend said about the input, such as an SSML error: `{ code, message, position }`.

Calls that upload or start work take an `idempotencyKey`. Reuse the same key to retry the same call: the cloud returns the first result instead of charging twice. File jobs accept 1-128 printable ASCII characters; translation, vision and moderation accept 1-128 letters, digits, underscores or hyphens. The SDK checks the key before sending and never retries by itself.

Media can be a `Blob` or bytes, such as a Node `Buffer`. Responses are camelCase, with `Date`s for times; charges are microcredits as decimal strings.

### Live speech-to-text and text-to-speech

A speech session is prepaid: STT by time, TTS by characters. Open a WebSocket to `streamUrl` and send `token` as the `session_key` of the speech server protocol. A key serves one connection: after a disconnect, create a new session. Pass the participant's WebRTC `sessionId` to link the speech to its room.

```typescript
const stt = await cloud.stt.createSession({ duration: '30m', language: 'en', webrtcSessionId: sessionId });
const tts = await cloud.tts.createSession({ maxCharacters: 5000, voice: 'af_heart', webrtcSessionId: sessionId });
```

Extend before it runs out, then send the new token to the open socket as `{ type: 'extend', session_key: token }`. Time and characters a session does not use are released when it ends.

```typescript
const { token } = await cloud.stt.extend(stt.sessionId, '10m');
const { token: ttsToken, maxCharacters } = await cloud.tts.extend(tts.sessionId, 5000);
```

### File transcription

Upload audio or video (up to 256 MiB) and poll the job. Speaker diarization is on unless `diarize: false`.

```typescript
let job = await cloud.transcriptions.create({
  file: await fs.promises.readFile('call.mp3'),
  filename: 'call.mp3',
  idempotencyKey: 'call-2026-11-10',
});
while (!['completed', 'failed', 'cancelled'].includes(job.status)) {
  await new Promise((r) => setTimeout(r, 2000));
  job = await cloud.transcriptions.get(job.id);
}
console.log(job.result?.text, job.result?.segments);
```

`cloud.transcriptions.delete(id)` cancels unfinished work or deletes a finished result; a finished job keeps its charge.

### WAV synthesis

Text or SSML becomes a 48 kHz mono PCM16 WAV file.

```typescript
let wav = await cloud.wav.create({ text: 'Hello from dTelecom', voice: 'af_heart', idempotencyKey: 'greeting-1' });
// poll cloud.wav.get(wav.id) until completed, then:
const audio = await cloud.wav.download(wav.id); // a fetch Response
await fs.promises.writeFile('greeting.wav', Buffer.from(await audio.arrayBuffer()));
```

### Translation

Billed per Unicode code point of `q`. The source language is detected unless you pass `source`.

```typescript
const translation = await cloud.translate({ q: 'Hello', target: 'es', idempotencyKey: 'msg-42-es' });
// status 'running': call translate again with the same key, or poll cloud.getTranslation(translation.id)
console.log(translation.result?.translatedText);
```

### Vision

Ask a question about an image (up to 6 MiB) from a camera or a shared screen.

```typescript
const snapshot = await cloud.vision.snapshot({
  image: frameBytes,
  question: 'How many people are in the room?',
  source: 'camera',
  idempotencyKey: 'frame-1001',
  webrtcSessionId: sessionId, // optional: links it to the room
});
console.log(snapshot.result?.answer);
```

### Content moderation

Moderate an audio chunk (mono PCM16 at 16 kHz, up to 30 seconds) or a video frame. `decision` is `pass` or `flag`.

```typescript
const audio = await cloud.moderation.audio({ audio: pcm, language: 'en', idempotencyKey: 'chunk-7' });
const frame = await cloud.moderation.videoFrame({ image: jpeg, idempotencyKey: 'frame-7' });
console.log(audio.result?.decision, audio.result?.transcript, frame.result?.imageScreening);
```

For a steady flow, use a WebSocket from your backend. Items go one at a time and each is billed like the HTTP call. Node 22 has a global `WebSocket`; on older Node pass a factory, such as one from the `ws` package.

```typescript
const stream = await cloud.moderation.stream(); // or stream({ socketFactory: (url) => new WebSocket(url) })
const result = await stream.sendAudio('chunk-8', pcm, 'en');
const frameResult = await stream.sendVideoFrame('frame-8', jpeg);
stream.close();
```

Moderation runs on your backend: it gets the media (a bot subscribed to the room's tracks, or your own upload), sends it here, and acts on `flag` with its own code, such as `roomService().mutePublishedTrack` or `removeParticipant`. Results that only reach a user's device can be ignored there.

## Webhooks

Nodes POST room events to the URLs in a participant's token. Pass them when creating the token:

```typescript
await cloud.createToken({
  room,
  identity,
  webhookUrls: ['https://your-app.example/api/webhook'],
});
```

Events arrive for that participant: `participant_joined`, `participant_left`, `track_published`, `track_unpublished`, plus `room_started` and `room_finished`. Each delivery is signed by the sending node. `WebhookReceiver` checks the node against the node registry, verifies the signature and the body hash, and decodes the event. It needs the raw request body.

```typescript
import { WebhookReceiver } from '@dtelecom/server-sdk-js';

const receiver = new WebhookReceiver();

app.post('/api/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const event = await receiver.receive(req.body.toString(), req.get('Authorization'));
    console.log(event.event, event.room?.name, event.participant?.identity);
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(400);
  }
});
```

The receiver reads the node registry on Solana. On the production network nothing needs configuring. On a test network set `SOLANA_REGISTRY_AUTHORITY` (and `SOLANA_NETWORK_HOST_HTTP`, `SOLANA_CONTRACT_ADDRESS` when they differ) to that network's values.

`participant.rttMs` is the participant's round-trip time to the node, set on `participant_left` after a few seconds of connection. `room.key` identifies the project room.

## Migrating from 3.x

| 3.x | 4.x |
| --- | --- |
| `new AccessToken(apiKey, apiSecret, { identity, ttl, webHookURL })` + `addGrant` + `toJwt()` | `cloud.createToken({ room, identity, ttl, webhookUrls, grants })` |
| `at.getWsUrl(clientIp)` | `wsUrl` from `createToken({ clientIp })` |
| `at.getApiUrl()` + `new RoomServiceClient(apiUrl, apiKey, apiSecret)` | `cloud.roomService()` |
| `svc.createRoom(...)`, `svc.listRooms()` | removed; rooms exist from the first join |
| `EgressClient`, `IngressClient` | removed |
| `new WebhookReceiver(apiKey, apiSecret)` | `new WebhookReceiver()` (arguments still accepted) |
| `API_KEY`, `API_SECRET` env vars | `DTELECOM_API_KEY`, `DTELECOM_API_SECRET`, `DTELECOM_CLOUD_URL` |

## License

Apache 2.0
