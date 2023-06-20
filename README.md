# Server API for JS

Javascript/Typescript APIs to manage rooms and to create access tokens.

## Installation

### Yarn

```
yarn add @dtelecom/server-sdk-js
```

### NPM

```
npm install @dtelecom/server-sdk-js --save
```

## Usage

### Environment Variables

You may store credentials in environment variables. If api-key or api-secret is not passed in when creating a `RoomServiceClient` or `AccessToken`, the values in the following env vars will be used:

- `API_KEY`
- `API_SECRET`

### CommonJS

If your environment doesn't support ES6 imports, replace the import statements in the examples with

```javascript
const serverJsSdkApi = require('@dtelecom/server-sdk-js');
const AccessToken = serverJsSdkApi.AccessToken;
const RoomServiceClient = serverJsSdkApi.RoomServiceClient;
```

### Creating Access Tokens

Creating a token for participant to join a room.

```typescript
import { AccessToken } from '@dtelecom/server-sdk-js';

// if this room doesn't exist, it'll be automatically created when the first
// client joins
const roomName = 'name-of-room';
// identifier to be used for participant.
// it's available as LocalParticipant.identity with client SDK
const participantName = 'user-name';

const at = new AccessToken('api-key', 'secret-key', {
  identity: participantName,
});
at.addGrant({ roomJoin: true, room: roomName });

const token = at.toJwt();
console.log('access token', token);
```

By default, the token expires after 6 hours. you may override this by passing in `ttl` in the access token options. `ttl` is expressed in seconds (as number) or a string describing a time span [vercel/ms](https://github.com/vercel/ms). eg: '2 days', '10h'.

### Permissions in Access Tokens

It's possible to customize the permissions of each participant:

```typescript
const at = new AccessToken('api-key', 'secret-key', {
  identity: participantName,
});

at.addGrant({
  roomJoin: true,
  room: roomName,
  canPublish: false,
  canSubscribe: true,
});
```

This will allow the participant to subscribe to tracks, but not publish their own to the room.

### Managing Rooms

`RoomServiceClient` gives you APIs to list, create, and delete rooms. It also requires a pair of api key/secret key to operate.

```typescript
import { RoomServiceClient, Room } from '@dtelecom/server-sdk-js';
const host = 'https://my.host';
const svc = new RoomServiceClient(host, 'api-key', 'secret-key');

// list rooms
svc.listRooms().then((rooms: Room[]) => {
  console.log('existing rooms', rooms);
});

// create a new room
const opts = {
  name: 'myroom',
  // timeout in seconds
  emptyTimeout: 10 * 60,
  maxParticipants: 20,
};
svc.createRoom(opts).then((room: Room) => {
  console.log('room created', room);
});

// delete a room
svc.deleteRoom('myroom').then(() => {
  console.log('room deleted');
});
```

## Webhooks

The JS SDK also provides helper functions to decode and verify webhook callbacks. While verification is optional, it ensures the authenticity of the message.

Check out [example projects](examples) for full examples of webhooks integration.

```typescript
import { WebhookReceiver } from '@dtelecom/server-sdk-js';

const receiver = new WebhookReceiver('apikey', 'apisecret');

// In order to use the validator, WebhookReceiver must have access to the raw POSTed string (instead of a parsed JSON object)
// if you are using express middleware, ensure that `express.raw` is used for the webhook endpoint
// router.use('/webhook/path', express.raw());

app.post('/webhook-endpoint', (req, res) => {
  // event is a WebhookEvent object
  const event = receiver.receive(req.body, req.get('Authorization'));
});
```
