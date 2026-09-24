const request = require('supertest');
const app = require('../app');
const db = require('../db/db');

beforeAll(async () => {
  // Ensure table is initialized
  await db.initSchema();
});

afterAll(async () => {
  // Close the in-memory SQLite database
  await db.close();
});

beforeEach(async () => {
  // Clean table between tests
  await db.run('DELETE FROM items');
});

describe('Healthcheck Endpoint', () => {
  it('GET /health returns 200 with status UP', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'UP');
    expect(res.body).toHaveProperty('service', 'express-harness-demo');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('Items API Endpoints', () => {
  it('GET /api/items returns empty array initially', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(0);
  });

  it('POST /api/items fails without name field', async () => {
    const res = await request(app)
      .post('/api/items')
      .send({ description: 'No name provided' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/Name field is required/);
  });

  it('POST /api/items creates a new item with valid data', async () => {
    const payload = { name: 'Item 1', description: 'First test item' };
    const res = await request(app)
      .post('/api/items')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.name).toBe('Item 1');
    expect(res.body.data.description).toBe('First test item');
  });

  it('GET /api/items/:id returns the created item', async () => {
    const created = await request(app)
      .post('/api/items')
      .send({ name: 'Fetchable Item' });

    const itemId = created.body.data.id;

    const res = await request(app).get(`/api/items/${itemId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(itemId);
    expect(res.body.data.name).toBe('Fetchable Item');
  });

  it('GET /api/items/:id returns 404 if item does not exist', async () => {
    const res = await request(app).get('/api/items/9999');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Item not found');
  });

  it('GET /api/items/:id returns 400 for invalid id', async () => {
    const res = await request(app).get('/api/items/invalid-id');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid ID supplied');
  });

  it('DELETE /api/items/:id deletes an existing item', async () => {
    const created = await request(app)
      .post('/api/items')
      .send({ name: 'To be deleted' });

    const itemId = created.body.data.id;

    const delRes = await request(app).delete(`/api/items/${itemId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    const getRes = await request(app).get(`/api/items/${itemId}`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE /api/items/:id returns 404 for non-existing item', async () => {
    const res = await request(app).delete('/api/items/9999');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('DELETE /api/items/:id returns 400 for non-numeric id', async () => {
    const res = await request(app).delete('/api/items/abc');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Not Found Route', () => {
  it('returns 404 for unknown route', async () => {
    const res = await request(app).get('/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint not found');
  });
});
