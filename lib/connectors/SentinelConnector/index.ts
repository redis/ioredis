import {createConnection, Socket} from 'net'
import {NatMap} from '../../cluster/ClusterOptions';
import {CONNECTION_CLOSED_ERROR_MSG, packObject, sample} from '../../utils'
import {connect as createTLSConnection, TLSSocket, SecureContextOptions} from 'tls'
import {ITcpConnectionOptions, isIIpcConnectionOptions} from '../StandaloneConnector'
import SentinelIterator from './SentinelIterator'
import {ISentinelAddress} from './types';
import AbstractConnector, { ErrorEmitter } from '../AbstractConnector'
const debug = require('../../utils/debug')('ioredis:SentinelConnector')

let Redis

interface IAddressFromResponse {
  port: string,
  ip: string,
  flags?: string
}

type NodeCallback<T = void> = (err: Error | null, result?: T) => void
type PreferredSlaves =
  ((slaves: Array<IAddressFromResponse>) => IAddressFromResponse) |
  Array<{port: string, ip: string, prio?: number}> |
  {port: string, ip: string, prio?: number}

interface ISentinelConnectionOptions extends ITcpConnectionOptions {
  role: 'master' | 'slave'
  name: 'string'
  sentinels: Array<ISentinelAddress>
  sentinelRetryStrategy?: (retryAttempts: number) => number
  preferredSlaves?: PreferredSlaves
  connectTimeout?: number
  enableTLSForSentinelMode?: boolean
  sentinelTLS?: SecureContextOptions
  natMap: NatMap
}

export default class SentinelConnector extends AbstractConnector {
  private retryAttempts: number
  private sentinelIterator: SentinelIterator

  constructor (protected options: ISentinelConnectionOptions) {
    super()

    if (this.options.sentinels.length === 0) {
      throw new Error('Requires at least one sentinel to connect to.')
    }
    if (!this.options.name) {
      throw new Error('Requires the name of master.')
    }

    if (this.options.natMap && Object.keys(this.options.natMap).length === 0) {
      throw new Error('Empty natMap is not allowed.')
    }

    this.sentinelIterator = new SentinelIterator(this.options.sentinels)
  }

  public check (info: {role?: string}): boolean {
    const roleMatches: boolean = !info.role || this.options.role === info.role
    if (!roleMatches) {
      debug('role invalid, expected %s, but got %s', this.options.role, info.role)
      // Start from the next item.
      // Note that `reset` will move the cursor to the previous element,
      // so we advance two steps here.
      this.sentinelIterator.next()
      this.sentinelIterator.next()
      this.sentinelIterator.reset(true)
    }
    return roleMatches
  }

  public connect (callback: NodeCallback<Socket | TLSSocket>, eventEmitter: ErrorEmitter): void {
    this.connecting = true
    this.retryAttempts = 0

    let lastError
    const _this = this
    connectToNext()

    function connectToNext() {
      if (!_this.sentinelIterator.hasNext()) {
        _this.sentinelIterator.reset(false)
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

      const endpoint = _this.sentinelIterator.next()
      _this.resolve(endpoint, function (err, resolved) {
        if (!_this.connecting) {
          callback(new Error(CONNECTION_CLOSED_ERROR_MSG))
          return
        }
        if (resolved) {
          debug('resolved: %s:%s', resolved.host, resolved.port)
          if (_this.options.enableTLSForSentinelMode && _this.options.tls) {
            Object.assign(resolved, _this.options.tls)
            _this.stream = createTLSConnection(resolved)
          } else {
            _this.stream = createConnection(resolved)
          }
          _this.sentinelIterator.reset(true)
          callback(null, _this.stream)
        } else {
          const endpointAddress = endpoint.host + ':' + endpoint.port
          const errorMsg = err
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

  private updateSentinels (client, callback: NodeCallback): void {
    client.sentinel('sentinels', this.options.name, (err, result) => {
      if (err) {
        client.disconnect()
        return callback(err)
      }
      if (!Array.isArray(result)) {
        return callback(null)
      }

      result.map<IAddressFromResponse>(packObject as (value: any) => IAddressFromResponse).forEach(sentinel => {
        const flags = sentinel.flags ? sentinel.flags.split(',') : []
        if (flags.indexOf('disconnected') === -1 && sentinel.ip && sentinel.port) {
          const endpoint = this.sentinelNatResolve(addressResponseToAddress(sentinel))
          if (this.sentinelIterator.add(endpoint)) {
            debug('adding sentinel %s:%s', endpoint.host, endpoint.port)
          }
        }
      })
      debug('Updated internal sentinels: %s', this.sentinelIterator)
      callback(null)
    })
  }

  private resolveMaster (client, callback: NodeCallback<ITcpConnectionOptions>): void {
    client.sentinel('get-master-addr-by-name', this.options.name, (err, result) => {
      if (err) {
        client.disconnect()
        return callback(err)
      }
      this.updateSentinels(client, (err) => {
        client.disconnect()
        if (err) {
          return callback(err)
        }

        callback(null, this.sentinelNatResolve(
          Array.isArray(result) ? { host: result[0], port: Number(result[1]) } : null
        ))
      })
    })
  }

  private resolveSlave (client, callback: NodeCallback<ITcpConnectionOptions | null>): void {
    client.sentinel('slaves', this.options.name, (err, result) => {
      client.disconnect()
      if (err) {
        return callback(err)
      }

      if (!Array.isArray(result)) {
        return callback(null, null)
      }

      const availableSlaves = result.map<IAddressFromResponse>(packObject as (value: any) => IAddressFromResponse).filter(slave => (
        slave.flags && !slave.flags.match(/(disconnected|s_down|o_down)/)
      ))

      callback(null, this.sentinelNatResolve(
        selectPreferredSentinel(availableSlaves, this.options.preferredSlaves)
      ))
    })
  }

  sentinelNatResolve (item: ISentinelAddress) {
    if (!item || !this.options.natMap)
      return item;

    return this.options.natMap[`${item.host}:${item.port}`] || item
  }

  private resolve (endpoint, callback: NodeCallback<ITcpConnectionOptions>): void {
    if (typeof Redis === 'undefined') {
      Redis = require('../../redis')
    }
    var client = new Redis({
      port: endpoint.port || 26379,
      host: endpoint.host,
      family: endpoint.family || (isIIpcConnectionOptions(this.options) ? undefined : this.options.family),
      tls: this.options.sentinelTLS,
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

function selectPreferredSentinel (availableSlaves: IAddressFromResponse[], preferredSlaves?: PreferredSlaves): ISentinelAddress | null {
  if (availableSlaves.length === 0) {
    return null
  }

  let selectedSlave: IAddressFromResponse
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
  }

  // if none of the preferred slaves are available, a random available slave is returned
  if (!selectedSlave) {
    selectedSlave = sample(availableSlaves)
  }
  return addressResponseToAddress(selectedSlave)
}

function addressResponseToAddress (input: IAddressFromResponse): ISentinelAddress {
  return {host: input.ip, port: Number(input.port)}
}

function noop (): void {}
