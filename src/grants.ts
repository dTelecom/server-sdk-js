/** @typedef {Object} VideoGrant
 * @property {boolean} [roomCreate] - permission to create a room
 * @property {boolean} [roomJoin] - permission to join a room as a participant, room must be set
 * @property {boolean} [roomList] - permission to list rooms
 * @property {boolean} [roomRecord] - permission to start a recording
 * @property {boolean} [roomAdmin] - permission to control a specific room, room must be set
 * @property {string} [room] - name of the room, must be set for admin or join permissions
 * @property {boolean} [ingressAdmin] - permissions to control ingress, not specific to any room or ingress
 * @property {boolean} [canPublish] - allow participant to publish. If neither canPublish or canSubscribe is set, both publish and subscribe are enabled
 * @property {boolean} [canSubscribe] - allow participant to subscribe to other tracks
 * @property {boolean} [canPublishData] - allow participants to publish data, defaults to true if not set
 * @property {boolean} [hidden] - participant isn't visible to others
 * @property {boolean} [recorder] - participant is recording the room, when set, allows room to indicate it's being recorded
 */

/** @typedef {Object} ClaimGrants
 * @property {VideoGrant} [video]
 * @property {string} [metadata]
 * @property {string} [name]
 * @property {string} [sha256]
 * @property {string} [webHookURL]
 * @property {string} [iss] - Issuer
 * @property {string} [sub] - Subject
 * @property {number} [exp] - Expiration time
 * @property {number} [nbf] - Not before time
 * @property {number} [iat] - Issued at
 * @property {string} [jti] - JWT ID
 */

export interface VideoGrant {
  /** permission to create a room */
  roomCreate?: boolean;

  /** permission to join a room as a participant, room must be set */
  roomJoin?: boolean;

  /** permission to list rooms */
  roomList?: boolean;

  /** permission to start a recording */
  roomRecord?: boolean;

  /** permission to control a specific room, room must be set */
  roomAdmin?: boolean;

  /** name of the room, must be set for admin or join permissions */
  room?: string;

  /** permissions to control ingress, not specific to any room or ingress */
  ingressAdmin?: boolean;

  /**
   * allow participant to publish. If neither canPublish or canSubscribe is set,
   * both publish and subscribe are enabled
   */
  canPublish?: boolean;

  /** allow participant to subscribe to other tracks */
  canSubscribe?: boolean;

  /**
   * allow participants to publish data, defaults to true if not set
   */
  canPublishData?: boolean;

  /** participant isn't visible to others */
  hidden?: boolean;

  /** participant is recording the room, when set, allows room to indicate it's being recorded */
  recorder?: boolean;
}

/** @internal */
export interface ClaimGrants {
  video?: VideoGrant;
  metadata?: string;
  name?: string;
  sha256?: string;
  webHookURL?: string;
  // Standard JWT claims
  iss?: string;  // Issuer
  sub?: string;  // Subject
  exp?: number;  // Expiration time
  nbf?: number;  // Not before time
  iat?: number;  // Issued at
  jti?: string;  // JWT ID
}
