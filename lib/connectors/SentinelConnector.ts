import {createConnection, Socket} from 'net'
import {bind, sample} from '../utils/lodash'
import {CONNECTION_CLOSED_ERROR_MSG, packObject} from '../utils/index'
import Connector, {ITcpConnectionOptions, IIpcConnectionOptions, ErrorEmitter, isIIpcConnectionOptions} from './Connector'
import { TLSSocket } from 'tls';
const debug = require('../utils/debug')('ioredis:SentinelConnector')

let Redis

interface ISentinelSlavesResponse {
  port: string,
  ip: string,
  flags?: string
}

interface ISentinelOptions {
  role: 'master' | 'slave'
  name: 'string'
  sentinels: any[]
  sentinelRetryStrategy?: (retryAttempts: number) => number
  preferredSlaves?:
    ((slaves: Array<ISentinelSlavesResponse>) => ISentinelSlavesResponse) |
    Array<{port: string, ip: string, prio?: number}> |
    {port: string, ip: string, prio?: number}
  connectTimeout?: number
}

type NodeCallback<T = void> = (err: Error | null, result?: T) => void

interface ISentinelTcpConnectionOptions extends ITcpConnectionOptions, ISentinelOptions {}
interface ISentinelIpcConnectionOptions extends IIpcConnectionOptions, ISentinelOptions {}

export default class SentinelConnector extends Connector {
  private retryAttempts: number
  private currentPoint: number = -1
  private sentinels: any[]

  constructor (protected options: ISentinelTcpConnectionOptions | ISentinelIpcConnectionOptions) {
    super(options)
    if (this.options.sentinels.length === 0) {
      throw new Error('Requires at least one sentinel to connect to.')
    }
    if (!this.options.name) {
      throw new Error('Requires the name of master.')
    }

    this.sentinels = this.options.sentinels
  }

  public check (info: {role?: string}): boolean {
    const roleMatches: boolean = !info.role || this.options.role === info.role
    if (!roleMatches) {
      debug('role invalid, expected %s, but got %s', this.options.role, info.role)
    }
    return roleMatches
  }

  connect (callback: NodeCallback<Socket | TLSSocket>, eventEmitter: ErrorEmitter): void {
    this.connecting = true
    this.retryAttempts = 0
  
    let lastError
    const _this = this
    connectToNext()
  
    function connectToNext() {
      _this.currentPoint += 1
      if (_this.currentPoint === _this.sentinels.length) {
        _this.currentPoint = -1
  
        const retryDelay = typeof _this.options.sentinelRetryStrategy === 'function'
          ? _this.options.sentinelRetryStrategy(++_this.retryAttempts)
          : null
  
        let errorMsg = typeof retryDelay !== 'number'
          ? 'All sentinels are unreachable and retry is disabled.'
          : `All sentinels are unreachable. Retrying from scratch after ${retryDelay}ms.`
  
        if (lastError) {
          errorMsg += ` Last error: ${lastError.message}`
        }
  
        debug(errorMsg)
  
        const error = new Error(errorMsg)
        if (typeof retryDelay === 'number') {
          setTimeout(connectToNext, retryDelay)
          eventEmitter('error', error)
        } else {
          callback(error)
        }
        return
      }
  
      const endpoint = _this.sentinels[_this.currentPoint]
      _this.resolve(endpoint, function (err, resolved) {
        if (!_this.connecting) {
          callback(new Error(CONNECTION_CLOSED_ERROR_MSG))
          return
        }
        if (resolved) {
          debug('resolved: %s:%s', resolved.host, resolved.port)
          _this.stream = createConnection(resolved)
          callback(null, _this.stream)
        } else {
          var endpointAddress = endpoint.host + ':' + endpoint.port
          var errorMsg = err
            ? 'failed to connect to sentinel ' + endpointAddress + ' because ' + err.message
            : 'connected to sentinel ' + endpointAddress + ' successfully, but got an invalid reply: ' + resolved
  
          debug(errorMsg)
  
          eventEmitter('sentinelError', new Error(errorMsg))
  
          if (err) {
            lastError = err
          }
          connectToNext()
        }
      })
    }
  }
  
