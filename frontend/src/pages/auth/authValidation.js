export function validateAuth({ email, password }) {
  const errors = {}

  if (!email.trim()) {
    errors.email = 'Email address is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Please enter a valid email address.'
  }

  if (!password.trim()) {
    errors.password = 'Password is required.'
  } else if (password.length < 8) {
    errors.password = 'Password must contain at least 8 characters.'
  }

  return errors
}