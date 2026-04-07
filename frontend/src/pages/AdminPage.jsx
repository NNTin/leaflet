import React, { useEffect, useState } from 'react'
import axios from 'axios'
import Navbar from '../components/Navbar'
import LoadingSpinner from '../components/LoadingSpinner'
import styles from './AdminPage.module.css'

const adminApi = axios.create({ withCredentials: true })

let csrfCache = null

async function getCsrf() {
  if (csrfCache) return csrfCache
  try {
    const res = await axios.get('/auth/csrf-token', { withCredentials: true })
    csrfCache = res.data?.csrfToken || res.data?.token || ''
  } catch {
    csrfCache = ''
  }
  return csrfCache
}

async function authHeaders() {
  const token = await getCsrf()
  return token ? { 'X-CSRF-Token': token } : {}
}

export default function AdminPage() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [tab, setTab] = useState('links')

  const [links, setLinks] = useState([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [linksError, setLinksError] = useState('')

  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')

  const [actionMsg, setActionMsg] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    axios.get('/auth/me', { withCredentials: true })
      .then(res => setUser(res.data))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    if (user?.role !== 'admin') return
    if (tab === 'links') fetchLinks()
    if (tab === 'users') fetchUsers()
  }, [tab, user])

  async function fetchLinks() {
    setLinksLoading(true)
    setLinksError('')
    try {
      const res = await adminApi.get('/admin/urls')
      setLinks(res.data?.urls || res.data || [])
    } catch (err) {
      setLinksError(err.response?.data?.error || 'Failed to load links.')
    } finally {
      setLinksLoading(false)
    }
  }

  async function fetchUsers() {
    setUsersLoading(true)
    setUsersError('')
    try {
      const res = await adminApi.get('/admin/users')
      setUsers(res.data?.users || res.data || [])
    } catch (err) {
      setUsersError(err.response?.data?.error || 'Failed to load users.')
    } finally {
      setUsersLoading(false)
    }
  }

  function clearMessages() {
    setActionMsg('')
    setActionError('')
  }

  async function deleteLink(id) {
    clearMessages()
    try {
      const headers = await authHeaders()
      await adminApi.delete(`/admin/urls/${id}`, { headers })
      setLinks(prev => prev.filter(l => l.id !== id))
      setActionMsg('Link deleted.')
    } catch (err) {
      csrfCache = null
      setActionError(err.response?.data?.error || 'Failed to delete link.')
    }
  }

  async function setUserRole(userId, role) {
    clearMessages()
    try {
      const headers = await authHeaders()
      await adminApi.patch(`/admin/users/${userId}/role`, { role }, { headers })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
      setActionMsg(`User role updated to "${role}".`)
    } catch (err) {
      csrfCache = null
      setActionError(err.response?.data?.error || 'Failed to update user role.')
    }
  }

  if (authLoading) return <LoadingSpinner fullPage />

  if (!user || user.role !== 'admin') {
    return (
      <div className={styles.page}>
        <Navbar user={user} />
        <main className={styles.main}>
          <div className={`card ${styles.forbiddenCard}`}>
            <div className={styles.forbiddenIcon}>🚫</div>
            <h1 className={styles.forbiddenTitle}>Access Denied</h1>
            <p className={styles.forbiddenMsg}>
              You must be an administrator to view this page.
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Navbar user={user} />

      <div className={`page-container-wide ${styles.content}`}>
        <h1 className={styles.heading}>Admin Dashboard</h1>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'links' ? styles.tabActive : ''}`}
            onClick={() => setTab('links')}
          >
            🔗 Links
          </button>
          <button
            className={`${styles.tab} ${tab === 'users' ? styles.tabActive : ''}`}
            onClick={() => setTab('users')}
          >
            👥 Users
          </button>
        </div>

        {(actionMsg || actionError) && (
          <div className={actionError ? 'error-msg' : 'success-msg'} style={{ marginBottom: '1rem' }}>
            {actionMsg || actionError}
          </div>
        )}

        {tab === 'links' && (
          <div className={`card ${styles.tableCard}`}>
            <div className={styles.tableHeader}>
              <h2 className={styles.tableTitle}>All Links</h2>
              <button onClick={fetchLinks} className="btn btn-secondary btn-sm">↻ Refresh</button>
            </div>
            {linksLoading ? (
              <div className={styles.center}><LoadingSpinner /></div>
            ) : linksError ? (
              <div className="error-msg">{linksError}</div>
            ) : links.length === 0 ? (
              <p className={styles.empty}>No links found.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Original URL</th>
                      <th>Created</th>
                      <th>Expires</th>
                      <th>Created By</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map(link => (
                      <tr key={link.id}>
                        <td>
                          <a
                            href={`/s/${link.shortCode}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.codeLink}
                          >
                            {link.shortCode}
                          </a>
                        </td>
                        <td>
                          <a
                            href={link.originalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate"
                            title={link.originalUrl}
                          >
                            {link.originalUrl}
                          </a>
                        </td>
                        <td>{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : '—'}</td>
                        <td>{link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'Never'}</td>
                        <td>{link.createdBy || '—'}</td>
                        <td>
                          <button
                            onClick={() => deleteLink(link.id)}
                            className="btn btn-danger btn-sm"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'users' && (
          <div className={`card ${styles.tableCard}`}>
            <div className={styles.tableHeader}>
              <h2 className={styles.tableTitle}>All Users</h2>
              <button onClick={fetchUsers} className="btn btn-secondary btn-sm">↻ Refresh</button>
            </div>
            {usersLoading ? (
              <div className={styles.center}><LoadingSpinner /></div>
            ) : usersError ? (
              <div className="error-msg">{usersError}</div>
            ) : users.length === 0 ? (
              <p className={styles.empty}>No users found.</p>
            ) : (
              <div className={styles.tableWrapper}>
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td className={styles.username}>{u.username}</td>
                        <td>
                          <span className={`${styles.roleBadge} ${styles[`role_${u.role}`]}`}>
                            {u.role}
                          </span>
                        </td>
                        <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                        <td className={styles.actionCell}>
                          {u.role === 'user' && (
                            <button
                              onClick={() => setUserRole(u.id, 'privileged')}
                              className="btn btn-secondary btn-sm"
                            >
                              Make Privileged
                            </button>
                          )}
                          {u.role === 'privileged' && (
                            <button
                              onClick={() => setUserRole(u.id, 'user')}
                              className="btn btn-secondary btn-sm"
                            >
                              Make User
                            </button>
                          )}
                          {u.role === 'admin' && (
                            <span className={styles.adminNote}>Admin</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