  updateSentinels (client, callback: NodeCallback) {
    var _this = this
    client.sentinel('sentinels', this.options.name, function (err, result) {
      if (err) {
        client.disconnect()
        return callback(err)
      }
      if (Array.isArray(result)) {
        for (var i = 0; i < result.length; ++i) {
          var sentinel = packObject(result[i])
          var flags = sentinel.flags ? sentinel.flags.split(',') : []
          if (flags.indexOf('disconnected') === -1 && sentinel.ip && sentinel.port) {
            var endpoint = { host: sentinel.ip, port: parseInt(sentinel.port, 10) }
            var isDuplicate = _this.sentinels.some(bind(isSentinelEql, null, endpoint))
            if (!isDuplicate) {
              debug('adding sentinel %s:%s', endpoint.host, endpoint.port)
              _this.sentinels.push(endpoint)
            }
          }
        }
        debug('sentinels', _this.sentinels)
      }
      callback(null)
    })
  }
  
  resolveMaster (client, callback: NodeCallback<ITcpConnectionOptions>) {
    var _this = this
    client.sentinel('get-master-addr-by-name', this.options.name, function (err, result) {
      if (err) {
        client.disconnect()
        return callback(err)
      }
      _this.updateSentinels(client, function (err) {
        client.disconnect()
        if (err) {
          return callback(err)
        }
        callback(null, Array.isArray(result) ? { host: result[0], port: result[1] } : null)
      })
    })
  }
  
  resolveSlave (client, callback: NodeCallback<ITcpConnectionOptions>) {
    client.sentinel('slaves', this.options.name, (err, result) => {
      client.disconnect()
      if (err) {
        return callback(err)
      }
      let selectedSlave: ISentinelSlavesResponse
      if (Array.isArray(result)) {
        const availableSlaves: Array<{port: string, ip: string, flags?: string}> = []
        for (var i = 0; i < result.length; ++i) {
          const slave: ISentinelSlavesResponse = packObject(result[i])
          if (slave.flags && !slave.flags.match(/(disconnected|s_down|o_down)/)) {
            availableSlaves.push(slave)
          }
        }
        // allow the options to prefer particular slave(s)
        let {preferredSlaves} = this.options
        if (typeof preferredSlaves === 'function') {
          selectedSlave = preferredSlaves(availableSlaves)
        } else if (preferredSlaves !== null && typeof preferredSlaves === 'object') {
          const preferredSlavesArray = Array.isArray(preferredSlaves)
            ? preferredSlaves
            : [preferredSlaves]

          // sort by priority
          preferredSlavesArray.sort((a, b) => {
            // default the priority to 1
            if (!a.prio) {
              a.prio = 1
            }
            if (!b.prio) {
              b.prio = 1
            }
  
            // lowest priority first
            if (a.prio < b.prio) {
              return -1
            }
            if (a.prio > b.prio) {
              return 1
            }
            return 0
          })
          
          // loop over preferred slaves and return the first match
          for (let p = 0; p < preferredSlavesArray.length; p++) {
            for (let a = 0; a < availableSlaves.length; a++) {
              const slave = availableSlaves[a]
              if (slave.ip === preferredSlavesArray[p].ip) {
                if (slave.port === preferredSlavesArray[p].port) {
                  selectedSlave = slave
                  break
                }
              }
            }
            if (selectedSlave) {
              break
            }
          }
          // if none of the preferred slaves are available, a random available slave is returned
        }
        if (!selectedSlave) {
          // get a random available slave
          selectedSlave = sample(availableSlaves)
        }
      }
      callback(null, selectedSlave ? {host: selectedSlave.ip, port: Number(selectedSlave.port)} : null)
    })
  }
  
  resolve (endpoint, callback: NodeCallback<ITcpConnectionOptions>) {
    if (typeof Redis === 'undefined') {
      Redis = require('../redis')
    }
    var client = new Redis({
      port: endpoint.port || 26379,
      host: endpoint.host,
      family: endpoint.family || (isIIpcConnectionOptions(this.options) ? undefined : this.options.family),
      retryStrategy: null,
      enableReadyCheck: false,
      connectTimeout: this.options.connectTimeout,
      dropBufferSupport: true
    })
  
    // ignore the errors since resolve* methods will handle them
    client.on('error', noop)
  
    if (this.options.role === 'slave') {
      this.resolveSlave(client, callback)
    } else {
      this.resolveMaster(client, callback)
    }
  }
}

function noop (): void {}

function isSentinelEql (a, b): boolean {
  return ((a.host || '127.0.0.1') === (b.host || '127.0.0.1')) &&
    ((a.port || 26379) === (b.port || 26379))
}