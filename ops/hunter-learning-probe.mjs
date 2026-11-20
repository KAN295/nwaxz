// Reproduce the policy with Node 24: node ops/hunter-learning-probe.mjs --train
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { EscapeWorld, MAP, DOORS } from '../src/escape/world.ts';
import { floorAt, stairsAt } from '../src/escape/basement-map.ts';
import { chooseHunterAction, searchCandidates, policyFeatures, POLICY_HIDDEN, POLICY_INPUTS } from '../src/escape/hunter-search-model.ts';
import { HUNTER_POLICY_WEIGHTS } from '../src/escape/hunter-policy-weights.ts';

const world = new EscapeWorld(2041);
world.data.elapsed = 10;
world.data.hunter.state = 'chase';
const cells = MAP.flatMap((row, z) => row.flatMap((wall, x) => wall ? [] : [{ x: x + 0.5, z: z + 0.5 }]));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angle = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
const cellKey = p => `${Math.floor(p.x)},${Math.floor(p.z)}`;
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
let seed = 2041;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
const sample = values => values[Math.floor(random() * values.length)];

function observes(from, towards, subject) {
  Object.assign(world.data.hunter, from, { angle: towards });
  Object.assign(world.data.player, subject);
  return world.seesPlayer();
}

function makeEpisodes(floor, count) {
  const made = [], signatures = new Set();
  const pool = cells.filter(p => floorAt(p) === floor && !stairsAt(p) && !world.furniture(p.x, p.z, 0.23));
  for (let attempt = 0; attempt < count * 100 && made.length < count; attempt++) {
    const openDoors = DOORS.filter(door => random() < 0.82).map(door => door.id);
    world.data.opened = openDoors;
    world.data.unlocked = openDoors;
    const start = sample(pool);
    if (world.wall(start.x, start.z)) continue;
    const finish = sample(pool.filter(p => distance(start, p) >= 4 && distance(start, p) <= 9));
    if (!finish) continue;
    const route = [start, ...world.route(start, finish)];
    if (route.length < 5 || route.length > 14) continue;
    const watcher = sample(pool.filter(p => distance(p, start) >= 2 && distance(p, start) <= 6 && !world.wall(p.x, p.z)));
    if (!watcher) continue;
    const facing = angle(watcher, start);
    if (!observes(watcher, facing, start)) continue;
    const trace = [start];
    for (let i = 1; i < route.length; i++) for (let j = 1; j <= 4; j++) trace.push(mix(route[i - 1], route[i], j / 4));
    const loss = trace.findIndex(p => !observes(watcher, facing, p));
    if (loss < 3 || trace.length <= loss + 5) continue;
    // Only test actual obstruction, not merely walking outside a fixed field of view.
    if (observes(watcher, angle(watcher, trace[loss]), trace[loss])) continue;
    const last = trace[loss - 1], earlier = trace[loss - 2];
    const subject = trace[Math.min(trace.length - 1, loss + 6 + Math.floor(random() * 8))];
    if (observes(watcher, angle(watcher, subject), subject)) continue;
    const signature = `${cellKey(watcher)}>${cellKey(start)}>${cellKey(last)}>${cellKey(subject)}`;
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const length = distance(last, earlier);
    const heading = { x: (last.x - earlier.x) / length, z: (last.z - earlier.z) / length };
    const candidates = searchCandidates(last, heading, watcher,
      point => !world.wall(point.x, point.z, true) && !world.furniture(point.x, point.z, 0.23),
      (from, point) => observes(from, angle(from, point), point));
    if (candidates.length < 2) continue;
    // The true simulated position is for labels only. No weights, features or
    // baseline scores are calculated from it. A probe represents a brief look around.
    const spots = point => distance(point, subject) <= 4.5 && observes(point, angle(point, subject), subject);
    const examples = candidates.map(candidate => ({ ...candidate, yes: Number(spots(candidate.point)) }));
    made.push({ last, subject, examples, stationary: spots(last) });
  }
  if (made.length < count) throw Error(`Created only ${made.length} scenarios on floor ${floor}`);
  return made;
}

