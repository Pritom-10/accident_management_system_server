const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const CAN_RECEIVE_FROM = {
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'A-': ['A-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'AB+': ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  'AB-': ['A-', 'B-', 'AB-', 'O-'],
  'O+': ['O+', 'O-'],
  'O-': ['O-'],
};

const RULES = { minAge: 18, maxAge: 60, minWeightKg: 50, gapDays: 120 };
const DAY = 24 * 60 * 60 * 1000;

const donorsFor = (recipientGroup) => CAN_RECEIVE_FROM[recipientGroup] || [];
const recipientsFor = (donorGroup) => BLOOD_GROUPS.filter((r) => CAN_RECEIVE_FROM[r].includes(donorGroup));

function ageOn(dob, now = new Date()) {
  const d = new Date(dob);
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function yearsAgo(n, now) {
  return new Date(now.getFullYear() - n, now.getMonth(), now.getDate());
}

function checkEligibility(donor = {}, now = new Date()) {
  const reasons = [];
  let nextEligibleDate = null;

  if (!donor.dateOfBirth) {
    reasons.push('Date of birth is missing');
  } else {
    const age = ageOn(donor.dateOfBirth, now);
    if (age < RULES.minAge || age > RULES.maxAge) {
      reasons.push(`Donors must be ${RULES.minAge} to ${RULES.maxAge} years old`);
    }
  }

  if (!donor.weightKg) reasons.push('Weight is missing');
  else if (donor.weightKg < RULES.minWeightKg) reasons.push(`Donors must weigh at least ${RULES.minWeightKg} kg`);

  if (donor.lastDonationDate) {
    const next = new Date(new Date(donor.lastDonationDate).getTime() + RULES.gapDays * DAY);
    if (next > now) {
      nextEligibleDate = next;
      reasons.push(`You can donate again from ${next.toISOString().slice(0, 10)}`);
    }
  }

  return { eligible: reasons.length === 0, reasons, nextEligibleDate };
}

function eligibleDonorQuery(now = new Date()) {
  return {
    isBlocked: { $ne: true },
    'donor.isDonor': true,
    'donor.availability': 'available',
    'donor.dateOfBirth': { $lte: yearsAgo(RULES.minAge, now), $gt: yearsAgo(RULES.maxAge + 1, now) },
    'donor.weightKg': { $gte: RULES.minWeightKg },
    $or: [
      { 'donor.lastDonationDate': null },
      { 'donor.lastDonationDate': { $lte: new Date(now.getTime() - RULES.gapDays * DAY) } },
    ],
  };
}

module.exports = {
  BLOOD_GROUPS,
  RULES,
  donorsFor,
  recipientsFor,
  checkEligibility,
  eligibleDonorQuery,
};