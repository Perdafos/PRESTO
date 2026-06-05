export interface Project {
  id: string;
  name: string;
  repo_full_name: string;
  clone_url: string;
  is_private: boolean;
  branch: string;
  env_vars: string; // Encrypted JSON string of record<string, string>
  created_at: string;
}

export type DeploymentStatus =
  | 'queued'
  | 'cloning'
  | 'detecting'
  | 'building'
  | 'starting'
  | 'health_checking'
  | 'updating_routing'
  | 'live'
  | 'clone_failed'
  | 'detection_failed'
  | 'build_failed'
  | 'start_failed'
  | 'health_check_failed'
  | 'routing_failed';

export interface Deployment {
  id: string;
  project_id: string;
  commit_sha: string;
  commit_message: string;
  triggered_by: string;
  status: DeploymentStatus;
  container_port: number | null;
  live_url: string | null;
  logs: string;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface Route {
  project_id: string;
  domain: string;
  container_port: number;
  is_active: boolean;
  updated_at: string;
}
