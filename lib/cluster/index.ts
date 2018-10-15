import {EventEmitter} from 'events'
import ClusterAllFailedError from '../errors/ClusterAllFailedError'
import {defaults, noop} from '../utils/lodash'
import ConnectionPool from './ConnectionPool'
import {NodeKey, IRedisOptions, normalizeNodeOptions, NodeRole, getUniqueHostnamesFromOptions} from './util'
import ClusterSubscriber from './ClusterSubscriber'
import DelayQueue from './DelayQueue'
import ScanStream from '../ScanStream'
import {AbortError, RedisError} from 'redis-errors'
import * as asCallback from 'standard-as-callback'
import * as PromiseContainer from '../promiseContainer'
import {CallbackFunction} from '../types';
import {IClusterOptions, DEFAULT_CLUSTER_OPTIONS} from './ClusterOptions'
import {sample, CONNECTION_CLOSED_ERROR_MSG, shuffle, timeout} from '../utils'
import * as commands from 'redis-commands'

const Deque = require('denque')
const Redis = require('../redis')
const debug = require('../utils/debug')('ioredis:cluster')
const Commander = require('../commander')
const Command = require('../command')

type ClusterStatus = 'end' | 'close' | 'wait' | 'connecting' | 'connect' | 'ready' | 'reconnecting' | 'disconnecting'

/**
 * Client for the official Redis Cluster
 *
 * @class Cluster
 * @extends {EventEmitter}
 */
class Cluster extends EventEmitter {
  private options: IClusterOptions
  private startupNodes: IRedisOptions[]
  private connectionPool: ConnectionPool
  private slots: Array<NodeKey[]> = []
  private manuallyClosing: boolean
  private retryAttempts: number = 0
  private delayQueue: DelayQueue = new DelayQueue()
  private offlineQueue = new Deque()
  private subscriber: ClusterSubscriber
  private slotsTimer: NodeJS.Timer
  private reconnectTimeout: NodeJS.Timer
  private status: ClusterStatus
  private isRefreshing: boolean = false

  /**
   * Every time Cluster#connect() is called, this value will be
   * auto-incrementing. The purpose of this value is used for
   * discarding previous connect attampts when creating a new
   * connection.
   *
   * @private
   * @type {number}
   * @memberof Cluster
   */
  private connectionEpoch: number = 0

  /**
   * Creates an instance of Cluster.
   *
   * @param {(Array<string | number | object>)} startupNodes
   * @param {IClusterOptions} [options={}]
   * @memberof Cluster
   */
  constructor(startupNodes: Array<string | number | object>, options: IClusterOptions = {}) {
    super()
    Commander.call(this)

    this.startupNodes = normalizeNodeOptions(startupNodes)
    this.options = defaults(this.options, options, DEFAULT_CLUSTER_OPTIONS)

    // validate options
    if (typeof this.options.scaleReads !== 'function' &&
      ['all', 'master', 'slave'].indexOf(this.options.scaleReads) === -1) {
      throw new Error('Invalid option scaleReads "' + this.options.scaleReads +
        '". Expected "all", "master", "slave" or a custom function')
    }

    this.connectionPool = new ConnectionPool(this.options.redisOptions)

    this.connectionPool.on('-node', (redis, key) => {
      this.emit('-node', redis)
    })
    this.connectionPool.on('+node', (redis) => {
      this.emit('+node', redis)
    })
    this.connectionPool.on('drain', () => {
      this.setStatus('close')
    })
    this.connectionPool.on('nodeError', (error) => {
      this.emit('node error', error)
    })

    this.subscriber = new ClusterSubscriber(this.connectionPool, this)

    if (this.options.lazyConnect) {
      this.setStatus('wait')
    } else {
      this.connect().catch((err) => {
        debug('connecting failed: %s', err)
      })
    }
  }


  resetOfflineQueue() {
    this.offlineQueue = new Deque()
  }

  resetNodesRefreshInterval() {
    if (this.slotsTimer) {
      return
    }
    this.slotsTimer = setInterval(function () {
      this.refreshSlotsCache()
    }.bind(this), this.options.slotsRefreshInterval)
  }

