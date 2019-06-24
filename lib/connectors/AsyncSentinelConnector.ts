import SentinelConnector, {
    ISentinelConnectionOptions,
    ISentinelAddress,
    SentinelIterator,
    EMPTY_SENTINELS_MSG } from './SentinelConnector';
import { ErrorEmitter } from './AbstractConnector';
import { NetStream } from '../types';

export type AsyncSentinelFetch = () => Promise<Partial<ISentinelAddress>[]>

export interface IAsyncSentinelConnectionOptions extends Pick<ISentinelConnectionOptions, Exclude<keyof ISentinelConnectionOptions, 'sentinels'>> {
    sentinels?: Partial<ISentinelAddress>[]
}

export default class AsyncSentinelConnector extends SentinelConnector {
    private fetch: AsyncSentinelFetch

    constructor(options: IAsyncSentinelConnectionOptions, fetch: AsyncSentinelFetch) {
        options.sentinels = options.sentinels || [{host: 'localhost', port: 6379}] // Placeholder
        super(options as ISentinelConnectionOptions)

        this.fetch = fetch;
    }

    public connect(eventEmitter: ErrorEmitter): Promise<NetStream> {
        return this.fetch().then(sentinels => {
            if (!sentinels.length) throw new Error(EMPTY_SENTINELS_MSG);

            this.options.sentinels = sentinels;
            this.sentinelIterator = new SentinelIterator(sentinels)
            return super.connect(eventEmitter);
        });
    }

}