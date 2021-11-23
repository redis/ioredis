const VERSION_REGEX = /\bredis_version:(\d+)\.(\d+)\.(\d+)/;

export async function getRedisVersion(redis: Redis) {
  const raw = await redis.info("server");
  const match = VERSION_REGEX.exec(raw);
  if (match) {
    return [match[1], match[2], match[3]];
  }
  throw new Error(
    "Could not determine redis version from: " + JSON.stringify(raw)
  );
}
