type Constructor = new (...args: any[]) => void;
function applyMixin(
  derivedConstructor: Constructor,
  mixinConstructor: Constructor
) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(
      derivedConstructor.prototype,
      name,
      Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name)
    );
  });
}

export default applyMixin;
