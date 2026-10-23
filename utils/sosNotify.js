const User = require('../models/User');
const { sendMail } = require('./mailer');

const MAX_RECIPIENTS = 40;

const site = () => process.env.FRONTEND_URL || 'http://localhost:3000';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function notifyVolunteersByEmail(alert) {
  const district = alert.location && alert.location.district;
  if (!district) return 0;

  const volunteers = await User.find({
    isBlocked: { $ne: true },
    roles: 'volunteer',
    'volunteer.status': 'approved',
    'volunteer.availability': 'available',
    'volunteer.serviceArea.district': district,
    email: { $exists: true, $ne: null },
  })
    .select('email')
    .limit(MAX_RECIPIENTS)
    .lean();

  if (volunteers.length === 0) return 0;

  const place = [alert.location.area, district].filter(Boolean).join(', ');
  const link = `${site()}/sos/nearby`;

  await sendMail({
    bcc: volunteers.map((v) => v.email),
    subject: `SOS near ${place}`,
    text: `Someone near ${place} pressed SOS and may need help.\n\nOpen the alerts to see where, and say if you can go:\n${link}\n\nPlease do not put yourself in danger. Call 999 for anything serious.`,
    html: `<p>Someone near <b>${esc(place)}</b> pressed SOS and may need help.</p>
           <p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#E11D48;color:#ffffff;text-decoration:none;font-weight:600">See the alert</a></p>
           <p style="color:#64748B;font-size:12px">Please do not put yourself in danger. Call 999 for anything serious. You get this because you are an available volunteer in ${esc(district)}. Turn off availability on the alerts page to stop these emails.</p>`,
  });

  return volunteers.length;
}

module.exports = { notifyVolunteersByEmail };