import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastCosts, historicArea, historicCosts } from '../src/pages/admin/dashboards/projectCostModel.ts';

const assumptions = { salary: 1_000_000, roster: 50, overhead: 5_000_000,
  uf: 40_000, dailyHours: 8, productivePercent: 80, rate: 2 };
const lines = [{ quantity: 100, area: 50, hours: 160 }];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('whole payroll is charged once; task hours change staffing, not cost', () => {
  const result = forecastCosts(lines, assumptions);
  near(result.dailyBurn, 55_000_000 / 20.83);
  near(result.ufPerSqm, 55_000_000 / 20.83 * 50 / 5000 / 40_000);
  near(result.staff, 50);
  const simpler = forecastCosts([{ ...lines[0], hours: 80 }], assumptions);
  near(simpler.ufPerSqm, result.ufPerSqm);
  near(simpler.staff, 25);
});

test('doubling throughput halves costs and doubles required staff', () => {
  const base = forecastCosts(lines, assumptions);
  const faster = forecastCosts(lines, { ...assumptions, rate: 4 });
  near(faster.ufPerSqm, base.ufPerSqm / 2);
  near(faster.staff, base.staff * 2);
});

test('mixed models weight area and hours by quantity; unused rows do not block', () => {
  const result = forecastCosts([...lines, { quantity: 50, area: 100, hours: 320 },
    { quantity: 0, area: null, hours: null }], assumptions);
  assert.equal(result.area, 10000);
  assert.equal(result.hours, 32000);
  assert.equal(result.days, 75);
});

test('missing area or hours stays missing instead of pretending to be zero', () => {
  const result = forecastCosts([{ quantity: 10, area: null, hours: null }], assumptions);
  assert.equal(result.ufPerSqm, null);
  assert.equal(result.staff, null);
  assert.ok(result.totalClp > 0);
  assert.equal(forecastCosts(lines, { ...assumptions, uf: 0 }).ufPerSqm, null);
  assert.equal(forecastCosts(lines, { ...assumptions, rate: 0 }).totalClp, null);
});

test('historical allocation conserves whole payroll, including work in progress', () => {
  const first = historicCosts(1000, 30, 100, 20, assumptions);
  const second = historicCosts(2000, 50, 100, 20, assumptions);
  const wip = historicCosts(0, 20, 100, 20, assumptions);
  near(first.totalClp + second.totalClp + wip.totalClp, 55_000_000 / 20.83 * 20);
  assert.equal(wip.ufPerSqm, null);
  near(first.share, .3);
});

test('no labour or no output does not produce a false zero cost per sqm', () => {
  assert.equal(historicCosts(100, 0, 100, 20, assumptions).ufPerSqm, null);
  assert.equal(historicCosts(null, 20, 100, 20, assumptions).ufPerSqm, null);
  assert.equal(historicCosts(100, 0, 0, 20, assumptions).share, null);
});

test('historical area uses exact input, then installed panels, then catalog fallback', () => {
  const line = { completed: 5, recordedArea: 120, missingHouses: 2, floorArea: 45, exactArea: null };
  assert.equal(historicArea([line]), 210);
  assert.equal(historicArea([{ ...line, exactArea: 50 }]), 250);
  assert.equal(historicArea([{ ...line, floorArea: null }]), null);
  assert.equal(historicArea([{ ...line, missingHouses: 0, floorArea: null }]), 120);
  assert.equal(historicArea([{ ...line, completed: 0, floorArea: null }]), 0);
});
