/**
 * P18 — a Raft simulator, as a pure state machine.
 *
 * The visualisation is a client component; **the consensus logic is this file,
 * and it is pure**. That split is the point: a leader election drawn as an
 * animation is a cartoon, and a leader election you can assert on — "a split
 * vote elects nobody", "a term only ever increases", "two leaders cannot exist
 * in one term" — is a model. The invariants below are the ones Raft actually
 * guarantees, and they are tested rather than illustrated.
 *
 * Deterministic by construction: every timeout comes from a seeded generator
 * passed in by the caller, so a given seed always produces the same run. That
 * makes an interesting scenario reproducible instead of something you wait for.
 *
 * Deliberately not implemented: log replication conflict resolution, snapshots,
 * membership changes. This models **leader election and heartbeat**, which is
 * the part that explains why a split-brain does not happen, and it says so
 * rather than implying a full implementation.
 */

export type NodeState = "follower" | "candidate" | "leader" | "down";

export interface RaftNode {
  id: number;
  state: NodeState;
  /** Monotonic. The single most important variable in the protocol. */
  term: number;
  /** Who this node voted for in its current term, if anyone. */
  votedFor: number | null;
  /** Ticks until this node starts an election. Randomised — see below. */
  timeout: number;
  /** Votes gathered this term, while a candidate. */
  votes: number;
  /** Entries committed. Only a leader appends. */
  log: number;
}

export interface RaftEvent {
  tick: number;
  message: string;
}

export interface RaftState {
  tick: number;
  nodes: RaftNode[];
  events: RaftEvent[];
  /** The current leader, or null during an election. */
  leaderId: number | null;
}

/** How often a leader sends heartbeats, in ticks. */
export const HEARTBEAT_TICKS = 3;

/**
 * Election timeout range.
 *
 * **The randomisation is the algorithm, not a detail.** With a fixed timeout
 * every follower becomes a candidate on the same tick, every candidate votes
 * for itself, nobody reaches a majority, and the cluster splits the vote again
 * next term — forever. Spreading the timeouts means one node almost always
 * wakes first and wins before the others start. This is the whole reason Raft
 * terminates.
 */
export const MIN_ELECTION_TICKS = 8;
export const MAX_ELECTION_TICKS = 16;

/** Mulberry32, so a seed reproduces a run exactly. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function electionTimeout(random: () => number): number {
  return MIN_ELECTION_TICKS + Math.floor(random() * (MAX_ELECTION_TICKS - MIN_ELECTION_TICKS));
}

export function createCluster(size: number, random: () => number): RaftState {
  return {
    tick: 0,
    leaderId: null,
    events: [{ tick: 0, message: `Cluster of ${size} started. All followers, term 0.` }],
    nodes: Array.from({ length: size }, (_, id) => ({
      id,
      state: "follower" as NodeState,
      term: 0,
      votedFor: null,
      timeout: electionTimeout(random),
      votes: 0,
      log: 0,
    })),
  };
}

/** A majority of the *configured* cluster, including nodes that are down. */
export function majority(size: number): number {
  return Math.floor(size / 2) + 1;
}

function record(state: RaftState, message: string): void {
  state.events.push({ tick: state.tick, message });
  // Bounded: this feeds a scrolling panel, and an unbounded array in a
  // component that ticks forever is a leak.
  if (state.events.length > 60) state.events.shift();
}

/**
 * Advance one tick.
 *
 * Returns a new state object; the input is not mutated, so a caller can keep
 * history for a scrubber.
 */
