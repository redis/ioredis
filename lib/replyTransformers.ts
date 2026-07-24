import { ProtocolVersion, ReplyMappingMode } from "./types";

export interface ReplyTransformerContext {
  commandName: string;
  protocol: ProtocolVersion;
  replyMapping: ReplyMappingMode;
}

export interface ReplyContext {
  protocol?: ProtocolVersion;
  replyMapping?: ReplyMappingMode;
}

export type ReplyTransformer = (
  reply: any,
  context: ReplyTransformerContext
) => any;

export const passthroughReplyTransformer: ReplyTransformer = function (result) {
  return result;
};

export const flattenNestedArrayItems: ReplyTransformer = function (result) {
  if (!Array.isArray(result)) {
    return result;
  }

  let flat: any[] | null = null;
  for (let i = 0; i < result.length; i++) {
    const item = result[i];
    if (Array.isArray(item)) {
      if (!flat) {
        flat = result.slice(0, i);
      }
      flat.push(...item);
    } else if (flat) {
      flat.push(item);
    }
  }
  return flat ?? result;
};

const flattenPairTransformers: Record<
  ProtocolVersion,
  Record<ReplyMappingMode, ReplyTransformer>
> = {
  2: {
    legacy: passthroughReplyTransformer,
    resp3: passthroughReplyTransformer,
  },
  3: {
    legacy: flattenNestedArrayItems,
    resp3: passthroughReplyTransformer,
  },
};

const vsimTransformers: Record<
  ProtocolVersion,
  Record<ReplyMappingMode, ReplyTransformer>
> = {
  2: {
    legacy: flattenNestedArrayItems,
    resp3: passthroughReplyTransformer,
  },
  3: {
    legacy: flattenNestedArrayItems,
    resp3: passthroughReplyTransformer,
  },
};

export const wrapStreamMapPairs: ReplyTransformer = function (result) {
  if (!Array.isArray(result)) {
    return result;
  }

  const wrapped: any[] = [];
  for (let i = 0; i < result.length; i += 2) {
    wrapped.push([result[i], result[i + 1]]);
  }
  return wrapped;
};

const streamReadTransformers: Record<
  ProtocolVersion,
  Record<ReplyMappingMode, ReplyTransformer>
> = {
  2: {
    legacy: passthroughReplyTransformer,
    resp3: passthroughReplyTransformer,
  },
  3: {
    legacy: wrapStreamMapPairs,
    resp3: passthroughReplyTransformer,
  },
};

export const transformVsimReply: ReplyTransformer = function (
  result,
  context
) {
  return vsimTransformers[context.protocol][context.replyMapping](
    result,
    context
  );
};

export const transformPairReply: ReplyTransformer = function (
  result,
  context
) {
  return flattenPairTransformers[context.protocol][context.replyMapping](
    result,
    context
  );
};

export const transformStreamReadReply: ReplyTransformer = function (
  result,
  context
) {
  return streamReadTransformers[context.protocol][context.replyMapping](
    result,
    context
  );
};

export const sortedSetWithScorePairCommands = [
  "zdiff",
  "zinter",
  "zpopmax",
  "zpopmin",
  "zunion",
  "zrandmember",
  "zrange",
  "zrangebyscore",
  "zrevrange",
  "zrevrangebyscore",
] as const;
