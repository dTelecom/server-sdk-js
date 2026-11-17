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
 * cloud. The admin token lists the nodes hosting the room's participants. A node answers reads
 * from its own participants only, and applies a change to a participant only when it hosts that
 * participant, so calls about a participant go to its node, room-wide calls to one hosting node,
 * and `listParticipants` to all of them.
 */
export class RoomServiceClient {
  private readonly cloud: CloudClient;

  private readonly admin = new Map<string, AdminToken>();

  constructor(cloud: CloudClient) {
    this.cloud = cloud;
  }

  /** Ends the room. A room nobody joined is already gone. */
  async deleteRoom(room: string): Promise<void> {
    const nodes = await this.nodes(room);
    if (nodes.apiUrls.length === 0) return;
    await this.onAnyNode(nodes, 'DeleteRoom', DeleteRoomRequest.toJSON({ room }));
  }

  /** Lists the joined participants across the room's nodes. */
  async listParticipants(room: string): Promise<ParticipantInfo[]> {
    const nodes = await this.nodes(room);
    if (nodes.apiUrls.length === 0) return [];
    const lists = await this.participantsByNode(nodes, room);
    return lists.flatMap((l) => l.participants);
  }

  /**
   * Sets the room's metadata and returns the room. Nodes released before 2026-11-17 answer with
   * an empty `Room`, although the metadata is set.
   */
  async updateRoomMetadata(room: string, metadata: string): Promise<Room> {
    const nodes = await this.liveNodes(room);
    const data = await this.onAnyNode(
      nodes,
      'UpdateRoomMetadata',
      UpdateRoomMetadataRequest.toJSON({ room, metadata }),
    );
    return Room.fromJSON(data);
  }

  async getParticipant(room: string, identity: string): Promise<ParticipantInfo> {
    const data = await this.onParticipantNode(
      room,
      identity,
      'GetParticipant',
      RoomParticipantIdentity.toJSON({ room, identity }),
    );
    return ParticipantInfo.fromJSON(data);
  }

  /** Disconnects a participant. They can join again with a valid token. */
  async removeParticipant(room: string, identity: string): Promise<void> {
    await this.onParticipantNode(
      room,
      identity,
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
    const data = await this.onParticipantNode(
      room,
      identity,
      'MutePublishedTrack',
      MuteRoomTrackRequest.toJSON({ room, identity, trackSid, muted }),
    );
    return MuteRoomTrackResponse.fromJSON(data).track!;
  }

  /**
   * Changes a participant's metadata, permissions or name and returns the participant. Nodes
   * released before 2026-11-17 answer with an empty `ParticipantInfo`, although the change is
   * applied.
   */
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
    const data = await this.onParticipantNode(
      room,
      identity,
      'UpdateParticipant',
      UpdateParticipantRequest.toJSON(req),
    );
    return ParticipantInfo.fromJSON(data);
  }

  /**
   * Subscribes a participant to tracks, or unsubscribes it. Tracks are sent grouped by their
   * publisher, which every node release accepts.
   */
  async updateSubscriptions(
    room: string,
    identity: string,
    trackSids: string[],
    subscribe: boolean,
  ): Promise<void> {
    const nodes = await this.liveNodes(room);
    const lists = await this.participantsByNode(nodes, room);
    const owner = new Map<string, string>();
    let subscriberNode = nodes.apiUrls[0];
    lists.forEach((l) =>
      l.participants.forEach((p) => {
        if (p.identity === identity) subscriberNode = l.apiUrl;
        p.tracks.forEach((t) => owner.set(t.sid, p.sid));
      }),
    );
    const grouped = new Map<string, string[]>();
    trackSids.forEach((sid) => {
      const participantSid = owner.get(sid);
      if (!participantSid) {
        throw new Error(`track ${sid} is not published in room ${JSON.stringify(room)}`);
      }
      grouped.set(participantSid, [...(grouped.get(participantSid) ?? []), sid]);
    });
    await this.call(
      subscriberNode,
      nodes.token,
      'UpdateSubscriptions',
      UpdateSubscriptionsRequest.toJSON({
        room,
        identity,
        trackSids: [],
        subscribe,
        participantTracks: [...grouped].map(([participantSid, sids]) => ({
          participantSid,
          trackSids: sids,
        })),
      }),
    );
  }

  /**
   * Sends a data message to the room, or to `destinationSids` only. The node that takes it
   * delivers it to its participants and relays it to the room's other nodes, so it goes to one
   * hosting node.
   */
  async sendData(
    room: string,
    data: Uint8Array,
    kind: DataPacket_Kind,
    options: SendDataOptions | string[] = {},
  ): Promise<void> {
    const destinationSids = Array.isArray(options) ? options : options.destinationSids;
    const topic = Array.isArray(options) ? undefined : options.topic;
    const nodes = await this.liveNodes(room);
    await this.onAnyNode(
      nodes,
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
    // A room nobody has joined yet has no nodes; ask again next time instead of caching that.
    if (fresh.apiUrls.length > 0) this.admin.set(room, fresh);
    return fresh;
  }

  /** `nodes` for calls that need a joined participant. */
  private async liveNodes(room: string): Promise<AdminToken> {
    const nodes = await this.nodes(room);
    if (nodes.apiUrls.length === 0) {
      throw new RoomNotLiveError(room);
    }
    return nodes;
  }

  /** Asks every hosting node for its participants; throws the first error when none answered. */
  private async participantsByNode(
    nodes: AdminToken,
    room: string,
  ): Promise<{ apiUrl: string; participants: ParticipantInfo[] }[]> {
    const settled = await Promise.allSettled(
      nodes.apiUrls.map(async (apiUrl) => {
        const data = await this.call(
          apiUrl,
          nodes.token,
          'ListParticipants',
          ListParticipantsRequest.toJSON({ room }),
        );
        return { apiUrl, participants: ListParticipantsResponse.fromJSON(data).participants ?? [] };
      }),
    );
    const lists = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (lists.length === 0) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    return lists;
  }

  /**
   * Runs a call on the node hosting the participant. With several nodes it finds that node from
   * their participant lists; when none lists the participant, the first node answers.
   */
  private async onParticipantNode(
    room: string,
    identity: string,
    method: string,
    body: unknown,
  ): Promise<any> {
    const nodes = await this.liveNodes(room);
    let target = nodes.apiUrls[0];
    if (nodes.apiUrls.length > 1) {
      const lists = await this.participantsByNode(nodes, room);
      const found = lists.find((l) => l.participants.some((p) => p.identity === identity));
      if (found) target = found.apiUrl;
    }
    return this.call(target, nodes.token, method, body);
  }

  /**
   * Runs a room-wide call on the first hosting node that answers. A client error (4xx) is final;
   * an unreachable node or a server error moves on to the next node.
   */
  private async onAnyNode(nodes: AdminToken, method: string, body: unknown): Promise<any> {
    let firstError: unknown;
    for (const apiUrl of nodes.apiUrls) {
      try {
        return await this.call(apiUrl, nodes.token, method, body);
      } catch (err) {
        if (err instanceof NodeApiError && err.status && err.status >= 400 && err.status < 500) {
          throw err;
        }
        if (firstError === undefined) firstError = err;
      }
    }
    throw firstError;
  }

  private async call(apiUrl: string, token: string, method: string, body: unknown): Promise<any> {
    try {
      return await new TwirpRpc(apiUrl, livekitPackage).request<any>(svc, method, body, {
        Authorization: `Bearer ${token}`,
      });
    } catch (err) {
      throw toNodeError(apiUrl, err);
    }
  }
}
