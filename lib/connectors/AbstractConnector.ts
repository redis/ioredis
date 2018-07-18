import {Socket} from 'net'
import {TLSSocket} from 'tls'

export type ErrorEmitter = (type: string, err: Error) => void

export default abstract class AbstractConnector {
  protected connecting: boolean = false
  protected stream: Socket | TLSSocket

  public check (info: any): boolean {
    return true
  }

  public disconnect (): void {
    this.connecting = false
    if (this.stream) {
      this.stream.end()
    }
  }

  public abstract connect (callback: Function, _: ErrorEmitter)
}