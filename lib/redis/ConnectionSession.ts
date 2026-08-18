import { Condition } from "../DataHandler";
import AbstractConnector from "../connectors/AbstractConnector";
import { NetStream } from "../types";

/**
 * The endpoint a Smart Client Handoff moves the connection to.
 */
export interface HandoffEndpoint {
  host: string;
  port: number;
}

/**
 * A fully handshaken connection detached from the temporary client that
 * established it, ready to be adopted by the original client. Carries
 * everything that defines the physical connection: the socket, the connector
 * that can re-establish it, and the negotiated connection state.
 */
export interface DetachedTransport {
  stream: NetStream;
  connector: AbstractConnector;
  condition: Condition;
}

/**
 * A ready candidate connection that is still owned (and monitored) by the
 * temporary client that established it. The transport is detached only at
 * the moment of adoption, so the socket is never left without error
 * handling; detaching throws if the candidate died in the meantime.
 */
export interface HandoffCandidate {
  detachTransport(): DetachedTransport;
  dispose(): void;
}
