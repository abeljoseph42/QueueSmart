const typeLabels = {
  'queue-update': 'Queue update',
  'status-change': 'Status change',
}

export default function NotificationItem({ notification }) {
  return (
    <li
      className={
        notification.isRead
          ? 'notification'
          : 'notification notification-unread'
      }
    >
      <div className="notification-meta">
        <span className="notification-type">
          {typeLabels[notification.type]}
        </span>
        <span className="notification-time">{notification.time}</span>
      </div>
      <p className="notification-message">{notification.message}</p>
    </li>
  )
}
