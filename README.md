# dTelecom Cloud server SDK for JavaScript

`@dtelecom/server-sdk-js` 4.x talks to [dTelecom Cloud](https://dtelecom.org) from your backend: it issues participant tokens, extends sessions, administers rooms on the nodes and verifies webhooks.

Version 4 is for projects created in dTelecom Cloud, which have an API key and secret. If your project holds a Solana keypair and signs tokens itself, stay on 3.x.

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

A session ends when its token expires. Extend it before that; the client applies the new token on its next reconnect, so the current connection stays up.

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
