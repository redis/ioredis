'use strict';

var Cluster = require('../../lib/cluster');
var Promise = require('bluebird');

describe('cluster', function () {
  beforeEach(function () {
    stub(Cluster.prototype, 'connect', function () {
      return Promise.resolve();
    });
  });

  afterEach(function () {
    Cluster.prototype.connect.restore();
  });

  it('should support frozen options', function () {
    var options = Object.freeze({ maxRedirections: 1000 });
    var cluster = new Cluster([{ port: 7777 }], options);
    expect(cluster.options).to.have.property('showFriendlyErrorStack', false);
    expect(cluster.options).to.have.property('showFriendlyErrorStack', false);
    expect(cluster.options).to.have.property('scaleReads', 'master');
  });
});