  /**
   * Connect to a cluster
   *
   * @returns {Promise<void>}
   * @memberof Cluster
   */
  public connect(): Promise<void> {
    const Promise = PromiseContainer.get()
    return new Promise((resolve, reject) => {
      if (this.status === 'connecting' || this.status === 'connect' || this.status === 'ready') {
        reject(new Error('Redis is already connecting/connected'))
        return
      }
      const epoch = ++this.connectionEpoch
      this.setStatus('connecting')

      if (!Array.isArray(this.startupNodes) || this.startupNodes.length === 0) {
        throw new Error('`startupNodes` should contain at least one node.')
      }

      this.resolveStartupNodeHostnames().then((nodes) => {
        if (this.connectionEpoch !== epoch) {
          debug('discard connecting after resolving startup nodes because epoch not match: %d != %d', epoch, this.connectionEpoch)
          reject(new RedisError('Connection is discarded because a new connection is made'))
          return
        }
        if (this.status !== 'connecting') {
          debug('discard connecting after resolving startup nodes because the status changed to %s', this.status)
          reject(new RedisError('Connection is aborted'))
          return
        }
        this.connectionPool.reset(nodes)

        function readyHandler() {
          this.setStatus('ready')
          this.retryAttempts = 0
          this.executeOfflineCommands()
          this.resetNodesRefreshInterval()
          resolve()
        }

        let closeListener: () => void
        const refreshListener = () => {
          this.removeListener('close', closeListener)
          this.manuallyClosing = false
          this.setStatus('connect')
          if (this.options.enableReadyCheck) {
            this.readyCheck((err, fail) => {
              if (err || fail) {
                debug('Ready check failed (%s). Reconnecting...', err || fail)
                if (this.status === 'connect') {
                  this.disconnect(true)
                }
              } else {
                readyHandler.call(this)
              }
            })
          } else {
            readyHandler.call(this)
          }
        }

        closeListener = function () {
          this.removeListener('refresh', refreshListener)
          reject(new Error('None of startup nodes is available'))
        }

        this.once('refresh', refreshListener)
        this.once('close', closeListener)
        this.once('close', this.handleCloseEvent.bind(this))

        this.refreshSlotsCache(function (err) {
          if (err && err.message === 'Failed to refresh slots cache.') {
            Redis.prototype.silentEmit.call(this, 'error', err)
            this.connectionPool.reset([])
          }
        }.bind(this))
        this.subscriber.start()
      }).catch(reject)
    })
  }

  /**
   * Called when closed to check whether a reconnection should be made
   *
   * @private
   * @memberof Cluster
   */
  private handleCloseEvent(): void {
    let retryDelay
    if (!this.manuallyClosing && typeof this.options.clusterRetryStrategy === 'function') {
      retryDelay = this.options.clusterRetryStrategy.call(this, ++this.retryAttempts)
    }
    if (typeof retryDelay === 'number') {
      this.setStatus('reconnecting')
      this.reconnectTimeout = setTimeout(function () {
        this.reconnectTimeout = null
        debug('Cluster is disconnected. Retrying after %dms', retryDelay)
        this.connect().catch(function (err) {
          debug('Got error %s when reconnecting. Ignoring...', err)
        })
      }.bind(this), retryDelay)
    } else {
      this.setStatus('end')
      this.flushQueue(new Error('None of startup nodes is available'))
    }
  }

  /**
   * Disconnect from every node in the cluster.
   *
   * @param {boolean} [reconnect=false]
   * @memberof Cluster
   */
  public disconnect(reconnect: boolean = false) {
    const status = this.status
    this.setStatus('disconnecting')

    if (!reconnect) {
      this.manuallyClosing = true
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
      debug('Canceled reconnecting attempts')
    }
    if (this.slotsTimer) {
      clearInterval(this.slotsTimer)
      this.slotsTimer = null
    }

    this.subscriber.stop()
    if (status === 'wait') {
      this.setStatus('close')
      this.handleCloseEvent()
    } else {
      this.connectionPool.reset([])
    }
  }

  /**
   * Quit the cluster gracefully.
   *
   * @param {CallbackFunction<'OK'>} [callback]
   * @returns {Promise<'OK'>}
   * @memberof Cluster
   */
  public quit(callback?: CallbackFunction<'OK'>): Promise<'OK'> {
    const status = this.status
    this.setStatus('disconnecting')

    this.manuallyClosing = true

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.slotsTimer) {
      clearInterval(this.slotsTimer)
      this.slotsTimer = null
    }

