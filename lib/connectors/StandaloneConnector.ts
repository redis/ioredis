import { createConnection, TcpNetConnectOpts, IpcNetConnectOpts } from "net";
import { connect as createTLSConnection, ConnectionOptions } from "tls";
import { CONNECTION_CLOSED_ERROR_MSG } from "../utils";
import AbstractConnector, { ErrorEmitter } from "./AbstractConnector";
import { NetStream } from "../types";

export function isIIpcConnectionOptions(
  value: any
): value is IIpcConnectionOptions {
  return value.path;
}

export interface ITcpConnectionOptions extends TcpNetConnectOpts {
  tls?: ConnectionOptions;
}

export interface IIpcConnectionOptions extends IpcNetConnectOpts {
  tls?: ConnectionOptions;
}

export default class StandaloneConnector extends AbstractConnector {
  constructor(
    protected options: ITcpConnectionOptions | IIpcConnectionOptions
  ) {
    super();
  }

  public connect(_: ErrorEmitter) {
    const { options } = this;
    this.connecting = true;

    let connectionOptions: any;
    if (isIIpcConnectionOptions(options)) {
      connectionOptions = {
        path: options.path,
      };
    } else {
      connectionOptions = {};
      if (options.port != null) {
        connectionOptions.port = options.port;
      }
      if (options.host != null) {
        connectionOptions.host = options.host;
      }
      if (options.family != null) {
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
