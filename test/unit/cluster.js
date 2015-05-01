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
});
