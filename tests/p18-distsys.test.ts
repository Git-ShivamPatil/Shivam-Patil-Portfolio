import { describe, it, expect, vi } from "vitest";

// Every module here builds the Prisma client at import time; the logic under
// test is pure.
vi.mock("../lib/prisma", () => ({ prisma: {} }));

import { backoffMs, MAX_ATTEMPTS } from "../lib/distsys/outbox";
import { hashBody, isValidKey } from "../lib/distsys/idempotency";
import {
  HEARTBEAT_TICKS,
  MAX_ELECTION_TICKS,
  MIN_ELECTION_TICKS,
  createCluster,
  hasQuorum,
  killNode,
  majority,
  reviveNode,
  seededRandom,
  tick,
  type RaftState,
} from "../lib/distsys/raft";

/**
 * P18 — distributed systems.
 *
 * The Raft tests are the interesting ones: they assert the *invariants the
 * protocol guarantees* rather than that an animation moves. "Two leaders cannot
 * exist in one term" is a property; "the circles turn green" is a screenshot.
 */

describe("outbox backoff", () => {
  it("grows quadratically and stays inside a useful window", () => {
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(40_000);
    expect(backoffMs(3)).toBe(90_000);
    // Doubling would reach hours by the sixth attempt, which for a contact
    // email means a message that failed twice arrives tomorrow — technically
    // delivered, practically lost.
    expect(backoffMs(MAX_ATTEMPTS)).toBeLessThanOrEqual(600_000);
  });

  it("is monotonic — a later attempt never retries sooner", () => {
    for (let attempt = 1; attempt < 20; attempt++) {
      expect(backoffMs(attempt + 1)).toBeGreaterThanOrEqual(backoffMs(attempt));
    }
  });

  it("caps, so a stuck event does not schedule itself past the heat death", () => {
    expect(backoffMs(1000)).toBe(600_000);
  });
});

describe("idempotency keys", () => {
  it("rejects keys too short to be unguessable or too long to store", () => {
    expect(isValidKey(null)).toBe(false);
    expect(isValidKey("short")).toBe(false);
    expect(isValidKey("a".repeat(8))).toBe(true);
    expect(isValidKey("a".repeat(201))).toBe(false);
  });

  it("hashes the body, so a reused key with different content is detectable", () => {
    // The failure this catches is a client that generates one key and reuses it
    // for every request. Replaying the first response forever would hide that
    // bug permanently.
    expect(hashBody('{"a":1}')).toBe(hashBody('{"a":1}'));
    expect(hashBody('{"a":1}')).not.toBe(hashBody('{"a":2}'));
  });
});

describe("quorum arithmetic", () => {
  it("is strictly more than half", () => {
    expect(majority(1)).toBe(1);
    expect(majority(3)).toBe(2);
    expect(majority(4)).toBe(3);
    expect(majority(5)).toBe(3);
  });

  it("makes an even cluster no more fault-tolerant than the odd one below it", () => {
    // Failures tolerated is size - majority: 4 nodes tolerate 1, exactly as 3
    // do. That is the reason clusters are sized odd — the fourth node adds cost
    // and no availability.
    expect(4 - majority(4)).toBe(3 - majority(3));
    expect(5 - majority(5)).toBe(2);
  });
});

