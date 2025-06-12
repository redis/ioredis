import { exists, hasFlag } from "@ioredis/commands";
import Command from "../Command";
import Redis from "../Redis";
import { Debug, sample } from "../utils";

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

    // If we should use master or no read instances available
    if (to === "master" || this.readInstances.length === 0) {
      return writeInstance;
    }

    // Handle function-based scaleReads
    if (typeof to === "function") {
      const selectedInstance = to(this.readInstances, command);
      if (Array.isArray(selectedInstance)) {
        return sample(selectedInstance) || this.readInstances[0] || writeInstance;
      }
      return selectedInstance || this.readInstances[0] || writeInstance;
    }

    // Handle string-based scaleReads
    if (to === "all") {
      return sample(this.readInstances) || writeInstance;
    } else if (to === "slave") {
      // For standalone, "slave" means use read instances
      return sample(this.readInstances) || writeInstance;
    }

    // Default fallback
    return writeInstance;
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