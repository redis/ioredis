module.exports = {
  key: "RedisKey",
  string: (name) =>
    [
      "value",
      "member",
      "element",
      "arg",
      "id",
      "pivot",
      "threshold",
      "start",
      "end",
    ].some((pattern) => name.toLowerCase().includes(pattern))
      ? "string | Buffer | number"
      : "string | Buffer",
  pattern: "string",
  number: (name) =>
    ["seconds", "count", "start", "stop", "index"].some((pattern) =>
      name.toLowerCase().includes(pattern)
    )
      ? "number"
      : "number | string",
};
