export function noop() {}

export function defaults(...objects: object[]): object {
  objects.reverse();
  Object.assign.call(Object.assign, objects);
  return objects[0];
}

export function isArguments(value: any): value is ArrayLike<any> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.length === "number" &&
    Object.prototype.toString.call(value) === "[object Arguments]" &&
    Object.prototype.hasOwnProperty.call(value, "callee")
  );
}
