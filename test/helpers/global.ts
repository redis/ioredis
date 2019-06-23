'use strict';

import * as sinon from 'sinon'
import Redis from '../../lib/redis'

afterEach(function (done) {
  sinon.restore()
  new Redis().pipeline().flushall().script('flush').client('kill', 'normal').exec(done);
});

console.error = function () {}
