import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdminReferralStats } from '../admin-user-referrals.ts';

const byId = (stats, id) => stats.get(String(id));

test('aggregates direct and full-team referral, depositor, and active-boost counts', () => {
  const db = {
    users: [
      { id: '1', createdAt: 1, boostState: { isActive: false, isPaused: false } },
      { id: '2', createdAt: 2, boostState: { isActive: true, isPaused: false } },
      { id: '3', createdAt: 3, boostState: { isActive: true, isPaused: true } },
      { id: '4', createdAt: 4, boostState: { isActive: true, isPaused: false } },
      { id: '5', createdAt: 5, boostState: { isActive: true, isPaused: false } },
    ],
    referrals: [
      { referrerId: '1', referredId: '2' },
      { referrerId: '1', referredId: '3' },
      { referrerId: '2', referredId: '4' },
      { referrerId: '4', referredId: '5' },
    ],
    depositRequests: [
      { userId: '3', status: 'PENDING' },
      { userId: '4', status: 'APPROVED' },
    ],
    transactions: [
      { userId: '2', type: 'DEPOSIT', status: 'CREDITED' },
      { userId: '5', type: 'DEPOSIT_REQUEST', status: 'PENDING' },
    ],
  };

  const stats = buildAdminReferralStats(db, new Set(['2', '4', '5']));
  assert.deepEqual(byId(stats, '1'), {
    direct: { count: 2, sameIpDevice: 0, depositors: 1, activeBoosters: 1 },
    team: { count: 4, sameIpDevice: 0, depositors: 2, activeBoosters: 3 },
  });
  assert.deepEqual(byId(stats, '2'), {
    direct: { count: 1, sameIpDevice: 0, depositors: 1, activeBoosters: 1 },
    team: { count: 2, sameIpDevice: 0, depositors: 1, activeBoosters: 2 },
  });
});

test('counts shared signup IP or device fingerprint as a review signal without exposing identifiers', () => {
  const db = {
    users: [
      { id: '1', signupIp: '203.0.113.4', signupDevice: 'phone-a' },
      { id: '2', signupIp: '203.0.113.4', signupDevice: 'phone-b' },
      { id: '3', signupIp: '203.0.113.8', signupDevice: 'phone-c' },
      { id: '4', signupIp: '203.0.113.9', signupDevice: 'phone-d' },
    ],
    referrals: [
      { referrerId: '1', referredId: '2' },
      { referrerId: '1', referredId: '3' },
      { referrerId: '2', referredId: '4' },
    ],
    deviceFingerprints: { shared: ['1', '3'] },
  };
  const stats = buildAdminReferralStats(db, new Set());
  assert.equal(byId(stats, '1').direct.sameIpDevice, 2);
  assert.equal(byId(stats, '1').team.sameIpDevice, 2);
  assert.equal(byId(stats, '2').direct.sameIpDevice, 0);
  assert.equal(JSON.stringify(byId(stats, '1')).includes('203.0.113'), false);
  assert.equal(JSON.stringify(byId(stats, '1')).includes('shared'), false);
});

test('deduplicates repeated referral rows and safely breaks a corrupt referral cycle', () => {
  const db = {
    users: [
      { id: '1', createdAt: 1 },
      { id: '2', createdAt: 2 },
      { id: '3', createdAt: 3 },
    ],
    referrals: [
      { referrerId: '1', referredId: '2' },
      { referrerId: '1', referredId: '2' },
      { referrerId: '2', referredId: '3' },
      { referrerId: '3', referredId: '1' },
    ],
  };
  const stats = buildAdminReferralStats(db, new Set());
  assert.equal(byId(stats, '1').direct.count, 1);
  for (const id of ['1', '2', '3']) {
    assert.ok(byId(stats, id).team.count <= 2);
    assert.ok(byId(stats, id).team.count >= 0);
  }
});
