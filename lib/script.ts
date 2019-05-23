import {createHash} from 'crypto'
import {isPromise} from './promiseContainer'
import Command from './command'
import asCallback from 'standard-as-callback'
import {CallbackFunction} from './types'

export default class Script {
  private sha: string

  constructor (
    private lua: string,
    private numberOfKeys: number = null,
    private keyPrefix: string = ''
  ) {
    this.sha = createHash('sha1').update(lua).digest('hex')
  }

  execute (container: any, args: any[], options: any, callback?: CallbackFunction) {
    if (typeof this.numberOfKeys === 'number') {
      args.unshift(this.numberOfKeys)
    }
    if (this.keyPrefix) {
      options.keyPrefix = this.keyPrefix
    }

    // https://github.com/luin/ioredis/issues/536#issuecomment-346872649
    if (container.constructor.name === 'Pipeline' && container.isCluster) {
      const evalCmd = new Command('eval', [this.lua].concat(args), options);

      const result = container.sendCommand(evalCmd);
      if (isPromise(result)) {
        return asCallback(result, callback);
      }

      asCallback(evalCmd.promise, callback);

      return result;
    }

    const evalsha = new Command('evalsha', [this.sha].concat(args), options)
    evalsha.isCustomCommand = true

    const result = container.sendCommand(evalsha)
    if (isPromise(result)) {
      return asCallback(
        result.catch((err) => {
          if (err.toString().indexOf('NOSCRIPT') === -1) {
            throw err
          }
          return container.sendCommand(
            new Command('eval', [this.lua].concat(args), options)
          )
        }),
        callback
      )
    }

    // result is not a Promise--probably returned from a pipeline chain; however,
    // we still need the callback to fire when the script is evaluated
    asCallback(evalsha.promise, callback)

    return result
  }
}
