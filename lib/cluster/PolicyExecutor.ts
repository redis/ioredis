import { getPolicies, RequestPolicy, ResponsePolicy } from "@ioredis/commands";
import Command from "../Command";
import Redis from "../Redis";
import { Debug } from "../utils";
import ConnectionPool from "./ConnectionPool";

const debug = Debug("cluster:policyExecutor");

type NodeSelector = (pool: ConnectionPool) => Redis[];

/**
 * Aggregates the settled per-node replies into the single reply the caller
 * sees. Throwing rejects the command with the thrown error.
 */
type ReplyAggregator = (
  results: PromiseSettledResult<unknown>[],
  command: Command
) => unknown;

/**
 * Node selection per request policy. A policy without an entry falls back to
 * default single-node routing.
 */
const requestPolicyStrategies: Partial<Record<RequestPolicy, NodeSelector>> = {
  // Masters only: replicas never hold state the masters don't, and writes
  // execute on masters anyway.
  all_shards: (pool) => pool.getNodes("master"),
  // all_nodes / multi_shard / special: not implemented yet.
};

// All nodes must succeed, and their replies are expected to be identical —
// the first one is returned. A divergent reply is not an error (the server
// stays authoritative) but indicates a node session that missed a
// state-setup command (e.g. an HIMPORT PREPARE), so it's logged.
const allSucceededFirstReply: ReplyAggregator = (results, command) => {
  const replies: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      throw result.reason;
    }
    replies.push(result.value);
  }
  for (let i = 1; i < replies.length; i++) {
    if (String(replies[i]) !== String(replies[0])) {
      debug(
        "divergent %s reply across nodes (%s != %s): a node session may be missing state",
        command.name,
        replies[i],
        replies[0]
      );
      break;
    }
  }
  return replies[0];
};

/**
 * Reply aggregation per response policy. None are implemented yet — adding
 * an entry here (e.g. `agg_sum` for DBSIZE, `agg_min` for WAIT,
 * `agg_logical_and` for SCRIPT EXISTS, `one_succeeded` for FUNCTION KILL)
 * enables fan-out for every command advertising that policy, so each entry
 * must match the server-documented semantics exactly.
 */
const responsePolicyStrategies: Partial<
  Record<ResponsePolicy, ReplyAggregator>
> = {};

/**
 * Reply aggregation for commands that advertise a request policy but NO
 * response policy. These don't share a default: HIMPORT sets up identical
 * state on every node and returns identical replies, while e.g. KEYS calls
 * for concatenation and CLUSTER SLOT-STATS / SLOWLOG GET return genuinely
 * different replies per node. Aggregation is therefore opt-in per command
 * (the same model as redis-py's RESULT_CALLBACKS and Lettuce's per-command
 * multi-node implementations); commands without an entry keep their default
 * single-node routing.
 *
 * TODO(policy-executor): grow this map (and `responsePolicyStrategies`
 * above) command by command until the executor covers generic
 * policy-driven routing; only HIMPORT is supported for now.
 */
const noResponsePolicyStrategies: Record<string, ReplyAggregator> = {
  himport: allSucceededFirstReply,
};

/**
 * Executes commands according to the request/response policies advertised in
 * their command metadata (COMMAND INFO tips).
 *
 * Both policies are resolved through strategy maps: the request policy picks
 * the target nodes, the response policy aggregates their replies. A command
 * whose policies aren't (both) implemented falls through to the cluster's
 * default single-node routing.
 */
export default class PolicyExecutor {
  constructor(private connectionPool: ConnectionPool) {}

  /**
   * Take over the execution of a command when its request policy calls for
   * it. Returns `true` when the command was handled (its promise will settle
   * with the aggregated result), `false` when the caller should continue
   * with default routing.
   */
  execute(command: Command): boolean {
    const { requestPolicy, responsePolicy } = getPolicies(
      command.name,
      command.args as (string | Buffer | number)[]
    );

    const selectNodes = requestPolicy
      ? requestPolicyStrategies[requestPolicy]
      : undefined;
    if (!selectNodes) {
      if (requestPolicy) {
        debug(
          "request policy %s of %s is not implemented, using default routing",
          requestPolicy,
          command.name
        );
      }
      return false;
    }

    const aggregate = responsePolicy
      ? responsePolicyStrategies[responsePolicy]
      : noResponsePolicyStrategies[command.name.toLowerCase()];
    if (!aggregate) {
      debug(
        "%s reply handling of %s is not implemented, using default routing",
        responsePolicy ?? "no-response-policy",
        command.name
      );
      return false;
    }

    const nodes = selectNodes(this.connectionPool);
    if (!nodes.length) {
      return false;
    }

    debug(
      "fan out %s to %d node(s) (request policy %s)",
      command.name,
      nodes.length,
      requestPolicy
    );

    const replies = nodes.map((redis) => {
      const clone = new Command(command.name, command.args, {
        replyEncoding: command.getReplyEncoding(),
      });
      redis.sendCommand(clone);
      return clone.promise;
    });

    Promise.allSettled(replies).then((results) => {
      try {
        command.resolve(aggregate(results, command));
      } catch (err) {
        command.reject(err as Error);
      }
    });

    return true;
  }
}
