import { expect } from 'chai';
import * as sinon from 'sinon';
import DataHandler from '../../lib/DataHandler';

describe('DataHandler', () => {
  it('attaches data handler to stream in correct order | https://github.com/redis/ioredis/issues/1919', () => {

    const prependListener = sinon.spy((event: string, handler: Function) => {
      expect(event).to.equal('data');
    });

    const resume = sinon.spy();

    new DataHandler({
      stream: {
        prependListener,
        resume
      }
    } as any, {} as any);

    expect(prependListener.calledOnce).to.be.true;
    expect(resume.calledOnce).to.be.true;
    expect(resume.calledAfter(prependListener)).to.be.true;
  });
});