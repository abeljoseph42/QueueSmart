const { z } = require('zod');
const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { ApiError } = require('../../shared/errors');
const {
  withWriteTransaction,
} = require('../../database/connection');

const updateProfile = z.object({
  name: z.string().trim().min(1).max(100).optional(),

  phone: z.string()
    .trim()
    .min(1)
    .max(30)
    .nullable()
    .optional(),

  preferences: z.record(z.string(), z.unknown())
    .refine(
      value =>
        Buffer.byteLength(JSON.stringify(value), 'utf8') <= 4096,
      { message: 'Preferences must not exceed 4096 bytes.' }
    )
    .optional(),
}).strict().refine(
  value => Object.keys(value).length > 0,
  { message: 'At least one profile field is required.' }
);

function createProfileService(db) {
  function getProfile(userId) {
    const row = db.prepare(`
      SELECT
        c.id,
        c.email,
        c.role,
        p.full_name,
        p.phone,
        p.preferences_json
      FROM user_credentials c
      JOIN user_profile p ON p.email = c.email
      WHERE c.id = ?
    `).get(userId);

    if (!row) {
      throw new ApiError(
        404,
        'PROFILE_NOT_FOUND',
        'Profile not found.'
      );
    }

    return {
      id: row.id,
      name: row.full_name,
      email: row.email,
      role: row.role === 'Administrator' ? 'admin' : 'user',
      phone: row.phone,
      preferences: JSON.parse(row.preferences_json),
    };
  }

  function saveProfile(userId, input) {
    // Validate here too, protecting callers outside the router.
    const result = updateProfile.safeParse(input);

    if (!result.success) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Invalid profile update.'
      );
    }

    const changes = result.data;

    return withWriteTransaction(db, () => {
      const current = getProfile(userId);

      db.prepare(`
        UPDATE user_profile
        SET full_name = ?, phone = ?, preferences_json = ?
        WHERE email = ?
      `).run(
        changes.name ?? current.name,
        changes.phone === undefined
          ? current.phone
          : changes.phone,
        JSON.stringify(
          changes.preferences ?? current.preferences
        ),
        current.email
      );

      return getProfile(userId);
    });
  }

  return { getProfile, saveProfile };
}

function createProfileRouter({ db, auth }) {
  const router = Router();
  const profiles = createProfileService(db);

  router.get('/me/profile', auth, (req, res) => {
    res.json({
      data: profiles.getProfile(req.user.id),
    });
  });

  router.patch(
    '/me/profile',
    auth,
    validate(updateProfile),
    (req, res) => {
      res.json({
        data: profiles.saveProfile(
          req.user.id,
          req.validated.body
        ),
      });
    }
  );

  return router;
}

module.exports = {
  createProfileService,
  createProfileRouter,
};