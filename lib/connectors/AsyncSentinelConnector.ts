import SentinelConnector, { ISentinelConnectionOptions, ISentinelAddress, SentinelIterator, EMPTY_SENTINELS_MSG } from './SentinelConnector';
import { ErrorEmitter } from './AbstractConnector';
import { NetStream } from '../types';
import { NodeCallback } from './types';

export type AsyncSentinelFetch = () => Promise<Partial<ISentinelAddress>[]>

export default class AsyncSentinelConnector extends SentinelConnector {
    private fetch: AsyncSentinelFetch

    constructor(options: ISentinelConnectionOptions, fetch: AsyncSentinelFetch) {
        options.sentinels = options.sentinels || [{host: 'localhost', port: 6379}] // Placeholder
        super(options)

        this.fetch = fetch;
    }

    public connect(callback: NodeCallback<NetStream>, eventEmitter: ErrorEmitter) {
        this.fetch()
            .then(sentinels => {
                if (!sentinels.length) throw new Error(EMPTY_SENTINELS_MSG);

                this.options.sentinels = sentinels;
                this.sentinelIterator = new SentinelIterator(sentinels)
                return super.connect(callback, eventEmitter);
            })
            .catch(callback);
    }

}