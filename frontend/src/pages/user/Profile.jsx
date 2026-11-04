import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getProfile, updateProfile } from '../../api/user'
import './Profile.css'

export default function Profile() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    getProfile()
      .then(data => {
        if (active) setProfile(data)
      })
      .catch(err => {
        if (!active) return

        if (err.status === 401) {
          navigate('/login', { replace: true })
        } else {
          setError(err.message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [navigate])

  function changeField(field, value) {
    setProfile(current => ({
      ...current,
      [field]: value,
    }))
    setError('')
    setMessage('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) return

    setError('')
    setMessage('')

    const name = profile.name.trim()
    const phone = (profile.phone ?? '').trim()

    if (!name || name.length > 100) {
      setError('Enter a full name between 1 and 100 characters.')
      return
    }

    if (phone.length > 30) {
      setError('Phone number must be 30 characters or fewer.')
      return
    }

    setSaving(true)

    try {
      const saved = await updateProfile({
        name,
        phone: phone || null,
      })

      setProfile(saved)
      setMessage('Your profile has been saved.')
    } catch (err) {
      if (err.status === 401) {
        navigate('/login', { replace: true })
      } else {
        setError(
          err.details?.map(item => item.message).join(' ') ||
          err.message
        )
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p role="status">Loading your profile...</p>
  }

  if (!profile) {
    return (
      <section className="card profile-card">
        <h1>My profile</h1>

        <p className="field-error" role="alert">
          {error || 'Unable to load your profile.'}
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>

        <p><Link to="/login">Go to login</Link></p>
      </section>
    )
  }

  return (
    <section className="card profile-card">
      <h1>My profile</h1>
      <p>
        View your account details and update your contact information.
      </p>

      <p>
        Account type:{' '}
        <strong>
          {profile.role === 'admin' ? 'Administrator' : 'User'}
        </strong>
      </p>

      {error && (
        <p className="field-error" role="alert">{error}</p>
      )}

      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <fieldset disabled={saving}>
          <legend className="profile-legend">
            Contact details
          </legend>

          <div className="form-field">
            <label htmlFor="profile-name">Full name</label>
            <input
              id="profile-name"
              name="name"
              autoComplete="name"
              required
              maxLength={100}
              value={profile.name}
              onChange={event =>
                changeField('name', event.target.value)
              }
            />
          </div>

          <div className="form-field">
            <label htmlFor="profile-email">
              Email address
            </label>
            <input
              id="profile-email"
              type="email"
              value={profile.email}
              readOnly
              aria-describedby="profile-email-help"
            />
            <small id="profile-email-help">
              Your sign-in email cannot be changed here.
            </small>
          </div>

          <div className="form-field">
            <label htmlFor="profile-phone">
              Phone number (optional)
            </label>
            <input
              id="profile-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={30}
              value={profile.phone ?? ''}
              onChange={event =>
                changeField('phone', event.target.value)
              }
            />
          </div>

          <button type="submit">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </fieldset>
      </form>
    </section>
  )
}