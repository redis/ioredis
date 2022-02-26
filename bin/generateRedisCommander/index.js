const returnTypes = require("./returnTypes");
const argumentTypes = require("./argumentTypes");
const typeMaps = require("./typeMaps");
const { getCommanderInterface } = require("@ioredis/interface-generator");

const ignoredCommands = ["monitor", "multi"];
const commands = require("redis-commands").list.filter(
  (name) => !ignoredCommands.includes(name)
);

const fs = require("fs");
const path = require("path");

const template = fs.readFileSync(path.join(__dirname, "/template.ts"), "utf8");

async function main() {
  const interface = await getCommanderInterface({
    commands,
    complexityLimit: 50,
    redisOpts: {
      port: process.env.REDIS_PORT,
    },
    returnTypes,
    argumentTypes,
    typeMaps: typeMaps,
    ignoredBufferVariant: [
      "incrbyfloat",
      "type",
      "info",
      "latency",
      "lolwut",
      "memory",
    ],
  });

  fs.writeFileSync(
    path.join(__dirname, "..", "..", "lib/utils/RedisCommander.ts"),
    template.replace("////", () => interface)
  );
}

main()
  .catch(console.error)
  .then(() => process.exit(0));
