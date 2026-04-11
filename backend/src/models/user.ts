export interface User {
  id: number;
  username: string;
  role: 'user' | 'privileged' | 'admin';
  created_at: Date;
}