    this.subscriber.stop()

    const Promise = PromiseContainer.get()
    if (status === 'wait') {
      const ret = asCallback(Promise.resolve('OK'), callback)

      // use setImmediate to make sure "close" event
      // being emitted after quit() is returned
      setImmediate(function () {
        this.setStatus('close')
        this.handleCloseEvent()
      }.bind(this))

      return ret
    }
    return asCallback(
      Promise.all(this.nodes().map((node) => (
        node.quit().catch((err) => {
          // Ignore the error caused by disconnecting since
          // we're disconnecting...
          if (err.message === CONNECTION_CLOSED_ERROR_MSG) {
            return 'OK'
          }
          throw err
        })
      ))).then(() => 'OK'),
      callback
    )
  }

  /**
   * Get nodes with the specified role
   *
   * @param {NodeRole} [role='all']
   * @returns {any[]}
   * @memberof Cluster
   */
  public nodes(role: NodeRole = 'all'): any[] {
    if (role !== 'all' && role !== 'master' && role !== 'slave') {
      throw new Error('Invalid role "' + role + '". Expected "all", "master" or "slave"')
    }
    return this.connectionPool.getNodes(role)
  }

  /**
   * Change cluster instance's status
   *
   * @private
   * @param {ClusterStatus} status
   * @memberof Cluster
   */
  private setStatus(status: ClusterStatus): void {
    debug('status: %s -> %s', this.status || '[empty]', status)
    this.status = status
    process.nextTick(() => {
      this.emit(status)
    })
  }

  /**
   * Refresh the slot cache
   *
   * @private
   * @param {CallbackFunction} [callback]
   * @memberof Cluster
   */
  private refreshSlotsCache(callback?: CallbackFunction): void {
    if (this.isRefreshing) {
      if (typeof callback === 'function') {
        process.nextTick(callback)
      }
      return
    }
    this.isRefreshing = true

    const _this = this
    const wrapper = function (error?: Error) {
      _this.isRefreshing = false
      if (typeof callback === 'function') {
        callback(error)
      }
    }

    const nodes = shuffle(this.connectionPool.getNodes())

    let lastNodeError = null

    function tryNode(index) {
      if (index === nodes.length) {
        const error = new ClusterAllFailedError('Failed to refresh slots cache.', lastNodeError)
        return wrapper(error)
      }
      const node = nodes[index]
      debug('getting slot cache from %s:%s', node.options.host, node.options.port)
      _this.getInfoFromNode(node, function (err) {
        if (_this.status === 'end') {
          return wrapper(new Error('Cluster is disconnected.'))
        }
        if (err) {
          _this.emit('node error', err)
          lastNodeError = err
          tryNode(index + 1)
        } else {
          _this.emit('refresh')
          wrapper()
        }
      })
    }

    tryNode(0)
  }

  /**
   * Flush offline queue with error.
   *
   * @param {Error} error
   * @memberof Cluster
   */
  private flushQueue(error: Error) {
    let item
    while (this.offlineQueue.length > 0) {
      item = this.offlineQueue.shift()
      item.command.reject(error)
    }
  }

  executeOfflineCommands() {
    if (this.offlineQueue.length) {
      debug('send %d commands in offline queue', this.offlineQueue.length)
      const offlineQueue = this.offlineQueue
      this.resetOfflineQueue()
      while (offlineQueue.length > 0) {
        const item = offlineQueue.shift()
        this.sendCommand(item.command, item.stream, item.node)
      }
    }
  }

  sendCommand(command, stream, node) {
    if (this.status === 'wait') {
      this.connect().catch(noop)
    }
    if (this.status === 'end') {
      command.reject(new Error(CONNECTION_CLOSED_ERROR_MSG))
      return command.promise
    }
    let to = this.options.scaleReads
    if (to !== 'master') {
      const isCommandReadOnly = commands.exists(command.name) && commands.hasFlag(command.name, 'readonly')
      if (!isCommandReadOnly) {
        to = 'master'
      }
    }

    const targetSlot = node ? node.slot : command.getSlot()
    const ttl = {}
    const _this = this
    if (!node && !command.__is_reject_overwritten) {
      command.__is_reject_overwritten = true
      const reject = command.reject
      command.reject = function (err) {
        const partialTry = tryConnection.bind(null, true)
        _this.handleError(err, ttl, {
          moved: function (slot, key) {
            debug('command %s is moved to %s', command.name, key)
            if (_this.slots[slot]) {
              _this.slots[slot][0] = key
            } else {
              _this.slots[slot] = [key]
            }
            const splitKey = key.split(':')
            _this.connectionPool.findOrCreate({host: splitKey[0], port: Number(splitKey[1])})
            tryConnection()
            _this.refreshSlotsCache()
          },
          ask: function (slot, key) {
            debug('command %s is required to ask %s:%s', command.name, key)
            const splitKey = key.split(':')
            _this.connectionPool.findOrCreate({host: splitKey[0], port: Number(splitKey[1])})
            tryConnection(false, key)
          },
          tryagain: partialTry,
          clusterDown: partialTry,
          connectionClosed: partialTry,
          maxRedirections: function (redirectionError) {
            reject.call(command, redirectionError)
          },
          defaults: function () {
            reject.call(command, err)
          }
        })
      }
    }
    tryConnection()

    function tryConnection(random?: boolean, asking?: string) {
      if (_this.status === 'end') {
        command.reject(new AbortError('Cluster is ended.'))
        return
      }
      let redis
      if (_this.status === 'ready' || (command.name === 'cluster')) {
        if (node && node.redis) {
          redis = node.redis
        } else if (Command.checkFlag('ENTER_SUBSCRIBER_MODE', command.name) ||
          Command.checkFlag('EXIT_SUBSCRIBER_MODE', command.name)) {
          redis = _this.subscriber.getInstance()
          if (!redis) {
            command.reject(new AbortError('No subscriber for the cluster'))
            return
          }
        } else {
          if (!random) {
            if (typeof targetSlot === 'number' && _this.slots[targetSlot]) {
              const nodeKeys = _this.slots[targetSlot]
              if (typeof to === 'function') {
                const nodes =
                  nodeKeys
                    .map(function (key) {
                      return _this.connectionPool.getInstanceByKey(key)
                    })
                redis = to(nodes, command)
                if (Array.isArray(redis)) {
                  redis = sample(redis)
                }
                if (!redis) {
                  redis = nodes[0]
                }
              } else {
                let key
                if (to === 'all') {
                  key = sample(nodeKeys)
                } else if (to === 'slave' && nodeKeys.length > 1) {
                  key = sample(nodeKeys, 1)
                } else {
                  key = nodeKeys[0]
                }
                redis = _this.connectionPool.getInstanceByKey(key)
              }
            }
            if (asking) {
              redis = _this.connectionPool.getInstanceByKey(asking)
              redis.asking()
            }
          }
          if (!redis) {
            redis =
              (typeof to === 'function' ? null : _this.connectionPool.getSampleInstance(to)) ||
              _this.connectionPool.getSampleInstance('all')
          }
        }
        if (node && !node.redis) {
          node.redis = redis
        }
      }
      if (redis) {
        redis.sendCommand(command, stream)
      } else if (_this.options.enableOfflineQueue) {
        _this.offlineQueue.push({
          command: command,
          stream: stream,
          node: node
        })
      } else {
        command.reject(new Error('Cluster isn\'t ready and enableOfflineQueue options is false'))
      }
    }
    return command.promise
  }

  handleError(error, ttl, handlers) {
    if (typeof ttl.value === 'undefined') {
      ttl.value = this.options.maxRedirections
    } else {
      ttl.value -= 1
    }
    if (ttl.value <= 0) {
      handlers.maxRedirections(new Error('Too many Cluster redirections. Last error: ' + error))
      return
    }
    const errv = error.message.split(' ')
    if (errv[0] === 'MOVED' || errv[0] === 'ASK') {
      handlers[errv[0] === 'MOVED' ? 'moved' : 'ask'](errv[1], errv[2])
    } else if (errv[0] === 'TRYAGAIN') {
      this.delayQueue.push('tryagain', handlers.tryagain, {
        timeout: this.options.retryDelayOnTryAgain
      })
    } else if (errv[0] === 'CLUSTERDOWN' && this.options.retryDelayOnClusterDown > 0) {
      this.delayQueue.push('clusterdown', handlers.connectionClosed, {
        timeout: this.options.retryDelayOnClusterDown,
        callback: this.refreshSlotsCache.bind(this)
      })
    } else if (
      error.message === CONNECTION_CLOSED_ERROR_MSG &&
      this.options.retryDelayOnFailover > 0 &&
      this.status === 'ready'
    ) {
      this.delayQueue.push('failover', handlers.connectionClosed, {
        timeout: this.options.retryDelayOnFailover,
        callback: this.refreshSlotsCache.bind(this)
      })
    } else {
      handlers.defaults()
    }
  }

  getInfoFromNode(redis, callback) {
    if (!redis) {
      return callback(new Error('Node is disconnected'))
    }
    redis.cluster('slots', timeout((err, result) => {
      if (err) {
        redis.disconnect()
        return callback(err)
      }
      const nodes = []

      debug('cluster slots result count: %d', result.length)

      for (let i = 0; i < result.length; ++i) {
        const items = result[i]
        const slotRangeStart = items[0]
        const slotRangeEnd = items[1]

        const keys = []
        for (let j = 2; j < items.length; j++) {
          items[j] = {host: items[j][0], port: items[j][1]}
          items[j].readOnly = j !== 2
          nodes.push(items[j])
          keys.push(items[j].host + ':' + items[j].port)
        }

        debug('cluster slots result [%d]: slots %d~%d served by %s', i, slotRangeStart, slotRangeEnd, keys)

        for (let slot = slotRangeStart; slot <= slotRangeEnd; slot++) {
          this.slots[slot] = keys
        }
      }

      this.connectionPool.reset(nodes)
      callback()
    }, this.options.slotsRefreshTimeout))
  }

  /**
   * Check whether Cluster is able to process commands
   *
   * @param {Function} callback
   * @private
   */
  private readyCheck(callback: CallbackFunction<void | 'fail'>): void {
    (this as any).cluster('info', function (err, res) {
      if (err) {
        return callback(err)
      }
      if (typeof res !== 'string') {
        return callback()
      }

      let state
      const lines = res.split('\r\n')
      for (let i = 0; i < lines.length; ++i) {
        const parts = lines[i].split(':')
        if (parts[0] === 'cluster_state') {
          state = parts[1]
          break
        }
      }

      if (state === 'fail') {
        debug('cluster state not ok (%s)', state)
        callback(null, state)
      } else {
        callback()
      }
    })
  }

  private resolveStartupNodeHostnames (): Promise<IRedisOptions[]> {
    const hostnames = getUniqueHostnamesFromOptions(this.startupNodes)

    if (hostnames.length === 0) {
      return Promise.resolve(this.startupNodes)
    }

    const hostnameToIP = new Map<string, string>()
    return Promise.all(hostnames.map((hostname) => (
      new Promise((resolve, reject) => {
        this.options.dnsLookup(hostname, (err, address) => {
          if (err) {
            debug('failed to resolve hostname %s to IP: %s', hostname, err.message)
            reject(err)
          } else {
            debug('resolved hostname %s to IP %s', hostname, address)
            hostnameToIP.set(hostname, address)
            resolve()
          }
        })
      }
    )))).then(() => (
      this.startupNodes.map((node) => {
        if (!hostnameToIP.has(node.host)) {
          return node
        }
        return Object.assign({}, node, {host: hostnameToIP.get(node.host)})
      })
    ))
  }
}

Object.getOwnPropertyNames(Commander.prototype).forEach(name => {
  if (!Cluster.prototype.hasOwnProperty(name)) {
    Cluster.prototype[name] = Commander.prototype[name]
  }
})

const scanCommands = ['sscan', 'hscan', 'zscan', 'sscanBuffer', 'hscanBuffer', 'zscanBuffer']
scanCommands.forEach((command) => {
  Cluster.prototype[command + 'Stream'] = function (key, options) {
    return new ScanStream(defaults({
      objectMode: true,
      key: key,
      redis: this,
      command: command
    }, options))
  }
})

require('../transaction').addTransactionSupport(Cluster.prototype)

export default Cluster
