var Redis = require('./redis');

function RedisCluster (startupNodes) {
  this.startupNodes = startupNodes;
  this.refreshTableASAP = false;

  this.initializeSlotsCache();
}

RedisCluster.prototype.initializeSlotsCache = function () {
  var _this = this;
  tryNode(0);
  function tryNode(index) {
    getInfoFromNode(this.startupNodes[0], function (err, result) {
      if (err) {
        return tryNode(index + 1);
      }
      _this.slots = result.slots;
      _this.nodes = result.nodes;
    });
  }
};

RedisCluster.prototype.getInfoFromNode = function (node, callback) {
  var redis = new Redis(node);
  redis.cluster('slots', function () {
  });
};

module.exports = RedisCluster;