const train = makeEpisodes(0, 650);
const basement = makeEpisodes(-1, 250);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
// Prior fitted search policy is a training target and evaluation baseline only.
const previousSearchWeights = [0.47988032, 0.56309619, 0.63344855, -1.12065448, -0.79234092, 1.17718170, 0.87256583, 0.25131874];
const searchObservation = difficulty => ({ cue:'lost', strength:1, exposure:0, distance:0, difficulty });
const searchOptions = episode => episode.examples.map(p => ({ action:'search', point:p.point, geometry:p.features, hit:p.yes }));

function labelCue(observation) {
  // Teach the model the established balance at 50. Use hard game constraints
  // separately at runtime for fully confirmed evidence, capture and skills.
  const {cue, exposure, strength, credible, difficulty} = observation;
  if (cue === 'sight' && exposure >= .98 - Math.max(0, difficulty - 50) * .0058 &&
    strength >= .72 - Math.max(0, difficulty - 50) * .007) return 'chase';
  if (cue === 'stone' || cue === 'glass' || cue === 'impact') return 'investigate';
  if (credible) return 'investigate';
  return 'continue';
}

function cueEpisodes(count) {
  const kinds = ['footsteps','stone','glass','impact','sight','glare'];
  return Array.from({length:count}, () => {
    const cue = sample(kinds), raw = random(), distance = random();
    const exposure = cue === 'sight' && random() < .5 ? .65 + raw * .35 : raw;
    const strength = cue === 'sight' ? exposure * random() : random();
    const difficulty = sample([0,25,50,50,50,75,100]);
    const credible = cue === 'footsteps' ? random() < .5 || exposure >= .45 : exposure >= .45;
    const observation = {cue, exposure, strength, distance, difficulty, credible, occluded:cue !== 'sight' && random() < .5};
    const options = [{ action:'continue' }, { action:'investigate' }];
    if (cue === 'sight') options.push({ action:'chase' });
    return {observation, options, expected:labelCue(observation)};
  });
}

function fit(examples) {
  const outputOffset = POLICY_HIDDEN * (POLICY_INPUTS + 1);
  const size = outputOffset + POLICY_HIDDEN + 1;
  const weights = Float64Array.from({length:size}, () => (random() * 2 - 1) * .22);
  const first = new Float64Array(size), second = new Float64Array(size), gradient = new Float64Array(size);
  const activations = new Float64Array(POLICY_HIDDEN), order = examples.map((_, i) => i);
  const batch = 64;
  let iteration = 0;
  for (let epoch = 0; epoch < 24; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let begin = 0; begin < order.length; begin += batch) {
      gradient.fill(0);
      for (let ix = begin; ix < Math.min(order.length, begin + batch); ix++) {
        const {input, label} = examples[order[ix]];
        let output = weights[size - 1];
        for (let h = 0; h < POLICY_HIDDEN; h++) {
          const off = h * (POLICY_INPUTS + 1);
          let activation = weights[off + POLICY_INPUTS];
          for (let j = 0; j < POLICY_INPUTS; j++) activation += weights[off + j] * input[j];
          activations[h] = Math.max(0, activation);
          output += activations[h] * weights[outputOffset + h];
        }
        const error = output - label;
        gradient[size - 1] += error;
        for (let h = 0; h < POLICY_HIDDEN; h++) {
          if (activations[h] <= 0) continue;
          gradient[outputOffset + h] += error * activations[h];
          const off = h * (POLICY_INPUTS + 1), delta = error * weights[outputOffset + h];
          for (let j = 0; j < POLICY_INPUTS; j++) gradient[off + j] += delta * input[j];
          gradient[off + POLICY_INPUTS] += delta;
        }
      }
      iteration++;
      const correction = Math.sqrt(1 - .999 ** iteration) / (1 - .9 ** iteration);
      for (let n = 0; n < size; n++) {
        const g = gradient[n] / batch;
        first[n] = .9 * first[n] + .1 * g;
        second[n] = .999 * second[n] + .001 * g * g;
        weights[n] -= .0025 * correction * first[n] / (Math.sqrt(second[n]) + 1e-8);
      }
    }
  }
  return Array.from(weights, n => Number(n.toFixed(7)));
}

