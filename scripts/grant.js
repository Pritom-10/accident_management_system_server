require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  const [email, what] = process.argv.slice(2);

  if (!email || !['admin', 'volunteer'].includes(what)) {
    console.log('Usage:');
    console.log('  node scripts/grant.js you@email.com admin');
    console.log('  node scripts/grant.js you@email.com volunteer');
    return;
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error('No user found with that email');

  if (what === 'admin') {
    if (!user.roles.includes('admin')) user.roles.push('admin');
  } else {
    if (!user.roles.includes('volunteer')) user.roles.push('volunteer');
    user.volunteer.status = 'approved';
  }

  await user.save();
  console.log('Done:', user.email, user.roles);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});