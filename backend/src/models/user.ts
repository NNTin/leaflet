export interface User {
  id: number;
  github_id: string;
  username: string;
  role: 'user' | 'privileged' | 'admin';
  created_at: Date;
}
