const typeLabels = {
  'queue.joined': 'Joined',
  'queue.near': 'Almost ready',
  'queue.served': 'Served',
  'queue.left': 'Left queue',
  'queue.removed': 'Removed',
}

function timeAgo(createdAt) {
  const minutes = Math.floor((Date.now() - new Date(createdAt)) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Date(createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export default function NotificationItem({ notification }) {
  return (
    <li className="notification">
      <div className="notification-meta">
        <span className="notification-type">
          {typeLabels[notification.type]}
        </span>
        <span className="notification-time">
          {timeAgo(notification.createdAt)}
        </span>
      </div>
      <p className="notification-message">{notification.message}</p>
    </li>
  )
}
