import React from 'react'
import styles from './LoadingSpinner.module.css'

export default function LoadingSpinner({ fullPage = false }) {
  if (fullPage) {
    return (
      <div className={styles.fullPage}>
        <div className={styles.spinner} />
      </div>
    )
  }
  return <div className={styles.spinner} />
}
