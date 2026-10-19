const User = require('../models/User');
const { sendMail } = require('./mailer');

const site = () => process.env.FRONTEND_URL || 'http://localhost:3000';
const taka = (n) => `৳${Number(n).toLocaleString('en-IN')}`;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function notifyOwnerOfDonation(campaign, donation) {
  const owner = await User.findById(campaign.owner).select('email isBlocked').lean();
  if (!owner || !owner.email || owner.isBlocked) return;

  const link = `${site()}/donate/${campaign._id}`;

  await sendMail({
    to: owner.email,
    subject: `New donation to confirm: ${taka(donation.amount)}`,
    text: `Someone says they sent ${taka(donation.amount)} to your campaign "${campaign.title}".\n\nCheck your account for the transaction ID ${donation.trxId}, then confirm it here:\n${link}`,
    html: `<p>Someone says they sent <b>${esc(taka(donation.amount))}</b> to your campaign <b>${esc(campaign.title)}</b>.</p>
           <p>Check your account for the transaction ID <b>${esc(donation.trxId)}</b>, then confirm it:</p>
           <p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#059669;color:#ffffff;text-decoration:none;font-weight:600">Open the campaign</a></p>`,
  });
}

async function sendReceiptEmail(campaign, donation) {
  if (!donation.donorEmail) return;

  const link = `${site()}/donate/receipt/${donation.receiptNo}`;

  await sendMail({
    to: donation.donorEmail,
    subject: `Your donation receipt ${donation.receiptNo}`,
    text: `Thank you. Your donation of ${taka(donation.amount)} to "${campaign.title}" was confirmed.\n\nYour receipt:\n${link}`,
    html: `<p>Thank you. Your donation of <b>${esc(taka(donation.amount))}</b> to <b>${esc(campaign.title)}</b> was confirmed.</p>
           <p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#059669;color:#ffffff;text-decoration:none;font-weight:600">View your receipt</a></p>`,
  });
}

module.exports = { notifyOwnerOfDonation, sendReceiptEmail };