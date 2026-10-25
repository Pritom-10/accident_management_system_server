require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./models/db');
const { helmetMiddleware, corsOptions, limits, blockOperators, hideServerErrors } = require('./middleware/security');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in the environment variables');
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('WARNING: JWT_SECRET is shorter than 32 characters. Make a longer one, see the step 12 guide.');
}

const authRoutes = require('./routes/auth');
const passwordRoutes = require('./routes/password');
const profileRoutes = require('./routes/profile');
const accidentRoutes = require('./routes/accidents');
const hospitalRoutes = require('./routes/hospitals');
const uploadRoutes = require('./routes/upload');
const privateImageRoutes = require('./routes/privateImages');
const analyticsRoutes = require('./routes/analytics');
const hospitalAdmissionRoutes = require('./routes/hospitalAdmissions');
const unidentifiedPatientRoutes = require('./routes/unidentifiedPatients');
const imageLinkRoutes = require('./routes/imageLink');
const newsRoutes = require('./routes/news');
const bloodRoutes = require('./routes/blood');
const donateRoutes = require('./routes/donate');
const sosRoutes = require('./routes/sos');
const notificationRoutes = require('./routes/notifications');
const adminAnalyticsRoutes = require('./routes/adminAnalytics');
const adminRoutes = require('./routes/admin');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmetMiddleware);
app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));
app.use(blockOperators);
app.use(hideServerErrors);

connectDB();

app.get('/', (req, res) => res.send('Backend is running'));

app.post('/api/auth/login', limits.login);
app.post('/api/auth/register', limits.register);
app.post('/api/auth/forgot-password', limits.forgot);
app.post('/api/auth/reset-password', limits.forgot);
app.put('/api/profile/password', limits.login);
app.delete('/api/profile', limits.login);
app.post('/api/upload', limits.upload);
app.post('/api/private-images', limits.upload);
app.post('/api/accidents', limits.report);
app.post('/api/accidents/:caseId/flag', limits.flag);
app.post('/api/donate/campaigns/:id/flag', limits.flag);
app.post('/api/notifications/subscribe', limits.push);
app.post('/api/notifications/test', limits.push);

app.use('/api/auth', authRoutes);
app.use('/api/auth', passwordRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/accidents', accidentRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/hospital-admissions', hospitalAdmissionRoutes);
app.use('/api/unidentified-patients', unidentifiedPatientRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/blood', bloodRoutes);
app.use('/api/donate', donateRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', uploadRoutes);
app.use('/api', privateImageRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api', imageLinkRoutes);

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That request is too large' });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid request' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;