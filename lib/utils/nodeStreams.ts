import { executeWithAutoPipelining } from "../autoPipelining";
import Commander from "./Commander";
import { GetStreamOptions, RedisKey } from "./RedisCommander";

export async function* createGetStream(client: Commander, key: RedisKey, opts: GetStreamOptions = {}) {
    const size = opts.chunkSize || 10 * 1000;
    let cursor = 0;
    let isReadable = true;
    const isPipelineMode = opts.pipeline !== false;

    while (isReadable) {
      let chunk;
      if (isPipelineMode) {
        chunk = await executeWithAutoPipelining(client, 'getrange', 'range', [key, cursor, cursor + size - 1], null)
      } else {
        chunk = await client.getrange(key, cursor, cursor + size - 1);
      }
      if (!chunk || typeof chunk !== 'string' || chunk?.length === 0) {
        isReadable = false;
      } else {
        cursor += chunk.length;
        yield chunk;
      }
    }
  };