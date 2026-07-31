/**
 * A long-lived HIMPORT fieldset managed by ioredis for the lifetime of a
 * logical Redis or Cluster client.
 *
 * @experimental
 */
export interface HimportFieldset {
  /**
   * The name referenced by later `HIMPORT SET` commands.
   */
  readonly name: string | Buffer;

  /**
   * Ordered hash field names. Values passed to `HIMPORT SET` are paired with
   * fields positionally.
   */
  readonly fields: readonly (string | Buffer)[];
}
