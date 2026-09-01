/**
 * Static, hard-coded users allowed to access the Edge Gateway dashboard and
 * change ANY configuration (devices, tags, service settings). Exactly two.
 *
 * Kept hard-coded (not in the platform DB) on purpose so the gateway's local
 * admin access never depends on the database being reachable — the edge must
 * stay configurable even when the MES platform is offline.
 *
 * Passwords may be overridden via env (EDGE_ADMIN_PASSWORD / EDGE_ENGINEER_PASSWORD)
 * but default to the values documented in README.md. Change them for production.
 */
export interface ConfigUser {
  email: string;
  password: string;
  name: string;
  role: string;
}

export const CONFIG_USERS: ConfigUser[] = [
  {
    email: 'admin@industry360.sa',
    password: process.env.EDGE_ADMIN_PASSWORD || 'Password@123',
    name: 'Edge Administrator',
    role: 'EDGE_ADMIN',
  },
  {
    email: 'engineer@industry360.sa',
    password: process.env.EDGE_ENGINEER_PASSWORD || 'Password@123',
    name: 'Edge Engineer',
    role: 'EDGE_ENGINEER',
  },
];
