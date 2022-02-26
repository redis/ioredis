const VERSION_REGEX = /\bredis_version:(\d+)\.(\d+)\.(\d+)/;

export function waitForMonitorReady(redis) {
  // It takes a while for the monitor to be ready.
  // This is a hack to wait for it because the monitor command
  // does not have a response
  return new Promise((resolve) => setTimeout(resolve, 150));
}

export async function getRedisVersion(
  redis: any
): Promise<[number, number, number]> {
  const raw = await redis.info("server");
  const match = VERSION_REGEX.exec(raw);
  if (match) {
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  throw new Error(
    "Could not determine redis version from: " + JSON.stringify(raw)
  );
}

export async function getCommandsFromMonitor(
  redis: any,
  count: number,
  exec: Function
): Promise<[any]> {
  const arr = [];
  const monitor = await redis.monitor();
  await waitForMonitorReady(monitor);
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
