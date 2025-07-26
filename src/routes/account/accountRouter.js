import express from 'express';
import { createAccount } from './createAccount.js';

const router = express.Router();

// POST /api/account/create
router.post('/create', createAccount);

// Future placeholders (don’t do anything yet):
// router.put('/update', updateAccount);
// router.delete('/delete', deleteAccount);

export default router;
