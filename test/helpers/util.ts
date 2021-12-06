const VERSION_REGEX = /\bredis_version:(\d+)\.(\d+)\.(\d+)/;

export async function getRedisVersion(redis: Redis): [number, number, number] {
  const raw = await redis.info("server");
  const match = VERSION_REGEX.exec(raw);
  if (match) {
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  throw new Error(
    "Could not determine redis version from: " + JSON.stringify(raw)
  );
}
