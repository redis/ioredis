module.exports = {
  set: (args) => {
    const sorted = args.sort((a, b) => {
      const order = ["key", "value", "expiration", "condition", "get"];
      const indexA = order.indexOf(a.name);
      const indexB = order.indexOf(b.name);
      if (indexA === -1) {
        throw new Error('Invalid argument name: "' + a.name + '"');
      }
      if (indexB === -1) {
        throw new Error('Invalid argument name: "' + b.name + '"');
      }
      return indexA - indexB;
    });
    return sorted;
  },
};
