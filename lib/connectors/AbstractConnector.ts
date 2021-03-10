import { NetStream } from "../types";

export type ErrorEmitter = (type: string, err: Error) => void;

export default abstract class AbstractConnector {
  protected connecting = false;

  public check(info: any): boolean {
    return true;
  }

  public disconnect(): void {
    this.connecting = false;
  }

  public abstract connect(_: ErrorEmitter): Promise<() => NetStream>;
}
