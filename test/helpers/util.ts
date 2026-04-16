import Redis from "../../lib/Redis";

export function waitForMonitorReady() {
  // It takes a while for the monitor to be ready.
  // This is a hack to wait for it because the monitor command
  // does not have a response
  return new Promise((resolve) => setTimeout(resolve, 150));
}

function parseRedisVersion(version: string): number[] {
  return version.match(/\d+/g)?.slice(0, 2).map(Number) ?? [0, 0];
}

function compareRedisVersions(left: string, right: string): number {
  const leftParts = parseRedisVersion(left);
  const rightParts = parseRedisVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

export async function isRedisVersionLowerThan(
  minimumVersion: string
): Promise<boolean> {
  const redis = new Redis();

  try {
    const info = await redis.info("server");
    const version = info.match(/^redis_version:(.+)$/m)?.[1]?.trim();

    if (!version) {
      throw new Error(
        "Could not determine redis_version from INFO server response"
      );
    }

    return compareRedisVersions(version, minimumVersion) < 0;
  } finally {
    redis.disconnect();
  }
}

export async function getCommandsFromMonitor(
  redis: any,
  count: number,
  exec: Function
): Promise<[any]> {
  const arr: string[] = [];
  const monitor = await redis.monitor();
  await waitForMonitorReady();
  const promise = new Promise((resolve, reject) => {
    setTimeout(reject, 1000, new Error("Monitor timed out"));
    monitor.on("monitor", (_, command) => {
      if (arr.length !== count) arr.push(command);
      if (arr.length === count) {
        resolve(arr);
        monitor.disconnect();
      }
    });
  });

  const [commands] = await Promise.all<[any]>([promise, exec()]);
  return commands;
}
