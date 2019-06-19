import {NetStream, ICommandItem} from './types'
import Deque = require('denque')
import {EventEmitter} from 'events'
import Command from './command'
import {Debug} from './utils'
import * as RedisParser from 'redis-parser'
import SubscriptionSet from './SubscriptionSet';

const debug = Debug('dataHandler')

export interface IDataHandlerOptions {
  stringNumbers: boolean
  dropBufferSupport: boolean
}

interface ICondition {
  select: number,
  auth: string,
  subscriber: false | SubscriptionSet
}

interface IDataHandledable extends EventEmitter {
  stream: NetStream
  status: string
  condition: ICondition
  commandQueue: Deque<ICommandItem>

  disconnect(reconnect: boolean): void
  recoverFromFatalError(commandError: Error, err: Error, options: any): void
  handleReconnection(err: Error, item: ICommandItem): void
}

interface IParserOptions {
  stringNumbers: boolean
  dropBufferSupport: boolean
}

export default class DataHandler {
  constructor(private redis: IDataHandledable, parserOptions: IParserOptions) {
    const parser = new RedisParser({
      stringNumbers: parserOptions.stringNumbers,
      returnBuffers: !parserOptions.dropBufferSupport,
      returnError: (err: Error) => {
        this.returnError(err)
      },
      returnFatalError: (err: Error) => {
        this.returnFatalError(err)
      },
      returnReply: (reply: any) => {
        this.returnReply(reply)
      }
    })

    redis.stream.on('data', (data) => {
      parser.execute(data);
    })
  }

  private returnFatalError(err: Error) {
    err.message += '. Please report this.';
    this.redis.recoverFromFatalError(err, err, { offlineQueue: false })
  }

  private returnError(err: Error) {
    const item = this.redis.commandQueue.shift();

    (<any>err).command = {
      name: item.command.name,
      args: item.command.args
    };

    this.redis.handleReconnection(err, item)
  }

  private returnReply(reply: any) {
    if (this.redis.status === 'monitoring') {
      // Valid commands in the monitoring mode are AUTH and MONITOR,
      // both of which always reply with 'OK'.
      var replyStr = reply.toString();

      // If not the reply to AUTH & MONITOR
      if (replyStr !== 'OK') {
        // Since commands sent in the monitoring mode will trigger an exception,
        // any replies we received in the monitoring mode should consider to be
        // realtime monitor data instead of result of commands.
        var len = replyStr.indexOf(' ');
        var timestamp = replyStr.slice(0, len);
        var argindex = replyStr.indexOf('"');
        var args = replyStr.slice(argindex + 1, -1).split('" "').map(function (elem) {
          return elem.replace(/\\"/g, '"');
        });
        var dbAndSource = replyStr.slice(len + 2, argindex - 2).split(' ');
        this.redis.emit('monitor', timestamp, args, dbAndSource[1], dbAndSource[0]);
        return;
      }
    }

    var item, channel, count;
    if (this.redis.condition.subscriber) {
      var replyType = Array.isArray(reply) ? reply[0].toString() : null;
      debug('receive reply "%s" in subscriber mode', replyType);

      switch (replyType) {
      case 'message':
        if (this.redis.listeners('message').length > 0) {
          this.redis.emit('message', reply[1].toString(), reply[2].toString());
        }
        if (this.redis.listeners('messageBuffer').length > 0) {
          this.redis.emit('messageBuffer', reply[1], reply[2]);
        }
        break;
      case 'pmessage':
        var pattern = reply[1].toString();
        if (this.redis.listeners('pmessage').length > 0) {
          this.redis.emit('pmessage', pattern, reply[2].toString(), reply[3].toString());
        }
        if (this.redis.listeners('pmessageBuffer').length > 0) {
          this.redis.emit('pmessageBuffer', pattern, reply[2], reply[3]);
        }
        break;
      case 'subscribe':
      case 'psubscribe':
        channel = reply[1].toString();
        this.redis.condition.subscriber.add(replyType, channel);
        item = this.redis.commandQueue.shift();
        if (!fillSubCommand(item.command, reply[2])) {
          this.redis.commandQueue.unshift(item);
        }
        break;
      case 'unsubscribe':
      case 'punsubscribe':
        channel = reply[1] ? reply[1].toString() : null;
        if (channel) {
          this.redis.condition.subscriber.del(replyType, channel);
        }
        count = reply[2];
        if (count === 0) {
          this.redis.condition.subscriber = false;
        }
        item = this.redis.commandQueue.shift();
        if (!fillUnsubCommand(item.command, count)) {
          this.redis.commandQueue.unshift(item);
        }
        break;
      default:
        item = this.redis.commandQueue.shift();
        item.command.resolve(reply);
      }
    } else {
      item = this.redis.commandQueue.shift();
      if (!item) {
        return this.redis.emit('error',
          new Error('Command queue state error. If you can reproduce this, please report it. Last reply: ' +
            reply.toString()));
      }
      if (Command.checkFlag('ENTER_SUBSCRIBER_MODE', item.command.name)) {
        this.redis.condition.subscriber = new SubscriptionSet();
        this.redis.condition.subscriber.add(item.command.name, reply[1].toString());

        if (!fillSubCommand(item.command, reply[2])) {
          this.redis.commandQueue.unshift(item);
        }
      } else if (Command.checkFlag('EXIT_SUBSCRIBER_MODE', item.command.name)) {
        if (!fillUnsubCommand(item.command, reply[2])) {
          this.redis.commandQueue.unshift(item);
        }
      } else {
        item.command.resolve(reply);
      }
    }
  }
}

function fillSubCommand(command, count: number) {
  if (typeof command.remainReplies === 'undefined') {
    command.remainReplies = command.args.length;
  }
  if (--command.remainReplies === 0) {
    command.resolve(count);
    return true;
  }
  return false;
}

function fillUnsubCommand(command: Command, count: number) {
  // TODO: use WeakMap here
  if (typeof (command as any).remainReplies === 'undefined') {
    (command as any).remainReplies = command.args.length;
  }
  if ((command as any).remainReplies === 0) {
    if (count === 0) {
      command.resolve(count);
      return true;
    }
    return false;
  }
  if (--(command as any).remainReplies === 0) {
    command.resolve(count);
    return true;
  }
  return false;
}
