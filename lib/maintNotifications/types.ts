export const MaintenanceNotificationType = {
  MOVING: "MOVING",
  MIGRATING: "MIGRATING",
  MIGRATED: "MIGRATED",
  FAILING_OVER: "FAILING_OVER",
  FAILED_OVER: "FAILED_OVER",
} as const;

export type MaintenanceNotificationType =
  typeof MaintenanceNotificationType[keyof typeof MaintenanceNotificationType];

export interface MaintenanceEndpoint {
  host: string;
  port: number;
}

interface MaintenanceNotificationBase {
  type: MaintenanceNotificationType;
  sequenceNumber: number;
}

export interface MovingNotification extends MaintenanceNotificationBase {
  type: typeof MaintenanceNotificationType.MOVING;
  timeSeconds: number;
  endpoint: MaintenanceEndpoint | null;
}

export interface MigratingNotification extends MaintenanceNotificationBase {
  type: typeof MaintenanceNotificationType.MIGRATING;
  timeSeconds: number;
  shardIds?: string[];
}

export interface MigratedNotification extends MaintenanceNotificationBase {
  type: typeof MaintenanceNotificationType.MIGRATED;
  shardIds?: string[];
}

export interface FailingOverNotification extends MaintenanceNotificationBase {
  type: typeof MaintenanceNotificationType.FAILING_OVER;
  timeSeconds: number;
  shardIds?: string[];
}

export interface FailedOverNotification extends MaintenanceNotificationBase {
  type: typeof MaintenanceNotificationType.FAILED_OVER;
  shardIds?: string[];
}

export type MaintenanceNotification =
  | MovingNotification
  | MigratingNotification
  | MigratedNotification
  | FailingOverNotification
  | FailedOverNotification;
