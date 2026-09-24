import {
  authContext,
  deriveRoomKey,
  isNonce,
  isRecord,
  randomHex,
  ROOM_PATTERN,
  sign,
  SignedChannel,
  usernameError,
  passwordError,
  type RoutedMedia
} from "../protocol";
import { RoomSession, type SessionEvents } from "./room-session";
import { Transport, openSignaling } from "./transport";
import { CONNECTION_TIMEOUT } from "./constants";

export class ViewerSession extends RoomSession {
  private transport?: Transport;
  private timer?: ReturnType<typeof setTimeout>;
  private ready = false;

  static async join(
    roomId: string,
    password: string,
    username: string,
    events: SessionEvents
  ) {
    if (!ROOM_PATTERN.test(roomId))
      throw new Error(
        "This invitation is invalid. Ask the host for a new link."
      );
    const issue = passwordError(password) || usernameError(username);
    if (issue) throw new Error(issue);
    const key = await deriveRoomKey(password, roomId);
    const socket = await openSignaling(`viewer-${randomHex(16)}`, events);
    const session = new ViewerSession(socket, events);
    try {
      session.connect(roomId, key, username.trim());
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  protected route(message: RoutedMedia) {
    return this.transport!.send(message);
  }
  protected announce() {
    if (!this.ready)
      return Promise.reject(new Error("Join the session before sharing."));
    return this.transport!.send({ type: "publish", streamId: this.streamId });
  }
  private fail(message: string) {
    if (this.closed) return;
    this.signalingState = "failed";
    this.close();
    this.events.error(message);
  }

  private connect(roomId: string, key: CryptoKey, username: string) {
    const nonce = randomHex();
    let challenged = false;
    const transport = new Transport(
      roomId,
      this.socket,
      async (message) => {
        if (!isRecord(message)) throw new Error("Invalid session message.");
        if (!challenged) {
          if (message.type !== "challenge" || !isNonce(message.nonce))
            throw new Error("Invalid challenge.");
          challenged = true;
          const context = authContext(roomId, this.id, nonce, message.nonce);
          transport.channel = new SignedChannel(key, context, "viewer");
          const proof = await sign(key, `${context}:join`);
          if (this.closed) return;
          transport.raw({ type: "auth", proof });
          await transport.send({ type: "profile", username });
        } else if (message.type === "rejected" && !this.ready) {
          this.fail("Incorrect password. Check with the host and try again.");
        } else {
          const signal = await transport.channel!.unpack(message);
          if (this.closed) return;
          if (signal.type === "ended") {
            this.close();
            this.events.ended();
          } else if (signal.type === "roster") {
            if (
              !signal.participants.some((p) => p.id === this.id) ||
              signal.participants[0]?.id !== roomId
            )
              throw new Error("Invalid session membership.");
            clearTimeout(this.timer);
            if (!this.ready) transport.startHeartbeat();
            this.ready = true;
            this.signalingState = "ready";
            this.setRoster(signal.participants);
            this.reportDiagnostics();
            this.events.ready();
          } else if (this.ready && (await transport.control(signal))) return;
          else if (signal.type === "media" && this.ready)
            await this.receiveMedia(signal);
          else throw new Error("Unexpected session message.");
        }
      },
      () =>
        this.fail(
          "The session signaling was interrupted or could not be authenticated. Please reconnect."
        )
    );
    this.transport = transport;
    this.socket.onmessage = (from, message) => {
      if (from === roomId) transport.receive(message);
    };
    this.reportDiagnostics();
    transport.raw({ type: "hello", nonce });
    this.timer = setTimeout(
      () =>
        this.fail(
          "The host is offline or not responding over WebSocket. Check the invitation and try again."
        ),
      CONNECTION_TIMEOUT
    );
  }

  close() {
    if (this.closed) return;
    this.cleanup();
    clearTimeout(this.timer);
    const finish = () => {
      this.transport?.close();
      this.socket.close();
    };
    if (this.ready && this.socket.state === "open")
      void this.transport!.send({ type: "ended" })
        .catch(() => {})
        .finally(finish);
    else finish();
  }
}
