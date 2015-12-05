'use strict';

var Cluster = require('../../lib/cluster');

describe('cluster', function () {
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
