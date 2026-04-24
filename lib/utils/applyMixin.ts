type Constructor = new (...args: any[]) => void;

function applyMixin(
  derivedConstructor: Constructor,
  mixinConstructor: Constructor
) {
  const descriptors = Object.getOwnPropertyDescriptors(
    mixinConstructor.prototype
  );

  // Never copy `constructor` — every class's prototype has its own
  // `constructor` pointing to itself. Overwriting it makes
  // `instance.constructor` resolve to the mixin class instead of the
  // derived class, breaking `new this.constructor(...)` patterns
  // such as `duplicate()` on subclasses (#2053).
  delete descriptors.constructor;

  Object.defineProperties(derivedConstructor.prototype, descriptors);
}

export default applyMixin;
