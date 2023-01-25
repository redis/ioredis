export function waitForMonitorReady() {
  // It takes a while for the monitor to be ready.
  // This is a hack to wait for it because the monitor command
  // does not have a response
  return new Promise((resolve) => setTimeout(resolve, 150));
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
