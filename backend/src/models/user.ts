export interface User {
  id: number;
  /** Retained for backwards-compat with existing rows. Null once migration 006 has run. */
  github_id?: string | null;
  username: string;
  role: 'user' | 'privileged' | 'admin';
  created_at: Date;
}
