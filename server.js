require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./models/db');

const accidentRoutes = require('./routes/accidents');
const hospitalRoutes = require('./routes/hospitals');
const missingPersonRoutes = require('./routes/missingPersons');
const subscriberRoutes = require('./routes/subscribers');

const app = express();
app.use(express.json());
app.use(cors());
connectDB();

app.get('/', (req, res) => res.send('Backend is running'));

app.use('/api/accidents', accidentRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/missing-persons', missingPersonRoutes);
app.use('/api/subscribers', subscriberRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
