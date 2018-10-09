import {NodeRole} from './util'

/**
 * Options for Cluster constructor
 *
 * @export
 * @interface IClusterOptions
 */
export interface IClusterOptions {
  /**
   * See "Quick Start" section.
   *
   * @default (times) => Math.min(100 + times * 2, 2000)
   */
  clusterRetryStrategy?: (times: number) => number | null

  /**
   * See Redis class.
   *
   * @default true
   */
  enableOfflineQueue?: boolean

  /**
   * When enabled, ioredis only emits "ready" event when `CLUSTER INFO`
   * command reporting the cluster is ready for handling commands.
   *
   * @default true
   */
  enableReadyCheck?: boolean

  /**
   * Scale reads to the node with the specified role.
   *
   * @default "master"
   */
  scaleReads?: NodeRole | Function

  /**
   * When a MOVED or ASK error is received, client will redirect the
   * command to another node.
   * This option limits the max redirections allowed to send a command.
   *
   * @default 16
   */
  maxRedirections?: number

  /**
   * When an error is received when sending a command (e.g.
   * "Connection is closed." when the target Redis node is down), client will retry
   * if `retryDelayOnFailover` is valid delay time (in ms).
   *
   * @default 100
   */
  retryDelayOnFailover?: number

  /**
   * When a CLUSTERDOWN error is received, client will retry
   * if `retryDelayOnClusterDown` is valid delay time (in ms).
   *
   * @default 100
   */
  retryDelayOnClusterDown?: number

  /**
   * When a TRYAGAIN error is received, client will retry
   * if `retryDelayOnTryAgain` is valid delay time (in ms).
   *
   * @default 100
   */
  retryDelayOnTryAgain?: number

  /**
   * The milliseconds before a timeout occurs while refreshing
   * slots from the cluster.
   *
   * @default 1000
   */
  slotsRefreshTimeout?: number

  /**
   * The milliseconds between every automatic slots refresh.
   *
   * @default 5000
   */
  slotsRefreshInterval?: number

  /**
   * Passed to the constructor of `Redis`
   *
   * @default null
   */
  redisOptions?: any

  /**
   * @default false
   */
  lazyConnect?: boolean
}

export const DEFAULT_CLUSTER_OPTIONS: IClusterOptions = {
  clusterRetryStrategy: (times) => Math.min(100 + times * 2, 2000),
  enableOfflineQueue: true,
  enableReadyCheck: true,
  scaleReads: 'master',
  maxRedirections: 16,
  retryDelayOnFailover: 100,
  retryDelayOnClusterDown: 100,
  retryDelayOnTryAgain: 100,
  slotsRefreshTimeout: 1000,
  slotsRefreshInterval: 5000
}
