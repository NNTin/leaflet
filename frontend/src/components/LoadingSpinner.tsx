import React from 'react'
import styles from './LoadingSpinner.module.css'

interface LoadingSpinnerProps {
  fullPage?: boolean;
}

export default function LoadingSpinner({ fullPage = false }: LoadingSpinnerProps) {
  if (fullPage) {
    return (
      <div className={styles.fullPage}>
        <div className={styles.spinner} />
      </div>
    )
  }
  return <div className={styles.spinner} />
}
