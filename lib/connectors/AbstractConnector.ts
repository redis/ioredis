import { NetStream } from "../types";
import { Debug } from "../utils";

const debug = Debug("AbstractConnector");

export type ErrorEmitter = (type: string, err: Error) => void;

export default abstract class AbstractConnector {
  private disconnectTimeout: number;
  protected connecting = false;
  protected stream: NetStream;
  public firstError?: Error;

  constructor(disconnectTimeout: number) {
    this.disconnectTimeout = disconnectTimeout;
  }

  public check(info: any): boolean {
    return true;
  }

  public disconnect(): void {
    this.connecting = false;

    if (this.stream) {
      const stream = this.stream; // Make sure callbacks refer to the same instance

      const timeout = setTimeout(() => {
        debug(
          "stream %s:%s still open, destroying it",
          stream.remoteAddress,
          stream.remotePort
        );

        stream.destroy();
      }, this.disconnectTimeout);

      stream.on("close", () => clearTimeout(timeout));
      stream.end();
    }
  }

  public abstract connect(_: ErrorEmitter): Promise<NetStream>;
}
