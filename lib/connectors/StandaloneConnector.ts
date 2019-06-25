import {createConnection, TcpNetConnectOpts, IpcNetConnectOpts} from 'net'
import {connect as createTLSConnection, SecureContextOptions} from 'tls'
import {CONNECTION_CLOSED_ERROR_MSG} from '../utils'
import AbstractConnector, {ErrorEmitter} from './AbstractConnector'
import * as PromiseContainer from '../promiseContainer';
import {NetStream} from '../types'

export function isIIpcConnectionOptions (value: any): value is IIpcConnectionOptions {
  return value.path
}

export interface ITcpConnectionOptions extends TcpNetConnectOpts {
  tls?: SecureContextOptions
}

export interface IIpcConnectionOptions extends IpcNetConnectOpts {
  tls?: SecureContextOptions
}

export default class StandaloneConnector extends AbstractConnector {
  constructor (protected options: ITcpConnectionOptions | IIpcConnectionOptions) {
    super()
  }

  public connect (_: ErrorEmitter) {
    const {options} = this
    this.connecting = true

    let connectionOptions: any
    if (isIIpcConnectionOptions(options)) {
      connectionOptions = {
        path: options.path
      }
    } else {
      connectionOptions = {}
      if (options.port != null) {
        connectionOptions.port = options.port
      }
      if (options.host != null) {
        connectionOptions.host = options.host
      }
      if (options.family != null) {
        connectionOptions.family = options.family
      }
    }

    if (options.tls) {
      Object.assign(connectionOptions, options.tls)
    }
    
    const _Promise = PromiseContainer.get();
    return new _Promise<NetStream>((resolve, reject) => {
      process.nextTick(() => {
        if (!this.connecting) {
          reject(new Error(CONNECTION_CLOSED_ERROR_MSG))
          return
        }

        try {
          if (options.tls) {
            this.stream = createTLSConnection(connectionOptions)
          } else {
            this.stream = createConnection(connectionOptions)
          }
        } catch (err) {
          reject(err)
          return
        }

        resolve(this.stream)
      })
    })
  }
}
