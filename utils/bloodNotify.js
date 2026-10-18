const User = require('../models/User');
const { sendMail } = require('./mailer');
const { donorsFor, eligibleDonorQuery } = require('./blood');

const MAX_RECIPIENTS = 40;

const site = () => process.env.FRONTEND_URL || 'http://localhost:3000';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const when = (d) =>
  new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' });

async function notifyDonorsByEmail(request) {
  const recipients = await User.find({
    ...eligibleDonorQuery(),
    email: { $exists: true, $ne: null },
    'donor.emailAlerts': true,
    bloodGroup: { $in: donorsFor(request.bloodGroup) },
    'address.district': request.location.district,
    _id: { $ne: request.requester },
  })
    .select('email')
    .limit(MAX_RECIPIENTS)
    .lean();

  if (recipients.length === 0) return 0;

  const link = `${site()}/blood/requests/${request._id}`;
  const place = [request.location.area, request.location.district].filter(Boolean).join(', ');
  const units = `${request.unitsNeeded} ${request.unitsNeeded === 1 ? 'unit' : 'units'}`;

  await sendMail({
    bcc: recipients.map((r) => r.email),
    subject: `Blood needed: ${request.bloodGroup} in ${request.location.district}`,
    text: `${units} of ${request.bloodGroup} blood is needed at ${request.hospital.name}, ${place}, by ${when(request.neededBy)}.\n\nIf you can help, open this link:\n${link}\n\nYou get this email because you are a registered donor in ${request.location.district}. You can turn these emails off on your donor page.`,
    html: `<p><b>${esc(units)} of ${esc(request.bloodGroup)} blood</b> is needed at <b>${esc(request.hospital.name)}</b>, ${esc(place)}, by ${esc(when(request.neededBy))}.</p>
           <p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#E11D48;color:#ffffff;text-decoration:none;font-weight:600">I can help</a></p>
           <p style="color:#64748B;font-size:12px">You get this email because you are a registered donor in ${esc(request.location.district)}. You can turn these emails off on your donor page.</p>`,
  });

  return recipients.length;
}

async function notifyRequesterOfOffer(request, donorUser) {
  const requester = await User.findById(request.requester).select('email isBlocked').lean();
  if (!requester || !requester.email || requester.isBlocked) return;

  const link = `${site()}/blood/requests/${request._id}`;
  const firstName = String(donorUser.name).split(' ')[0];

  await sendMail({
    to: requester.email,
    subject: `A donor offered to give ${request.bloodGroup} blood`,
    text: `${firstName} (${donorUser.bloodGroup}) says they can donate for your request at ${request.hospital.name}.\n\nOpen the request to see their contact number:\n${link}`,
    html: `<p><b>${esc(firstName)}</b> (${esc(donorUser.bloodGroup)}) says they can donate for your request at <b>${esc(request.hospital.name)}</b>.</p>
           <p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#E11D48;color:#ffffff;text-decoration:none;font-weight:600">See their contact number</a></p>`,
  });
}

module.exports = { notifyDonorsByEmail, notifyRequesterOfOffer };