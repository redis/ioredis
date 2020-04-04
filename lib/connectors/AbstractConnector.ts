import { NetStream } from "../types";

export type ErrorEmitter = (type: string, err: Error) => void;

export default abstract class AbstractConnector {
  protected connecting = false;
  protected stream: NetStream;

  public check(info: any): boolean {
    return true;
  }

  public disconnect(): void {
    this.connecting = false;
    if (this.stream) {
      this.stream.end();
    }
  }

  public abstract connect(_: ErrorEmitter): Promise<NetStream>;
}
