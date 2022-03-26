const typeMaps = require("./typeMaps");

module.exports = {
  debug: [
    [{ name: "subcommand", type: "string" }],
    [
      { name: "subcommand", type: "string" },
      { name: "args", type: typeMaps.string("args"), multiple: true },
    ],
  ],
};
