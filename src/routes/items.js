const express = require('express');
const router = express.Router();
const db = require('../db/db');

// GET /api/items - list all items
router.get('/', async (req, res, next) => {
  try {
    const items = await db.query('SELECT * FROM items ORDER BY id DESC');
    res.status(200).json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
});

// GET /api/items/:id - get single item
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID supplied' });
    }

    const item = await db.get('SELECT * FROM items WHERE id = ?', [id]);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

// POST /api/items - create new item
router.post('/', async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Name field is required' });
    }

    const result = await db.run(
      'INSERT INTO items (name, description) VALUES (?, ?)',
      [name.trim(), description ? description.trim() : null]
    );

    const createdItem = await db.get('SELECT * FROM items WHERE id = ?', [result.id]);
    res.status(201).json({ success: true, data: createdItem });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/items/:id - delete item
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid ID supplied' });
    }

    const existing = await db.get('SELECT * FROM items WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    await db.run('DELETE FROM items WHERE id = ?', [id]);
    res.status(200).json({ success: true, message: `Item with id ${id} deleted successfully` });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