export function tick(previous: RaftState, random: () => number): RaftState {
  const state: RaftState = {
    tick: previous.tick + 1,
    leaderId: previous.leaderId,
    events: [...previous.events],
    nodes: previous.nodes.map((node) => ({ ...node })),
  };

  const alive = state.nodes.filter((node) => node.state !== "down");
  const needed = majority(state.nodes.length);

  const leader = state.nodes.find((node) => node.state === "leader");

  // A leader that can no longer reach a majority steps down.
  //
  // This is the invariant that makes Raft safe under a partition, and leaving
  // it out is the single most common way a simulation of it is wrong — the old
  // leader keeps its crown on screen while the cluster it leads no longer
  // exists, which is precisely the split-brain the protocol prevents. A real
  // leader discovers this by failing to get acknowledgements from a majority
  // and stepping down after an election timeout; here the check is direct.
  if (leader && alive.length < needed) {
    leader.state = "follower";
    leader.votedFor = null;
    leader.votes = 0;
    leader.timeout = electionTimeout(random);
    state.leaderId = null;
    record(state, `Leader ${leader.id} lost quorum (${alive.length}/${state.nodes.length}) and stepped down.`);
    return state;
  }

  if (leader) {
    // Heartbeat: resets every reachable follower's election timer, which is how
    // a healthy cluster stays quiet.
    if (state.tick % HEARTBEAT_TICKS === 0) {
      for (const node of alive) {
        if (node.id === leader.id) continue;
        node.state = "follower";
        node.term = leader.term;
        node.timeout = electionTimeout(random);
      }
      leader.log += 1;
      for (const node of alive) {
        if (node.id !== leader.id) node.log = leader.log;
      }
    }
    state.leaderId = leader.id;
    return state;
  }

  state.leaderId = null;

  // No leader: everyone counts down, and whoever reaches zero first stands.
  for (const node of alive) {
    node.timeout -= 1;
    if (node.timeout > 0) continue;

    node.term += 1;
    node.state = "candidate";
    node.votedFor = node.id;
    node.votes = 1;
    node.timeout = electionTimeout(random);
    record(state, `Node ${node.id} timed out — candidate for term ${node.term}.`);

    // Collect votes. A node grants one vote per term, to the first candidate
    // it hears from whose term is at least its own — that "at most one vote per
    // term" rule is what makes two leaders in one term impossible.
    for (const voter of alive) {
      if (voter.id === node.id) continue;
      if (voter.term > node.term) continue;
      if (voter.term === node.term && voter.votedFor !== null) continue;

      voter.term = node.term;
      voter.votedFor = node.id;
      voter.state = "follower";
      voter.timeout = electionTimeout(random);
      node.votes += 1;
    }

    if (node.votes >= needed) {
      node.state = "leader";
      state.leaderId = node.id;
      record(state, `Node ${node.id} won term ${node.term} with ${node.votes}/${state.nodes.length} votes.`);
    } else {
      record(
        state,
        `Node ${node.id} got ${node.votes}/${state.nodes.length} — no majority, term ${node.term} has no leader.`,
      );
    }
    // One election per tick: two candidates declaring in the same instant is
    // exactly the split vote being demonstrated, and it needs two ticks to be
    // legible.
    break;
  }

  return state;
}

/** Take a node down. The cluster should elect a new leader if it had one. */
export function killNode(previous: RaftState, id: number): RaftState {
  const state: RaftState = {
    ...previous,
    events: [...previous.events],
    nodes: previous.nodes.map((node) => ({ ...node })),
  };
  const node = state.nodes.find((candidate) => candidate.id === id);
  if (!node || node.state === "down") return state;

  const wasLeader = node.state === "leader";
  node.state = "down";
  node.votes = 0;
  if (wasLeader) state.leaderId = null;
  record(state, wasLeader ? `Leader ${id} went down.` : `Node ${id} went down.`);
  return state;
}

/** Bring a node back as a follower — it never returns as a leader. */
export function reviveNode(previous: RaftState, id: number, random: () => number): RaftState {
  const state: RaftState = {
    ...previous,
    events: [...previous.events],
    nodes: previous.nodes.map((node) => ({ ...node })),
  };
  const node = state.nodes.find((candidate) => candidate.id === id);
  if (!node || node.state !== "down") return state;

  // Rejoining as a follower at its old term is what the protocol requires: a
  // returning node learns the current term from the first heartbeat it hears,
  // and cannot assert leadership on stale information.
  node.state = "follower";
  node.votedFor = null;
  node.votes = 0;
  node.timeout = electionTimeout(random);
  record(state, `Node ${id} rejoined as a follower.`);
  return state;
}

/** Can this cluster still make progress? */
export function hasQuorum(state: RaftState): boolean {
  const alive = state.nodes.filter((node) => node.state !== "down").length;
  return alive >= majority(state.nodes.length);
}
