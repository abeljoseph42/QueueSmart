export function validateService(values) {
  const errors = {}

  if (!values.name.trim()) {
    errors.name = 'Service name is required.'
  } else if (values.name.length > 100) {
    errors.name = 'Service name must be 100 characters or fewer.'
  }

  if (!values.description.trim()) {
    errors.description = 'Description is required.'
  } else if (values.description.trim().length > 1000) {
    errors.description = 'Description must be 1000 characters or fewer.'
  }

  const duration = Number(values.expectedDuration)

  if (!values.expectedDuration.trim()) {
    errors.expectedDuration = 'Expected duration is required.'
  } else if (!Number.isFinite(duration) || !Number.isInteger(duration) || duration <= 0) {
    errors.expectedDuration = 'Enter a positive whole number of minutes.'
  } else if (duration > 480) {
    errors.expectedDuration = 'Expected duration must be 480 minutes or fewer.'
  }

  if (!['low', 'medium', 'high'].includes(values.priority)) {
    errors.priority = 'Select low, medium, or high priority.'
  }

  return errors
}