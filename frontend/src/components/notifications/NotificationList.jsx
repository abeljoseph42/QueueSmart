import NotificationItem from './NotificationItem'
import './Notifications.css'

export default function NotificationList({ notifications, onMarkAsRead }) {
  if (notifications.length === 0) {
    return <p className="notification-empty">No new notifications.</p>
  }

  return (
    <ul className="notification-list">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onMarkAsRead={onMarkAsRead}
        />
      ))}
    </ul>
  )
}