describe("Raft leader election", () => {
  /** Run until a leader exists or the budget runs out. */
  function runUntilLeader(state: RaftState, random: () => number, budget = 200): RaftState {
    let current = state;
    for (let step = 0; step < budget && current.leaderId === null; step++) {
      current = tick(current, random);
    }
    return current;
  }

  it("elects exactly one leader from a cold start", () => {
    const random = seededRandom(42);
    const settled = runUntilLeader(createCluster(5, random), random);

    expect(settled.leaderId).not.toBeNull();
    expect(settled.nodes.filter((node) => node.state === "leader")).toHaveLength(1);
  });

  it("never allows two leaders in the same term", () => {
    // The invariant Raft exists to provide. One vote per node per term is what
    // makes it impossible: two leaders would need two majorities of the same
    // set, which would have to overlap.
    const random = seededRandom(7);
    let state = createCluster(5, random);

    for (let step = 0; step < 400; step++) {
      state = tick(state, random);
      const leaders = state.nodes.filter((node) => node.state === "leader");
      const terms = new Set(leaders.map((node) => node.term));
      expect(terms.size).toBe(leaders.length);
      expect(leaders.length).toBeLessThanOrEqual(1);
    }
  });

  it("only ever increases a term", () => {
    const random = seededRandom(11);
    let state = createCluster(5, random);
    let highest = 0;

    for (let step = 0; step < 300; step++) {
      state = tick(state, random);
      const term = Math.max(...state.nodes.map((node) => node.term));
      expect(term).toBeGreaterThanOrEqual(highest);
      highest = term;
    }
  });

  it("elects a new leader after the current one dies", () => {
    const random = seededRandom(99);
    let state = runUntilLeader(createCluster(5, random), random);
    const original = state.leaderId!;

    state = killNode(state, original);
    expect(state.leaderId).toBeNull();

    state = runUntilLeader(state, random);
    expect(state.leaderId).not.toBeNull();
    expect(state.leaderId).not.toBe(original);
  });

  it("elects nobody once quorum is lost, and an existing leader steps down", () => {
    // Three of five down. The remaining two can never reach a majority, so the
    // correct behaviour is to stop — and, if the surviving side happens to
    // include the leader, for that leader to step down rather than keep
    // committing to a cluster that no longer exists. Caught by this test: the
    // first version kept a surviving leader in place, which is the split-brain
    // the protocol exists to prevent.
    const random = seededRandom(5);
    let state = runUntilLeader(createCluster(5, random), random);
    state = killNode(state, 0);
    state = killNode(state, 1);
    state = killNode(state, 2);

    expect(hasQuorum(state)).toBe(false);

    for (let step = 0; step < 200; step++) state = tick(state, random);
    expect(state.nodes.filter((node) => node.state === "leader")).toHaveLength(0);
  });

  it("recovers once quorum returns", () => {
    const random = seededRandom(5);
    let state = runUntilLeader(createCluster(5, random), random);
    state = killNode(state, 0);
    state = killNode(state, 1);
    state = killNode(state, 2);
    for (let step = 0; step < 60; step++) state = tick(state, random);

    state = reviveNode(state, 0, random);
    state = reviveNode(state, 1, random);
    expect(hasQuorum(state)).toBe(true);

    state = runUntilLeader(state, random);
    expect(state.leaderId).not.toBeNull();
  });

  it("brings a revived node back as a follower, never as a leader", () => {
    // A returning node must learn the current term from a heartbeat rather than
    // asserting leadership on stale information.
    const random = seededRandom(3);
    let state = runUntilLeader(createCluster(5, random), random);
    const leader = state.leaderId!;
    state = killNode(state, leader);
    state = runUntilLeader(state, random);
    state = reviveNode(state, leader, random);

    expect(state.nodes.find((node) => node.id === leader)?.state).toBe("follower");
    expect(state.leaderId).not.toBe(leader);
  });

  it("is deterministic for a given seed", () => {
    // An interesting scenario has to be reproducible, not something you wait
    // for.
    const runOnce = () => {
      const random = seededRandom(2026);
      let state = createCluster(5, random);
      for (let step = 0; step < 120; step++) state = tick(state, random);
      return state.nodes.map((node) => [node.id, node.state, node.term]);
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it("randomises election timeouts, which is what makes it terminate", () => {
    // With a fixed timeout every follower stands at once, every candidate votes
    // for itself, nobody reaches a majority, and it splits again next term —
    // forever.
    expect(MAX_ELECTION_TICKS).toBeGreaterThan(MIN_ELECTION_TICKS);

    const random = seededRandom(1);
    const state = createCluster(9, random);
    const timeouts = new Set(state.nodes.map((node) => node.timeout));
    expect(timeouts.size).toBeGreaterThan(1);
  });

  it("keeps followers quiet while a leader heartbeats", () => {
    const random = seededRandom(21);
    let state = runUntilLeader(createCluster(5, random), random);
    const leaderTerm = state.nodes.find((node) => node.state === "leader")!.term;

    for (let step = 0; step < HEARTBEAT_TICKS * 12; step++) state = tick(state, random);

    // A healthy cluster does not churn terms. Any increase here would mean the
    // heartbeat is failing to reset follower timers.
    expect(state.nodes.find((node) => node.state === "leader")?.term).toBe(leaderTerm);
  });

  it("bounds the event log so a long run cannot leak", () => {
    const random = seededRandom(8);
    let state = createCluster(5, random);
    for (let step = 0; step < 800; step++) state = tick(state, random);
    expect(state.events.length).toBeLessThanOrEqual(60);
  });

  it("does not mutate the state it was given", () => {
    // The visualisation keeps history for a scrubber; mutation would rewrite it.
    const random = seededRandom(4);
    const before = createCluster(5, random);
    const snapshot = JSON.stringify(before);
    tick(before, random);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
