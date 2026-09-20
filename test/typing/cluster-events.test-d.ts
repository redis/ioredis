import { expectType } from "tsd";
import { Cluster, Redis } from "../../built";

const cluster = new Cluster([]);

expectType<Cluster>(cluster.on("connect", () => {}));
expectType<Cluster>(cluster.on("ready", () => {}));
expectType<Cluster>(cluster.on("close", () => {}));
expectType<Cluster>(cluster.on("reconnecting", () => {}));
expectType<Cluster>(cluster.on("end", () => {}));
expectType<Cluster>(cluster.on("disconnecting", () => {}));
expectType<Cluster>(cluster.on("wait", () => {}));

expectType<Cluster>(
  cluster.on("error", (error) => {
    expectType<Error>(error);
  })
);

expectType<Cluster>(cluster.once("connect", () => {}));
expectType<Cluster>(cluster.once("ready", () => {}));
expectType<Cluster>(cluster.once("close", () => {}));
expectType<Cluster>(cluster.once("reconnecting", () => {}));
expectType<Cluster>(cluster.once("end", () => {}));
expectType<Cluster>(cluster.once("disconnecting", () => {}));
expectType<Cluster>(cluster.once("wait", () => {}));

expectType<Cluster>(
  cluster.once("error", (error) => {
    expectType<Error>(error);
  })
);

cluster.on("message", (channel, message) => {
  expectType<string>(channel);
  expectType<string>(message);
});

cluster.on("messageBuffer", (channel, message) => {
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

cluster.on("pmessage", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<string>(channel);
  expectType<string>(message);
});

cluster.on("pmessageBuffer", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

cluster.on("smessage", (channel, message) => {
  expectType<string>(channel);
  expectType<string>(message);
});

cluster.on("smessageBuffer", (channel, message) => {
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

cluster.once("message", (channel, message) => {
  expectType<string>(channel);
  expectType<string>(message);
});

cluster.once("messageBuffer", (channel, message) => {
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

cluster.once("pmessage", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<string>(channel);
  expectType<string>(message);
});

cluster.once("pmessageBuffer", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

cluster.once("smessage", (channel, message) => {
  expectType<string>(channel);
  expectType<string>(message);
});

cluster.once("smessageBuffer", (channel, message) => {
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

cluster.on("+node", (node) => {
  expectType<Redis>(node);
});

cluster.on("-node", (node, nodeKey) => {
  expectType<Redis>(node);
  expectType<string | undefined>(nodeKey);
});

cluster.on("node error", (error, nodeKey) => {
  expectType<Error>(error);
  expectType<string>(nodeKey);
});

cluster.on("nodeError", (error, nodeKey) => {
  expectType<Error>(error);
  expectType<string>(nodeKey);
});

cluster.once("+node", (node) => {
  expectType<Redis>(node);
});

cluster.once("-node", (node, nodeKey) => {
  expectType<Redis>(node);
  expectType<string | undefined>(nodeKey);
});

cluster.once("node error", (error, nodeKey) => {
  expectType<Error>(error);
  expectType<string>(nodeKey);
});

cluster.once("nodeError", (error, nodeKey) => {
  expectType<Error>(error);
  expectType<string>(nodeKey);
});

cluster.on("+subscriber", () => {});
cluster.on("-subscriber", () => {});
cluster.on("subscribersReady", () => {});
cluster.on("refresh", () => {});

cluster.once("+subscriber", () => {});
cluster.once("-subscriber", () => {});
cluster.once("subscribersReady", () => {});
cluster.once("refresh", () => {});
