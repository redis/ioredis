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
    expect(cluster.options).to.have.property('readOnly', false);
  });

  it('should throw when startupNodes is not an array or is empty', function () {
    expect(function () {
      new Cluster();
    }).to.throw(/startupNodes/);

    expect(function () {
      new Cluster([]);
    }).to.throw(/startupNodes/);

    expect(function () {
      new Cluster([{}]);
    }).to.not.throw(/startupNodes/);
  });

  describe('#executeFailoverCommands', function () {
    it('should execute the commands', function (done) {
      var cluster = {
        resetFailoverQueue: function () {
          this.failoverQueue = [];
        },
        failoverQueue: []
      };

      cluster.failoverQueue.push(function () {
        expect(this.failoverQueue).to.have.length(0);
        done();
      }.bind(cluster));
      Cluster.prototype.executeFailoverCommands.call(cluster);
    });
  });

  describe('#executeClusterDownCommands', function () {
    it('should execute the commands', function (done) {
      var cluster = {
        resetClusterDownQueue: function () {
          this.clusterDownQueue = [];
        },
        clusterDownQueue: []
      };

      cluster.clusterDownQueue.push(function () {
        expect(this.clusterDownQueue).to.have.length(0);
        done();
      }.bind(cluster));
      Cluster.prototype.executeClusterDownCommands.call(cluster);
    });
  });
});
