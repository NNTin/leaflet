import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import styles from './AppLayout.module.css'

export default function AppLayout() {
  return (
    <div className={styles.page}>
      <Navbar />
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  )
}
