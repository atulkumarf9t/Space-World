// campaign.test.mjs — leaderboard logic. Run: node test/campaign.test.mjs
import { Campaign, LEVELS } from '../src/campaign.js';

let passed = 0, failed = 0;
const ok = (n, c, d = '') => (c ? (passed++, console.log(`  PASS  ${n}`)) : (failed++, console.log(`  FAIL  ${n}  ${d}`)));

function mem() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; }

console.log('\ncampaign + leaderboard');
{
  const c = new Campaign(mem());
  ok('starts on first level', c.current().id === LEVELS[0].id);

  c.record({ status: 'RESOLVED', grade: 'B', ratio: 1.5, dvUsed: 3 });
  ok('records a win', c.best(LEVELS[0].id).grade === 'B');

  c.record({ status: 'RESOLVED', grade: 'A', ratio: 1.05, dvUsed: 2 });
  ok('upgrades to a better grade', c.best(LEVELS[0].id).grade === 'A');

  c.record({ status: 'RESOLVED', grade: 'C', ratio: 3, dvUsed: 6 });
  ok('does not downgrade', c.best(LEVELS[0].id).grade === 'A');

  c.record({ status: 'UNSAFE', grade: 'F', ratio: null, dvUsed: 0 });
  ok('ignores non-resolved results', c.best(LEVELS[0].id).grade === 'A');

  c.next();
  ok('advances to next level', c.current().id === LEVELS[1].id);
  c.record({ status: 'RESOLVED', grade: 'C', ratio: 2.5, dvUsed: 5 });

  ok('total stars accumulate (A=3 + C=1)', c.totalStars() === 4, `${c.totalStars()}`);
  ok('every level scenario builds', LEVELS.every((l) => { const s = l.scenario(); return !!s.allyPos && !!s.asteroidPos; }));
  ok('persists across instances', new Campaign({ getItem: () => JSON.stringify({ first: { grade: 'A' } }), setItem() {} }).best('first').grade === 'A');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
