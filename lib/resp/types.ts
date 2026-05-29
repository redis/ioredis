import { RESP_TYPES } from "./decoder";

export type RESP_TYPES = typeof RESP_TYPES;

export type RespTypes = RESP_TYPES[keyof RESP_TYPES];

export type MappedType<T = unknown> =
  | ((...args: any[]) => T)
  | (new (...args: any[]) => T);

export type TypeMapping = {
  [P in RespTypes]?: MappedType;
};
