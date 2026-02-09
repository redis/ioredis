import { createConnection, IpcNetConnectOpts, TcpNetConnectOpts } from "net";
import { connect as createTLSConnection, ConnectionOptions } from "tls";
import { NetStream } from "../types";
import { CONNECTION_CLOSED_ERROR_MSG } from "../utils";
import AbstractConnector, { ErrorEmitter } from "./AbstractConnector";

type TcpOptions = Pick<TcpNetConnectOpts, "port" | "host" | "family">;
type IpcOptions = Pick<IpcNetConnectOpts, "path">;

export type StandaloneConnectionOptions = Partial<TcpOptions & IpcOptions> & {
  disconnectTimeout?: number | undefined;
  tls?: ConnectionOptions | undefined;
};

export default class StandaloneConnector extends AbstractConnector {
  constructor(protected options: StandaloneConnectionOptions) {
    super(options.disconnectTimeout);
  }

  connect(_: ErrorEmitter) {
    const { options } = this;
    this.connecting = true;

    let connectionOptions: TcpOptions | IpcOptions;
    if ("path" in options && options.path) {
      connectionOptions = {
        path: options.path,
      } as IpcOptions;
    } else {
      connectionOptions = {} as TcpOptions;
      if ("port" in options && options.port != null) {
        connectionOptions.port = options.port;
      }
      if ("host" in options && options.host != null) {
        connectionOptions.host = options.host;
      }
      if ("family" in options && options.family != null) {
        connectionOptions.family = options.family;
      }
    }

    if (options.tls) {
      Object.assign(connectionOptions, options.tls);
    }

    // TODO:
    // We use native Promise here since other Promise
    // implementation may use different schedulers that
    // cause issue when the stream is resolved in the
    // next tick.
    // Should use the provided promise in the next major
    // version and do not connect before resolved.
    return new Promise<NetStream>((resolve, reject) => {
      process.nextTick(() => {
        if (!this.connecting) {
          reject(new Error(CONNECTION_CLOSED_ERROR_MSG));
          return;
        }

        try {
          if (options.tls) {
            this.stream = createTLSConnection(connectionOptions);
          } else {
            this.stream = createConnection(connectionOptions);
          }
        } catch (err) {
          reject(err);
          return;
        }

        this.stream.once("error", (err) => {
          this.firstError = err;
        });

        resolve(this.stream);
      });
    });
  }
}
