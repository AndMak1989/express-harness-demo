const express = require('express');
const itemsRouter = require('./routes/items');

const app = express();

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'UP', 
    service: 'express-harness-demo',
    timestamp: new Date().toISOString() 
  });
});

// REST API routes
app.use('/api/items', itemsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

module.exports = app;
