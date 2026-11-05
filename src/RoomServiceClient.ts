import axios from 'axios';

import type { AdminToken, CloudClient } from './CloudClient.js';
import {
  DataPacket_Kind,
  ParticipantInfo,
  ParticipantPermission,
  Room,
  TrackInfo,
} from './proto/livekit_models.js';
import {
  DeleteRoomRequest,
  ListParticipantsRequest,
  ListParticipantsResponse,
  MuteRoomTrackRequest,
  MuteRoomTrackResponse,
  RoomParticipantIdentity,
  SendDataRequest,
  UpdateParticipantRequest,
  UpdateRoomMetadataRequest,
  UpdateSubscriptionsRequest,
} from './proto/livekit_room.js';
import { livekitPackage, TwirpRpc } from './TwirpRPC.js';

export type SendDataOptions = { destinationSids?: string[]; topic?: string };

const svc = 'RoomService';
const tokenRefreshMarginMs = 60 * 1000;

/** A node refused or failed a room API call. `code` is the Twirp error code, such as `not_found`. */
export class NodeApiError extends Error {
  readonly apiUrl: string;

  readonly status?: number;

  readonly code?: string;

  constructor(apiUrl: string, message: string, status?: number, code?: string) {
    super(`${apiUrl}: ${message}`);
    this.name = 'NodeApiError';
    this.apiUrl = apiUrl;
    this.status = status;
    this.code = code;
  }
}

/** The room has no joined participant, so there is no node to call. */
export class RoomNotLiveError extends Error {
  constructor(room: string) {
    super(`room ${JSON.stringify(room)} has no joined participants`);
    this.name = 'RoomNotLiveError';
  }
}

function toNodeError(apiUrl: string, err: unknown): NodeApiError {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { code?: string; msg?: string } | undefined;
    return new NodeApiError(apiUrl, data?.msg || err.message, err.response?.status, data?.code);
  }
  return new NodeApiError(apiUrl, err instanceof Error ? err.message : String(err));
}

/**
 * Room administration through the nodes' Twirp API, authorised with admin tokens from the
 * cloud. A room's participants can sit on more than one node, so every call goes to each node
 * hosting the room; a call succeeds when at least one node accepts it.
 */
export class RoomServiceClient {
  private readonly cloud: CloudClient;

  private readonly admin = new Map<string, AdminToken>();

  constructor(cloud: CloudClient) {
    this.cloud = cloud;
  }

  /** Ends the room on every node hosting it. A room nobody joined is already gone. */
  async deleteRoom(room: string): Promise<void> {
    const nodes = await this.nodes(room);
    if (nodes.apiUrls.length === 0) return;
    await this.onEachNode(nodes, 'DeleteRoom', DeleteRoomRequest.toJSON({ room }));
  }

  /** Lists the joined participants across the room's nodes. */
  async listParticipants(room: string): Promise<ParticipantInfo[]> {
    const nodes = await this.nodes(room);
    if (nodes.apiUrls.length === 0) return [];
    const results = await this.onEachNode<any>(
      nodes,
      'ListParticipants',
      ListParticipantsRequest.toJSON({ room }),
    );
    return results.flatMap((data) => ListParticipantsResponse.fromJSON(data).participants ?? []);
  }

  async updateRoomMetadata(room: string, metadata: string): Promise<Room> {
    const data = await this.onRoom(
      room,
      'UpdateRoomMetadata',
      UpdateRoomMetadataRequest.toJSON({ room, metadata }),
    );
    return Room.fromJSON(data);
  }

  async getParticipant(room: string, identity: string): Promise<ParticipantInfo> {
    const data = await this.onRoom(
      room,
      'GetParticipant',
      RoomParticipantIdentity.toJSON({ room, identity }),
    );
    return ParticipantInfo.fromJSON(data);
  }

  /** Disconnects a participant. They can join again with a valid token. */
  async removeParticipant(room: string, identity: string): Promise<void> {
    await this.onRoom(
      room,
      'RemoveParticipant',
      RoomParticipantIdentity.toJSON({ room, identity }),
    );
  }

  async mutePublishedTrack(
    room: string,
    identity: string,
    trackSid: string,
    muted: boolean,
  ): Promise<TrackInfo> {
    const data = await this.onRoom(
      room,
      'MutePublishedTrack',
      MuteRoomTrackRequest.toJSON({ room, identity, trackSid, muted }),
    );
    return MuteRoomTrackResponse.fromJSON(data).track!;
  }

  async updateParticipant(
    room: string,
    identity: string,
    metadata?: string,
    permission?: ParticipantPermission,
    name?: string,
  ): Promise<ParticipantInfo> {
    const req: UpdateParticipantRequest = {
      room,
      identity,
      metadata: metadata || '',
      permission,
      name: name || '',
    };
    const data = await this.onRoom(room, 'UpdateParticipant', UpdateParticipantRequest.toJSON(req));
    return ParticipantInfo.fromJSON(data);
  }

  async updateSubscriptions(
    room: string,
    identity: string,
    trackSids: string[],
    subscribe: boolean,
  ): Promise<void> {
    await this.onRoom(
      room,
      'UpdateSubscriptions',
      UpdateSubscriptionsRequest.toJSON({
        room,
        identity,
        trackSids,
        subscribe,
        participantTracks: [],
      }),
    );
  }

  /** Sends a data message to the room, or to `destinationSids` only. */
  async sendData(
    room: string,
    data: Uint8Array,
    kind: DataPacket_Kind,
    options: SendDataOptions | string[] = {},
  ): Promise<void> {
    const destinationSids = Array.isArray(options) ? options : options.destinationSids;
    const topic = Array.isArray(options) ? undefined : options.topic;
    await this.onRoom(
      room,
      'SendData',
      SendDataRequest.toJSON({ room, data, kind, destinationSids: destinationSids ?? [], topic }),
    );
  }

  private async nodes(room: string): Promise<AdminToken> {
    const cached = this.admin.get(room);
    if (cached && cached.expiresAt.getTime() - Date.now() > tokenRefreshMarginMs) {
      return cached;
    }
    const fresh = await this.cloud.adminToken(room);
    this.admin.set(room, fresh);
    return fresh;
  }

  /** Calls every node; returns the successes, or throws the first error when none succeeded. */
  private async onEachNode<T>(nodes: AdminToken, method: string, body: unknown): Promise<T[]> {
    const headers = { Authorization: `Bearer ${nodes.token}` };
    const settled = await Promise.allSettled(
      nodes.apiUrls.map((apiUrl) =>
        new TwirpRpc(apiUrl, livekitPackage).request<T>(svc, method, body, headers).catch((err) => {
          throw toNodeError(apiUrl, err);
        }),
      ),
    );
    const ok: T[] = [];
    let firstError: unknown;
    settled.forEach((r) => {
      if (r.status === 'fulfilled') {
        ok.push(r.value as T);
      } else if (firstError === undefined) {
        firstError = r.reason;
      }
    });
    if (ok.length === 0) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError ?? 'no nodes'));
    }
    return ok;
  }

  /** Runs a call that must reach a live room and returns the first node's answer. */
  private async onRoom(room: string, method: string, body: unknown): Promise<any> {
    const nodes = await this.nodes(room);
    if (nodes.apiUrls.length === 0) {
      throw new RoomNotLiveError(room);
    }
    const [first] = await this.onEachNode<any>(nodes, method, body);
    return first;
  }
}
