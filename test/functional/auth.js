'use strict';

describe('auth', function () {
  it('should send auth before other commands', function (done) {
    var authed = false;
    var server = new MockServer(17379, function (argv) {
      if (argv[0] === 'auth' && argv[1] === 'pass') {
        authed = true;
      } else if (argv[0] === 'get' && argv[1] === 'foo') {
        expect(authed).to.eql(true);
        redis.disconnect();
        server.disconnect();
        done();
      }
    });
    var redis = new Redis({ port: 17379, password: 'pass' });
    redis.get('foo').catch(function () {});
  });

  it('should resend auth after reconnect', function (done) {
    var begin = false;
    var authed = false;
    var server = new MockServer(17379, function (argv) {
      if (!begin) {
        return;
      }
      if (argv[0] === 'auth' && argv[1] === 'pass') {
        authed = true;
      } else if (argv[0] === 'get' && argv[1] === 'foo') {
        expect(authed).to.eql(true);
        redis.disconnect();
        server.disconnect();
        done();
      }
    });
    var redis = new Redis({ port: 17379, password: 'pass' });
    redis.once('ready', function () {
      begin = true;
      redis.disconnect({ reconnect: true });
      redis.get('foo').catch(function () {});
    });
  });

  it('should emit "authError" when the server doesn\'t need auth', function (done) {
    var server = new MockServer(17379, function (argv) {
      if (argv[0] === 'auth' && argv[1] === 'pass') {
        return new Error('ERR Client sent AUTH, but no password is set');
      }
    });
    var redis = new Redis({ port: 17379, password: 'pass' });
    redis.on('authError', function (error) {
      expect(error).to.have.property('message', 'ERR Client sent AUTH, but no password is set');
      redis.disconnect();
      server.disconnect();
      done();
    });
  });

  it('should emit "authError" when the password is wrong', function (done) {
    var server = new MockServer(17379, function (argv) {
      if (argv[0] === 'auth' && argv[1] === 'pass') {
        return new Error('ERR invalid password');
      }
    });
    var redis = new Redis({ port: 17379, password: 'pass' });
    redis.on('authError', function (error) {
      expect(error).to.have.property('message', 'ERR invalid password');
      redis.disconnect();
      server.disconnect();
      done();
    });
  });
});
