require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./models/db');


if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in the environment variables');
}

const authRoutes = require('./routes/auth');
const passwordRoutes = require('./routes/password'); 
const profileRoutes = require('./routes/profile'); 
const accidentRoutes = require('./routes/accidents');
const hospitalRoutes = require('./routes/hospitals');
const uploadRoutes = require('./routes/upload');
const hospitalAdmissionRoutes = require('./routes/hospitalAdmissions');
const unidentifiedPatientRoutes = require('./routes/unidentifiedPatients');
const imageLinkRoutes = require('./routes/imageLink');

const app = express();
app.use(express.json());
app.use(cors());
connectDB();

app.get('/', (req, res) => res.send('Backend is running'));

app.use('/api/auth', authRoutes);
app.use('/api/auth', passwordRoutes);     
app.use('/api/profile', profileRoutes); 
app.use('/api/accidents', accidentRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api', uploadRoutes);
app.use('/api/hospital-admissions', hospitalAdmissionRoutes);
app.use('/api/unidentified-patients', unidentifiedPatientRoutes);
app.use('/api', imageLinkRoutes);

const PORT = process.env.PORT || 5000;


if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;