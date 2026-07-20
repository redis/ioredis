// The RESP client configurations exercised by command tests.
//
//   A = protocol 2 + legacy mapping  -> classic ioredis baseline
//   B = protocol 3 + legacy mapping  -> RESP3 wire, replies flattened to RESP2 shape
//   C = protocol 3 + resp3 mapping   -> native RESP3 shape
//
// protocol 2 + resp3 mapping is invalid (throws) and is deliberately absent.
export type ReplyMapping = "legacy" | "resp3";

export const RESP_CONFIGS: ReadonlyArray<{
  name: string;
  opts: { protocol: 2 | 3; replyMapping: ReplyMapping };
}> = [
  { name: "RESP2/legacy", opts: { protocol: 2, replyMapping: "legacy" } },
  { name: "RESP3/legacy", opts: { protocol: 3, replyMapping: "legacy" } },
  { name: "RESP3/resp3", opts: { protocol: 3, replyMapping: "resp3" } },
];