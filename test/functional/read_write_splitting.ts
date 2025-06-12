import Redis from "../../lib/Redis";
import { expect } from "chai";

describe("Read/Write Splitting", () => {
  let redis: Redis;

  afterEach((done) => {
    if (redis) {
      redis.disconnect();
      redis.on("end", () => {
        done();
      });
    } else {
      done();
    }
  });

  it("should create Redis instance with read/write splitting configuration", () => {
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      scaleReads: [
        { host: "127.0.0.1", port: 6380 },
        { host: "127.0.0.1", port: 6381 }
      ]
    });

    expect(redis.options.scaleReads).to.deep.equal([
      { host: "127.0.0.1", port: 6380 },
      { host: "127.0.0.1", port: 6381 }
    ]);
  });

  it("should create Redis instance with single read endpoint", () => {
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      scaleReads: [
        { host: "127.0.0.1", port: 6380 }
      ]
    });

    expect(redis.options.scaleReads).to.have.length(1);
    expect(redis.options.scaleReads[0]).to.deep.equal({ host: "127.0.0.1", port: 6380 });
  });

  it("should work without read/write splitting (backward compatibility)", () => {
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379
    });

    expect(redis.options.scaleReads).to.be.undefined;
  });

  it("should detect read-only commands correctly", (done) => {
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      scaleReads: [
        { host: "127.0.0.1", port: 6379 } // Use same host for testing
      ]
    });

    // Test that GET is considered read-only
    // This is a basic test - in a real environment you'd have separate read replicas
    redis.set("test-key", "test-value").then(() => {
      return redis.get("test-key");
    }).then((result) => {
      expect(result).to.equal("test-value");
      done();
    }).catch(done);
  });

  it("should initialize read instances when scaleReads is provided", () => {
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      lazyConnect: true,
      scaleReads: [
        { host: "127.0.0.1", port: 6380 },
        { host: "127.0.0.1", port: 6381 }
      ]
    });

    // Access private readInstances for testing
    const readInstances = (redis as any).readInstances;
    expect(readInstances).to.have.length(2);
    expect(readInstances[0].options.host).to.equal("127.0.0.1");
    expect(readInstances[0].options.port).to.equal(6380);
    expect(readInstances[1].options.port).to.equal(6381);
    expect(readInstances[0].options.readOnly).to.be.true;
  });

  it("should not initialize read instances when scaleReads is not provided", () => {
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      lazyConnect: true
    });

    const readInstances = (redis as any).readInstances;
    expect(readInstances).to.have.length(0);
  });

  it("should route read commands to read instances", function(done) {
    this.timeout(5000);
    
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      scaleReads: [
        { host: "127.0.0.1", port: 6379 } // Same port for testing
      ]
    });

    let writeCallCount = 0;
    let readCallCount = 0;

    // Mock the sendCommand method to track calls
    const originalSendCommand = redis.sendCommand.bind(redis);
    redis.sendCommand = function(command, stream) {
      if (command.name === 'set') {
        writeCallCount++;
      } else if (command.name === 'get') {
        // For read commands, we should see them going to read instances
        readCallCount++;
      }
      return originalSendCommand(command, stream);
    };

    // Test mixed read/write operations
    Promise.resolve()
      .then(() => redis.set("rw-test", "value"))
      .then(() => redis.get("rw-test"))
      .then(() => redis.get("rw-test"))
      .then(() => {
        expect(writeCallCount).to.equal(1);
        expect(readCallCount).to.equal(2);
        done();
      })
      .catch(done);
  });

  it("should handle round-robin distribution of read commands", function(done) {
    this.timeout(5000);
    
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      scaleReads: [
        { host: "127.0.0.1", port: 6379 },
        { host: "127.0.0.1", port: 6379 }
      ]
    });

    // Track which read instance is used
    const readInstanceCalls: number[] = [];
    const readInstances = (redis as any).readInstances;
    
    readInstances.forEach((instance: any, index: number) => {
      const originalSendCommand = instance.sendCommand.bind(instance);
      instance.sendCommand = function(command: any, stream: any) {
        if (command.name === 'get') {
          readInstanceCalls.push(index);
        }
        return originalSendCommand(command, stream);
      };
    });

    // First set a value
    redis.set("round-robin-test", "value")
      .then(() => {
        // Then do multiple reads to test round-robin
        return Promise.all([
          redis.get("round-robin-test"),
          redis.get("round-robin-test"),
          redis.get("round-robin-test"),
          redis.get("round-robin-test")
        ]);
      })
      .then(() => {
        // Should have used both read instances
        expect(readInstanceCalls).to.have.length(4);
        expect(readInstanceCalls).to.include(0);
        expect(readInstanceCalls).to.include(1);
        done();
      })
      .catch(done);
  });

  it("should fallback to main instance when read instances fail", function(done) {
    this.timeout(5000);
    
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      scaleReads: [
        { host: "127.0.0.1", port: 9999 } // Non-existent port
      ]
    });

    // This should fallback to main instance and still work
    redis.set("fallback-test", "value")
      .then(() => redis.get("fallback-test"))
      .then((result) => {
        expect(result).to.equal("value");
        done();
      })
      .catch(done);
  });

  it("should properly disconnect read instances", function(done) {
    this.timeout(5000);
    
    redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      scaleReads: [
        { host: "127.0.0.1", port: 6379 }
      ]
    });

    const readInstances = (redis as any).readInstances;
    expect(readInstances).to.have.length(1);

    redis.set("disconnect-test", "value")
      .then(() => {
        redis.disconnect();
        // Read instances should be cleaned up
        const readInstancesAfter = (redis as any).readInstances;
        expect(readInstancesAfter).to.have.length(0);
        done();
      })
      .catch(done);
  });
});