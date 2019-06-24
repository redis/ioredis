import SentinelConnector, { ISentinelConnectionOptions, ISentinelAddress, SentinelIterator, EMPTY_SENTINELS_MSG } from './SentinelConnector';
import { ErrorEmitter } from './AbstractConnector';
import { NetStream } from '../types';
import { NodeCallback } from './types';

export type FloatingSentinels = (err: Error, sentinels: Partial<ISentinelAddress>[]) => void

export default class AsyncSentinelConnector extends SentinelConnector {
    private fetch: (FloatingSentinels) => void

    constructor(options: ISentinelConnectionOptions, fetch: (FloatingSentinels) => void) {
        options.sentinels = options.sentinels || [{host: 'localhost', port: 6379}] // Placeholder
        super(options)

        this.fetch = fetch;
    }

    public connect(callback: NodeCallback<NetStream>, eventEmitter: ErrorEmitter) {
        const sentinelCallback: FloatingSentinels = (err, result) => {
            if (err) {
                callback(err);
                return;
            } else if (!result.length) {
                callback(new Error(EMPTY_SENTINELS_MSG));
                return;
            }

            this.options.sentinels = result;
            this.sentinelIterator = new SentinelIterator(result)
            super.connect(callback, eventEmitter);
        }

        this.fetch(sentinelCallback);
    }

}