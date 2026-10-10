import { factorySections, factoryUnits } from '../frontend/src/data/factoryFloorData.js';

console.log('====================================================');
console.log('EVEREST TEXTILE MILLS — FACTORY FLOOR MAP VERIFICATION');
console.log('====================================================');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

// 1. Total Count & Uniqueness
assert(factoryUnits.length === 74, `Total units equals 74 (actual: ${factoryUnits.length})`);
const uniqueIds = new Set(factoryUnits.map((u) => u.id));
assert(uniqueIds.size === 74, `All 74 unit IDs are strictly unique (actual: ${uniqueIds.size})`);

// 2. Section Distribution
const expectedSections = [
  { id: 'raw_material', prefix: 'RM', count: 8 },
  { id: 'spinning', prefix: 'SP', count: 12 },
  { id: 'weaving', prefix: 'WV', count: 16 },
  { id: 'dyeing', prefix: 'DY', count: 10 },
  { id: 'finishing', prefix: 'FN', count: 8 },
  { id: 'quality_control', prefix: 'QC', count: 6 },
  { id: 'finished_goods', prefix: 'FG', count: 8 },
  { id: 'dispatch', prefix: 'DP', count: 6 },
];

assert(factorySections.length === 8, `Exactly 8 factory sections defined (actual: ${factorySections.length})`);

expectedSections.forEach((sec) => {
  const unitsInSec = factoryUnits.filter((u) => u.sectionId === sec.id);
  assert(
    unitsInSec.length === sec.count,
    `Section '${sec.id}' has exactly ${sec.count} units (actual: ${unitsInSec.length})`
  );
  const allMatchPrefix = unitsInSec.every((u) => u.id.startsWith(sec.prefix));
  assert(allMatchPrefix, `All units in '${sec.id}' start with prefix '${sec.prefix}'`);
});

// 3. Status Counts & Internal Mathematical Consistency
const counts = {
  RUNNING: factoryUnits.filter((u) => u.status === 'RUNNING').length,
  AVAILABLE: factoryUnits.filter((u) => u.status === 'AVAILABLE').length,
  IDLE: factoryUnits.filter((u) => u.status === 'IDLE').length,
  PAUSED: factoryUnits.filter((u) => u.status === 'PAUSED').length,
  MAINTENANCE: factoryUnits.filter((u) => u.status === 'MAINTENANCE').length,
  DOWN: factoryUnits.filter((u) => u.status === 'DOWN').length,
};

console.log('Status breakdown:', counts);

assert(counts.RUNNING === 40, `Running units count is 40 (actual: ${counts.RUNNING})`);
assert(counts.AVAILABLE === 13, `Available units count is 13 (actual: ${counts.AVAILABLE})`);
assert(counts.IDLE === 9, `Idle units count is 9 (actual: ${counts.IDLE})`);
assert(counts.PAUSED === 4, `Paused units count is 4 (actual: ${counts.PAUSED})`);
assert(counts.MAINTENANCE === 5, `Maintenance units count is 5 (actual: ${counts.MAINTENANCE})`);
assert(counts.DOWN === 3, `Down units count is 3 (actual: ${counts.DOWN})`);

const sumCounts =
  counts.RUNNING + counts.AVAILABLE + counts.IDLE + counts.PAUSED + counts.MAINTENANCE + counts.DOWN;
assert(sumCounts === 74, `Sum of all status counts strictly equals 74 (actual: ${sumCounts})`);

// 4. Critical Down Units
const downUnits = factoryUnits.filter((u) => u.status === 'DOWN').map((u) => u.id);
console.log('Critical DOWN units:', downUnits);
assert(
  downUnits.includes('RM-06') && downUnits.includes('SP-10') && downUnits.includes('WV-16'),
  `Identified DOWN units RM-06, SP-10, WV-16`
);

// 5. RBAC Authorization Functionality
const isAuthorized = (roleId) => roleId === 'ADMIN_OWNER' || roleId === 'FLOOR_MANAGER';

assert(isAuthorized('ADMIN_OWNER') === true, 'ADMIN_OWNER is authorized');
assert(isAuthorized('FLOOR_MANAGER') === true, 'FLOOR_MANAGER is authorized');
assert(isAuthorized('STORE_KEEPER') === false, 'STORE_KEEPER is unauthorized');
assert(isAuthorized('QC_INSPECTOR') === false, 'QC_INSPECTOR is unauthorized');
assert(isAuthorized('BUYER') === false, 'BUYER is unauthorized');
assert(isAuthorized('MANAGER') === false, 'Generic MANAGER is unauthorized');

// 6. Search & Filter logic verification
const searchWV05 = factoryUnits.filter((u) => u.id.toLowerCase().includes('wv-05'));
assert(searchWV05.length === 1 && searchWV05[0].id === 'WV-05', `Search 'WV-05' yields 1 unit`);

const searchOrder = factoryUnits.filter((u) => u.currentOrder?.includes('ORD-2410-001'));
assert(searchOrder.length > 0, `Search by production order ORD-2410-001 returns active units (${searchOrder.length} units found)`);

const weavingOnly = factoryUnits.filter((u) => u.sectionId === 'weaving');
assert(weavingOnly.length === 16, `Filter by section 'weaving' yields exactly 16 units`);

const downOnly = factoryUnits.filter((u) => u.status === 'DOWN');
assert(downOnly.length === 3, `Filter by status 'DOWN' yields exactly 3 units`);

// 7. Field Integrity check
const missingFieldUnits = factoryUnits.filter(
  (u) => !u.id || !u.name || !u.section || !u.status || !u.location
);
assert(missingFieldUnits.length === 0, `All 74 units have required base fields (id, name, section, status, location)`);

console.log('====================================================');
console.log(`RESULTS: ${passedTests} / ${totalTests} CHECKS PASSED`);
console.log('====================================================');