const trainingCues = cueEpisodes(5300), heldCues = cueEpisodes(650);
let weights = HUNTER_POLICY_WEIGHTS;
const training = process.argv.includes('--train');
if (training) {
  const geometry = train.flatMap(episode => searchOptions(episode).map(option => {
    const difficulty = sample([0,25,50,50,75,100]);
    const aggression = (difficulty - 50) / 50;
    return { input:policyFeatures(searchObservation(difficulty), option),
      label:dot(previousSearchWeights, option.geometry) + aggression * (.30 * option.geometry[3] + .15 * option.geometry[5]) };
  }));
  const decisions = trainingCues.flatMap(({observation, options, expected}) => options.map(option => ({
    input:policyFeatures(observation, option), label:option.action === expected ? 2 : -2,
  })));
  weights = fit([...geometry,...decisions]);
}
assert.equal(weights.length, POLICY_HIDDEN * (POLICY_INPUTS + 2) + 1);

const top = (choices, score) => choices.reduce((a, b) => score(b) > score(a) ? b : a);
const directionRule = ({ features: [, forward, first, stride, , aroundCover] }) =>
  2 * forward + 0.8 * first + 0.3 * aroundCover - 0.6 * stride;
const evaluated = basement.map(row => ({
  stationary: row.stationary,
  rule: Boolean(top(row.examples, directionRule).yes),
  previous: Boolean(top(row.examples, p => dot(previousSearchWeights, p.features)).yes),
  learned: Boolean(chooseHunterAction(searchObservation(50), searchOptions(row), weights)?.hit),
  possible: row.examples.some(p => p.yes),
}));

const result = {
  scope: 'Fixed-observer, synthetic loss-of-sight replays on the shipped EscapeWorld map; one geometric search probe, not full gameplay',
  trainFloor: 0,
  testFloor: -1,
  trainEpisodes: train.length,
  trainProbes: train.reduce((sum, episode) => sum + episode.examples.length, 0),
  testEpisodes: basement.length,
  stationaryHits: evaluated.filter(row => row.stationary).length,
  directionalRuleHits: evaluated.filter(row => row.rule).length,
  previousModelHits: evaluated.filter(row => row.previous).length,
  learnedHits: evaluated.filter(row => row.learned).length,
  bestAvailableProbeHits: evaluated.filter(row => row.possible).length,
  anchorObstructed: {
    episodes: evaluated.filter(row => !row.stationary).length,
    directionalRuleHits: evaluated.filter(row => !row.stationary && row.rule).length,
    learnedHits: evaluated.filter(row => !row.stationary && row.learned).length,
  },
  cueTrainingEpisodes: trainingCues.length,
  cueTestEpisodes: heldCues.length,
  cueMatches: heldCues.filter(row => chooseHunterAction(row.observation, row.options, weights)?.action === row.expected).length,
  weightCount: weights.length,
};
assert.ok(result.learnedHits >= result.previousModelHits - 3, 'unified model should retain held-out search quality');
assert.ok(result.cueMatches >= heldCues.length * .97, 'unified model should preserve authored reactions');
if (training) {
  const lines = [];
  for (let i = 0; i < weights.length; i += 8) lines.push('  ' + weights.slice(i, i + 8).join(', ') + ',');
  writeFileSync(new URL('../src/escape/hunter-policy-weights.ts', import.meta.url),
    '// Generated by node ops/hunter-learning-probe.mjs --train.\nexport const HUNTER_POLICY_WEIGHTS: readonly number[] = [\n' + lines.join('\n') + '\n];\n');
}
console.log(result);
