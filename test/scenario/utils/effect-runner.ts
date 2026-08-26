/// <reference types="mocha" />

import type {
  ActionStatus,
  TopologyChangeStandaloneEffect,
  TopologyChangeStandaloneTriggerCombo,
} from "./fault-injector";
import { FaultInjectorClient } from "./fault-injector";
import type { RedisConnectionConfig } from "./test.util";

export interface EffectTriggerContext {
  effect: TopologyChangeStandaloneEffect;
  trigger: string;
  /** Connection details of the database created for this trigger. */
  databaseConfig: RedisConnectionConfig;
  /** Starts the topology change and returns a handle for its completion. */
  startEffect: () => Promise<RunningEffect>;
}

export interface RunningEffect {
  /** Waits for the runner-owned action completion task. */
  waitForCompletion(): Promise<ActionStatus>;
}

const EFFECT_TIMEOUT_MS = 240_000;

/**
 * Drives the fault injector lifecycle for standalone topology change
 * effects: trigger discovery, database creation, effect execution and
 * cleanup. Test bodies receive a context with the created database and the
 * effect controls, and keep their assertions inline.
 */
export class EffectRunner {
  private readonly combosByEffect = new Map<
    TopologyChangeStandaloneEffect,
    TopologyChangeStandaloneTriggerCombo[]
  >();

  constructor(private readonly faultInjector: FaultInjectorClient) {}

  /**
   * Defines one mocha test for an effect, titled `<title> [<effect>]`. The
   * body runs once per discovered trigger combination. Each run gets a
   * dedicated database that is deleted after the effect has settled.
   */
  it(
    title: string,
    effect: TopologyChangeStandaloneEffect,
    run: (context: EffectTriggerContext) => Promise<void>
  ): void {
    it(`${title} [${effect}]`, async () => {
      await this.runEffect(effect, run);
    });
  }

  private async runEffect(
    effect: TopologyChangeStandaloneEffect,
    run: (context: EffectTriggerContext) => Promise<void>
  ): Promise<void> {
    const combos = await this.discoverTriggers(effect);

    if (combos.length === 0) {
      throw new Error(`No triggers discovered for effect: ${effect}`);
    }

    for (const combo of combos) {
      const databaseConfig = await this.faultInjector.createDatabase(
        combo.databaseConfig
      );
      console.log(
        `    effect=${effect} trigger=${combo.trigger} bdb=${databaseConfig.bdbId}`
      );

      await this.runTrigger(effect, combo, databaseConfig, run);
    }
  }

  private async runTrigger(
    effect: TopologyChangeStandaloneEffect,
    combo: TopologyChangeStandaloneTriggerCombo,
    databaseConfig: RedisConnectionConfig,
    run: (context: EffectTriggerContext) => Promise<void>
  ): Promise<void> {
    const errors: unknown[] = [];
    let effectStarted = false;
    let runningEffectTask: Promise<RunningEffect> | undefined;

    const retainError = (error: unknown) => {
      if (!errors.includes(error)) {
        errors.push(error);
      }
    };

    try {
      try {
        await run({
          effect,
          trigger: combo.trigger,
          databaseConfig,
          startEffect: () => {
            if (effectStarted) {
              throw new Error("The effect has already been started");
            }
            effectStarted = true;

            runningEffectTask = Promise.resolve()
              .then(() =>
                this.faultInjector.topologyChangeStandaloneAction({
                  bdbId: databaseConfig.bdbId,
                  effect,
                  trigger: combo.trigger,
                })
              )
              .then(({ action_id: actionId }) => {
                const completion = this.faultInjector.waitForAction(actionId, {
                  maxWaitTimeMs: EFFECT_TIMEOUT_MS,
                });
                void completion.catch(() => {});

                return {
                  waitForCompletion: () => completion,
                };
              });
            // The runner observes this task after the body exits. Attach a
            // handler now as well in case the body starts it without awaiting.
            void runningEffectTask.catch(() => {});

            return runningEffectTask;
          },
        });
      } catch (error) {
        retainError(error);
      }

      if (runningEffectTask) {
        try {
          const runningEffect = await runningEffectTask;
          await runningEffect.waitForCompletion();
        } catch (error) {
          retainError(error);
        }
      }
    } finally {
      try {
        await this.faultInjector.deleteDatabaseWithRetry(databaseConfig.bdbId);
      } catch (error) {
        retainError(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `Multiple failures while running effect ${effect} with trigger ${combo.trigger}`
      );
    }
  }

  private async discoverTriggers(
    effect: TopologyChangeStandaloneEffect
  ): Promise<TopologyChangeStandaloneTriggerCombo[]> {
    const cached = this.combosByEffect.get(effect);
    if (cached) {
      return cached;
    }

    const combos =
      await this.faultInjector.listTopologyChangeStandaloneTriggerCombos(
        effect
      );
    this.combosByEffect.set(effect, combos);
    return combos;
  }
}
