const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
}

async function sendMail({ to, bcc, subject, text, html }) {
  const ready = process.env.EMAIL_USER && process.env.EMAIL_PASS;

  if (!ready) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email is not set up (EMAIL_USER or EMAIL_PASS is missing)');
    }
    console.log('\n----- EMAIL (not sent, email is not set up yet) -----');
    console.log('To:', to || '(hidden recipients)');
    if (bcc) console.log('Hidden recipients:', Array.isArray(bcc) ? bcc.join(', ') : bcc);
    console.log('Subject:', subject);
    console.log(text);
    console.log('-----------------------------------------------------\n');
    return;
  }

  await getTransporter().sendMail({
    from: `"ResQ" <${process.env.EMAIL_USER}>`,
    to: to || process.env.EMAIL_USER,
    bcc,
    subject,
    text,
    html,
  });
}

module.exports = { sendMail };