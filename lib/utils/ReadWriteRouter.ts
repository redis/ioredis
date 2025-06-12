import { exists, hasFlag } from "@ioredis/commands";
import Command from "../Command";
import Redis from "../Redis";
import { Debug } from "../utils";

const debug = Debug("readwrite-router");

export type ScaleReadsFunction = (nodes: Redis[], command: Command) => Redis | Redis[];

/**
 * Utility class that handles read/write routing logic
 * Extracted from cluster implementation to be reusable
 */
export class ReadWriteRouter {
  private readInstances: Redis[] = [];
  private scaleReads: string | ScaleReadsFunction | undefined;
  private roundRobinIndex = 0;

  constructor(scaleReads?: string | ScaleReadsFunction, readInstances: Redis[] = []) {
    this.scaleReads = scaleReads;
    this.readInstances = readInstances;
  }

  /**
   * Determine if a command is read-only (same logic as cluster)
   */
  public isReadOnlyCommand(command: Command): boolean {
    return command.isReadOnly || 
           (exists(command.name) && hasFlag(command.name, "readonly"));
  }

  /**
   * Get the appropriate Redis instance for a command (adapted from cluster logic)
   */
  public getInstanceForCommand(command: Command, writeInstance: Redis): Redis {
    let to = this.scaleReads;

    // If scaleReads is not "master", check if command is read-only
    if (to !== "master") {
      const isCommandReadOnly = this.isReadOnlyCommand(command);
      if (!isCommandReadOnly) {
        to = "master";
      }
    }

    if (to === "master") {
      return writeInstance;
    }

    // Only route to instances that are actually connected. Instances that
    // failed to connect (or haven't finished connecting) fall back to the
    // primary instead of being queued on a potentially dead connection.
    const availableInstances = this.readInstances.filter(
      (instance) => instance.status === "ready"
    );
    if (availableInstances.length === 0) {
      return writeInstance;
    }

    // Handle function-based scaleReads
    if (typeof to === "function") {
      const selectedInstance = to(availableInstances, command);
      if (Array.isArray(selectedInstance)) {
        return this.nextRoundRobin(selectedInstance) || writeInstance;
      }
      return selectedInstance || writeInstance;
    }

    // Handle string-based scaleReads ("all" and "slave" both mean: use a read instance)
    if (to === "all" || to === "slave") {
      return this.nextRoundRobin(availableInstances) || writeInstance;
    }

    return writeInstance;
  }

  private nextRoundRobin(instances: Redis[]): Redis | undefined {
    if (instances.length === 0) {
      return undefined;
    }
    const instance = instances[this.roundRobinIndex % instances.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % instances.length;
    return instance;
  }

  /**
   * Update read instances
   */
  public setReadInstances(instances: Redis[]): void {
    this.readInstances = instances;
  }

  /**
   * Update scaleReads configuration
   */
  public setScaleReads(scaleReads?: string | ScaleReadsFunction): void {
    this.scaleReads = scaleReads;
  }

  /**
   * Get current read instances
   */
  public getReadInstances(): Redis[] {
    return this.readInstances;
  }
}