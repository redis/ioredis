describe('Redis', function () {
  describe('constructor', function () {
    it('should parse options correctly', function () {
      stub(Redis.prototype, 'connect');

      try {
        var option1 = getOption();
        expect(option1).to.have.property('port', 6379);
        expect(option1).to.have.property('host', 'localhost');
        expect(option1).to.have.property('family', 4);

        var option2 = getOption(6380);
        expect(option2).to.have.property('port', 6380);
        expect(option2).to.have.property('host', 'localhost');

        var option3 = getOption(6381, '192.168.1.1');
        expect(option3).to.have.property('port', 6381);
        expect(option3).to.have.property('host', '192.168.1.1');

        var option4 = getOption(6381, '192.168.1.1', {
          password: '123',
          db: 2
        });
        expect(option4).to.have.property('port', 6381);
        expect(option4).to.have.property('host', '192.168.1.1');
        expect(option4).to.have.property('password', '123');
        expect(option4).to.have.property('db', 2);

        var option5 = getOption('redis://:authpassword@127.0.0.1:6380/4');
        expect(option5).to.have.property('port', 6380);
        expect(option5).to.have.property('host', '127.0.0.1');
        expect(option5).to.have.property('password', 'authpassword');
        expect(option5).to.have.property('db', 4);

        var option6 = getOption('/tmp/redis.sock');
        expect(option6).to.have.property('path', '/tmp/redis.sock');

        var option7 = getOption({
          port: 6380,
          host: '192.168.1.1'
        });
        expect(option7).to.have.property('port', 6380);
        expect(option7).to.have.property('host', '192.168.1.1');

        var option8 = getOption(6380, {
          host: '192.168.1.1'
        });
        expect(option8).to.have.property('port', 6380);
        expect(option8).to.have.property('host', '192.168.1.1');
      } catch (err) {
        Redis.prototype.connect.restore();
        throw err;
      }
      Redis.prototype.connect.restore();

      function getOption () {
        var redis = Redis.apply(null, arguments);
        return redis.options;
      }
    });
  });
});
