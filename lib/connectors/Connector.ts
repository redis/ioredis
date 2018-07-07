import {createConnection, TcpNetConnectOpts, IpcNetConnectOpts, Socket} from 'net'
import {connect as createTLSConnection, SecureContextOptions, TLSSocket} from 'tls'
import {CONNECTION_CLOSED_ERROR_MSG} from '../utils/index'

export function isIIpcConnectionOptions (value: any): value is IIpcConnectionOptions {
  return value.hasOwnProperty('path')
}

export interface ITcpConnectionOptions extends TcpNetConnectOpts {
  tls?: SecureContextOptions
}

export interface IIpcConnectionOptions extends IpcNetConnectOpts {
  tls?: SecureContextOptions
}

export type ErrorEmitter = (type: string, err: Error) => void

export default class Connector {
  protected connecting: boolean = false
  protected stream: Socket | TLSSocket

  constructor (protected options: ITcpConnectionOptions | IIpcConnectionOptions) {}

  public check (info: any): boolean {
    return true
  }

  public disconnect (): void {
    this.connecting = false
    if (this.stream) {
      this.stream.end()
    }
  }

  public connect (callback: Function, _: ErrorEmitter) {
    const {options} = this
    this.connecting = true

    let connectionOptions: any
    if (isIIpcConnectionOptions(options)) {
      connectionOptions = {
        path: options.path
      }
    } else {
      connectionOptions = {
        port: options.port,
        host: options.host,
        family: options.family
      }
    }

    if (options.tls) {
      Object.assign(connectionOptions, options.tls)
    }
  
    process.nextTick(() => {
      if (!this.connecting) {
        callback(new Error(CONNECTION_CLOSED_ERROR_MSG))
        return
      }

      let stream: Socket | TLSSocket
      try {
        if (options.tls) {
          stream = createTLSConnection(connectionOptions)
        } else {
          stream = createConnection(connectionOptions)
        }
      } catch (err) {
        callback(err)
        return
      }
  
      this.stream = stream
      callback(null, stream)
    })
  }
}