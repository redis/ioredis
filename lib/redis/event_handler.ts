'use strict';

import Command from '../command'
import {MaxRetriesPerRequestError} from '../errors'
import {Debug, noop, CONNECTION_CLOSED_ERROR_MSG} from '../utils'
import DataHandler from '../DataHandler'

const debug = Debug('connection')

export function connectHandler(self) {
  return function () {
    self.setStatus('connect');

    self.resetCommandQueue();

    // AUTH command should be processed before any other commands
    let flushed = false;
    if (self.condition.auth) {
      self.auth(self.condition.auth, function (err) {
        if (err) {
          if (err.message.indexOf('no password is set') === -1) {
            flushed = true;
            self.recoverFromFatalError(err, err)
          } else {
            console.warn('[WARN] Redis server does not require a password, but a password was supplied.');
          }
        }
      });
    }

    if (self.condition.select) {
      self.select(self.condition.select);
    }

    if (!self.options.enableReadyCheck) {
      exports.readyHandler(self)();
    }

    /*
      No need to keep the reference of DataHandler here
      because we don't need to do the cleanup.
      `Stream#end()` will remove all listeners for us.
    */
    new DataHandler(self, {
      stringNumbers: self.options.stringNumbers,
      dropBufferSupport: self.options.dropBufferSupport
    })

    if (self.options.enableReadyCheck) {
      self._readyCheck(function (err, info) {
        if (err) {
          if (!flushed) {
            self.recoverFromFatalError(new Error('Ready check failed: ' + err.message), err)
          }
        } else {
          self.serverInfo = info;
          if (self.options.connector.check(info)) {
            exports.readyHandler(self)();
          } else {
            self.disconnect(true);
          }
        }
      });
    }
  };
};

export function closeHandler(self) {
  return function () {
    self.setStatus('close');

    if (!self.prevCondition) {
      self.prevCondition = self.condition;
    }
    if (self.commandQueue.length) {
      self.prevCommandQueue = self.commandQueue;
    }

    if (self.manuallyClosing) {
      self.manuallyClosing = false;
      debug('skip reconnecting since the connection is manually closed.');
      return close();
    }

    if (typeof self.options.retryStrategy !== 'function') {
      debug('skip reconnecting because `retryStrategy` is not a function');
      return close();
    }
    const retryDelay = self.options.retryStrategy(++self.retryAttempts);

    if (typeof retryDelay !== 'number') {
      debug('skip reconnecting because `retryStrategy` doesn\'t return a number');
      return close();
    }

    debug('reconnect in %sms', retryDelay);

    self.setStatus('reconnecting', retryDelay);
    self.reconnectTimeout = setTimeout(function () {
      self.reconnectTimeout = null;
      self.connect().catch(noop);
    }, retryDelay);

    const {maxRetriesPerRequest} = self.options;
    if (typeof maxRetriesPerRequest === 'number') {
      if (maxRetriesPerRequest < 0) {
        debug('maxRetriesPerRequest is negative, ignoring...')
      } else {
        const remainder = self.retryAttempts % (maxRetriesPerRequest + 1);
        if (remainder === 0) {
          debug('reach maxRetriesPerRequest limitation, flushing command queue...');
          self.flushQueue(
            new MaxRetriesPerRequestError(maxRetriesPerRequest)
          );
        }
      }
    }
  };

  function close() {
    self.setStatus('end');
    self.flushQueue(new Error(CONNECTION_CLOSED_ERROR_MSG));
  }
};

export function errorHandler(self) {
  return function (error) {
    debug('error: %s', error);
    self.silentEmit('error', error);
  };
};

export function readyHandler(self) {
  return function () {
    self.setStatus('ready');
    self.retryAttempts = 0;

    if (self.options.monitor) {
      self.call('monitor');
      const {sendCommand} = self
      self.sendCommand = function (command) {
        if (Command.checkFlag('VALID_IN_MONITOR_MODE', command.name)) {
          return sendCommand.call(self, command);
        }
        command.reject(new Error('Connection is in monitoring mode, can\'t process commands.'));
        return command.promise;
      };
      self.once('close', function () {
        delete self.sendCommand;
      });
      self.setStatus('monitoring');
      return;
    }
    const finalSelect = self.prevCondition ? self.prevCondition.select : self.condition.select;

    if (self.options.connectionName) {
      debug('set the connection name [%s]', self.options.connectionName);
      self.client('setname', self.options.connectionName).catch(noop);
    }

    if (self.options.readOnly) {
      debug('set the connection to readonly mode');
      self.readonly().catch(noop);
    }

    if (self.prevCondition) {
      const condition = self.prevCondition;
      self.prevCondition = null;
      if (condition.subscriber && self.options.autoResubscribe) {
        // We re-select the previous db first since
        // `SELECT` command is not valid in sub mode.
        if (self.condition.select !== finalSelect) {
          debug('connect to db [%d]', finalSelect);
          self.select(finalSelect);
        }
        const subscribeChannels = condition.subscriber.channels('subscribe');
        if (subscribeChannels.length) {
          debug('subscribe %d channels', subscribeChannels.length);
          self.subscribe(subscribeChannels);
        }
        const psubscribeChannels = condition.subscriber.channels('psubscribe');
        if (psubscribeChannels.length) {
          debug('psubscribe %d channels', psubscribeChannels.length);
          self.psubscribe(psubscribeChannels);
        }
      }
    }

    if (self.prevCommandQueue) {
      if (self.options.autoResendUnfulfilledCommands) {
        debug('resend %d unfulfilled commands', self.prevCommandQueue.length);
        while (self.prevCommandQueue.length > 0) {
          const item = self.prevCommandQueue.shift();
          if (item.select !== self.condition.select && item.command.name !== 'select') {
            self.select(item.select);
          }
          self.sendCommand(item.command, item.stream);
        }
      } else {
        self.prevCommandQueue = null;
      }
    }

    if (self.offlineQueue.length) {
      debug('send %d commands in offline queue', self.offlineQueue.length);
      const offlineQueue = self.offlineQueue;
      self.resetOfflineQueue();
      while (offlineQueue.length > 0) {
        const item = offlineQueue.shift();
        if (item.select !== self.condition.select && item.command.name !== 'select') {
          self.select(item.select);
        }
        self.sendCommand(item.command, item.stream);
      }
    }

    if (self.condition.select !== finalSelect) {
      debug('connect to db [%d]', finalSelect);
      self.select(finalSelect);
    }
  };
};
