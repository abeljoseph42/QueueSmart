const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { ApiError } = require('../../shared/errors');

const PRIORITY_LABELS = Object.freeze({ 0: 'normal', 1: 'high', 2: 'urgent' });

const fields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
  expectedDurationMinutes: z.number().int().min(1).max(480),
  priorityLevel: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  isActive: z.boolean(),
};
const createInput = z.object({
  ...fields,
  description: fields.description.default(''),
  priorityLevel: fields.priorityLevel.default(0),
  isActive: fields.isActive.default(true),
}).strict();
const updateInput = z.object(fields).partial().strict()
  .refine(value => Object.keys(value).length > 0, { message: 'At least one service field is required.' });

const columns = {
  name: 'name',
  description: 'description',
  expectedDurationMinutes: 'expected_duration_minutes',
  priorityLevel: 'priority_level',
  isActive: 'is_active',
};

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
    result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  return result.data;
}

const toDb = (field, value) => (field === 'isActive' ? Number(value) : value);

const toService = row => row && {
  id: row.id,
  name: row.name,
  description: row.description,
  expectedDurationMinutes: row.expected_duration_minutes,
  priorityLevel: row.priority_level,
  isActive: row.is_active === 1,
};

function createServiceRepository(db) {
  function findById(id, conn = db) {
    return toService(conn.prepare('SELECT * FROM service WHERE id = ?').get(id)) ?? null;
  }

  function create(input, conn = db) {
    const data = parse(createInput, input);
    const id = randomUUID();
    conn.prepare(`INSERT INTO service (id, name, description, expected_duration_minutes, priority_level, is_active)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, data.name, data.description, data.expectedDurationMinutes,
      data.priorityLevel, toDb('isActive', data.isActive));
    return findById(id, conn);
  }

  function list({ activeOnly = false } = {}, conn = db) {
    const where = activeOnly ? 'WHERE is_active = 1 ' : '';
    return conn.prepare(`SELECT * FROM service ${where}ORDER BY rowid`).all().map(toService);
  }

  function update(id, patch, conn = db) {
    const data = parse(updateInput, patch);
    const keys = Object.keys(data);
    const assignments = keys.map(key => `${columns[key]} = ?`).join(', ');
    const result = conn.prepare(`UPDATE service SET ${assignments} WHERE id = ?`)
      .run(...keys.map(key => toDb(key, data[key])), id);
    if (result.changes === 0) throw new ApiError(404, 'NOT_FOUND', 'Service not found.');
    return findById(id, conn);
  }

  // Shared contract for Bryan and Heera.
  function getService(serviceId, conn = db) {
    const service = findById(serviceId, conn);
    if (!service) throw new ApiError(404, 'NOT_FOUND', 'Service not found.');
    const { id, name, expectedDurationMinutes, priorityLevel, isActive } = service;
    return { id, name, expectedDurationMinutes, priorityLevel, isActive };
  }

  return { create, findById, list, update, getService };
}

module.exports = { PRIORITY_LABELS, createServiceRepository };
