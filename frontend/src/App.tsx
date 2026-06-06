import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Folder,
  FolderPlus,
  Server,
  Moon,
  Sun,
  Plus,
  Play,
  ExternalLink,
  ListFilter,
  Terminal,
  Monitor,
  Lock,
  Globe,
  PlusCircle
} from 'lucide-react';

// --- TYPES ---
interface Project {
  id: string;
  name: string;
  repo_full_name: string;
  clone_url: string;
  is_private: boolean;
  branch: string;
  env_vars: string;
  created_at: string;
}

interface Deployment {
  id: string;
  project_id: string;
  commit_sha: string;
  commit_message: string;
  triggered_by: string;
  status: string;
  container_port: number | null;
  live_url: string | null;
  logs?: string;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

interface SystemStats {
  cpuLoad: number;
  freeMem: string;
  totalMem: string;
  uptime: string;
  queueWaiting: number;
  queueActive: number;
}

interface EnvRow {
  key: string;
  value: string;
}

export default function App() {
  // --- STATE ---
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'projects'>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [terminalStatus, setTerminalStatus] = useState<string>('IDLE');
  const [terminalMeta, setTerminalMeta] = useState<string>('Select a deployment to view live logs');
  const [stats, setStats] = useState<SystemStats>({
    cpuLoad: 0,
    freeMem: '0.0 GB',
    totalMem: '0.0 GB',
    uptime: '0.0 hours',
    queueWaiting: 0,
    queueActive: 0
  });

  // Theme State
  const [isDark, setIsDark] = useState<boolean>(() => {
    return document.documentElement.classList.contains('dark');
  });

  // Modals & Forms
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    repo_full_name: '',
    clone_url: '',
    is_private: false,
    branch: 'main'
  });
  const [envRows, setEnvRows] = useState<EnvRow[]>([{ key: '', value: '' }]);



  // Refs
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // --- THEME TOGGLE ---
  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  // --- INITIAL DATA FETCH ---
  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) setProjects(await res.json());
    } catch (err) {
      console.error('Error loading projects:', err);
    }
  };

  const loadDeployments = async () => {
    try {
      const res = await fetch('/api/deployments');
      if (res.ok) setDeployments(await res.json());
    } catch (err) {
      console.error('Error loading deployments:', err);
    }
  };

  const updateStats = async () => {
    try {
      const res = await fetch('/api/sys-stats');
      if (res.ok) setStats(await res.json());
    } catch (err) {
      console.warn('Failed to load system stats:', err);
    }
  };

  // --- WEBSOCKET CONNECTION ---
  useEffect(() => {
    loadProjects();
    loadDeployments();
    updateStats();
    
    // Stats polling
    const statsInterval = setInterval(updateStats, 5000);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connectWS = () => {
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('[WebSocket] Open');
        socket.send(JSON.stringify({ action: 'subscribe-dashboard' }));
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'init-dashboard') {
          setProjects(msg.projects);
          setDeployments(msg.deployments);
        } else if (msg.type === 'project-created') {
          setProjects(prev => [...prev, msg.project]);
        } else if (msg.type === 'deployment-update') {
          setDeployments(prev => {
            const idx = prev.findIndex(d => d.id === msg.deployment.id);
            if (idx >= 0) {
              const clone = [...prev];
              clone[idx] = msg.deployment;
              return clone;
            } else {
              return [msg.deployment, ...prev];
            }
          });
        } else if (msg.type === 'init-logs') {
          setTerminalLogs(msg.logs ? msg.logs.split('\n') : []);
          setTerminalStatus(msg.status);
        } else if (msg.type === 'log') {
          setTerminalLogs(prev => [...prev, msg.logLine]);
          setTerminalStatus(msg.status);
        }
      };

      socket.onclose = () => {
        console.log('[WebSocket] Closed, reconnecting...');
        setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    return () => {
      clearInterval(statsInterval);
      if (socketRef.current) socketRef.current.close();
    };
  }, []);

  // Subscribe to selected deployment logs
  useEffect(() => {
    if (!selectedDeploymentId) return;

    // Send subscribe message to WebSocket
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        action: 'subscribe',
        deploymentId: selectedDeploymentId
      }));
    }

    // Set terminal meta details
    const dep = deployments.find(d => d.id === selectedDeploymentId);
    const proj = dep ? projects.find(p => p.id === dep.project_id) : null;
    if (dep && proj) {
      setTerminalMeta(`App: ${proj.name} | Commit: ${dep.commit_sha.substring(0, 7)} | Msg: "${dep.commit_message}"`);
      setTerminalLogs([]);
      setTerminalStatus(dep.status);
    }
  }, [selectedDeploymentId]);

  // Autoscroll terminal
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [terminalLogs]);

  // --- MANUAL ACTIONS ---
  const triggerManualDeploy = async (projectId: string) => {
    if (!confirm('Are you sure you want to trigger a manual deployment for this project?')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/deploy`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setCurrentTab('dashboard');
        // Let lists load and highlight
        setTimeout(() => setSelectedDeploymentId(data.deployment_id), 300);
      } else {
        const err = await res.json();
        alert(`Failed to trigger deploy: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Error dispatching deploy: ${err.message}`);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    // Compile env vars key-values
    const env_vars: Record<string, string> = {};
    envRows.forEach(row => {
      const k = row.key.trim();
      const v = row.value.trim();
      if (k) env_vars[k] = v;
    });

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newProject, env_vars })
      });

      if (res.ok) {
        setIsModalOpen(false);
        setNewProject({ name: '', repo_full_name: '', clone_url: '', is_private: false, branch: 'main' });
        setEnvRows([{ key: '', value: '' }]);
        setCurrentTab('projects');
        loadProjects();
      } else {
        const err = await res.json();
        alert(`Error creating project: ${err.error}`);
      }
    } catch (err: any) {
      alert(`Request error: ${err.message}`);
    }
  };



  // --- ENV VAR ROW BUILDER ---
  const addEnvRow = () => setEnvRows(prev => [...prev, { key: '', value: '' }]);
  const removeEnvRow = (idx: number) => setEnvRows(prev => prev.filter((_, i) => i !== idx));
  const updateEnvRow = (idx: number, field: 'key' | 'value', val: string) => {
    setEnvRows(prev => prev.map((row, i) => i === idx ? { ...row, [field]: val } : row));
  };

  // --- LOG HIGHLIGHTER ---
  const getLogLineClass = (line: string) => {
    if (line.includes('ERROR:')) return 'text-red-400 font-semibold';
    if (line.includes('WARNING:')) return 'text-amber-400';
    if (line.includes('[git]') || line.includes('[docker-build]') || line.includes('[docker-run]')) return 'text-sky-400';
    if (line.includes('SUCCESS!') || line.includes('passed!')) return 'text-emerald-400 font-semibold';
    if (line.includes('[STATUS CHANGE]') || line.includes('[SIMULATION]')) return 'text-purple-400';
    return 'text-zinc-300';
  };

  const getStatusBannerClass = (status: string) => {
    let base = 'font-mono text-xs font-semibold px-2 py-0.5 rounded border ';
    if (status === 'live') {
      return base + 'bg-green-200 text-green-900 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-900';
    } else if (status.endsWith('_failed')) {
      return base + 'bg-red-200 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-900';
    } else if (status === 'IDLE') {
      return base + 'bg-secondary text-foreground border-border';
    } else {
      return base + 'bg-amber-200 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900';
    }
  };

  const getStatusPillClass = (status: string) => {
    if (status === 'live') {
      return 'bg-green-200 text-green-900 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-900';
    } else if (status.endsWith('_failed')) {
      return 'bg-red-200 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-900';
    } else if (status === 'queued') {
      return 'bg-zinc-200 text-zinc-900 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
    } else {
      return 'bg-amber-200 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900';
    }
  };

  return (
    <div className="flex w-full min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-card border-r border-border p-6 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8 px-2">
            <div className="p-1.5 bg-primary text-primary-foreground rounded-md">
              <Server className="w-5 h-5" />
            </div>
            <h2 className="font-semibold text-lg tracking-tight">PaaS <span className="font-normal text-muted-foreground">Engine</span></h2>
          </div>

          {/* Navigation Menu */}
          <nav className="flex flex-col gap-1">
            <button
              onClick={() => setCurrentTab('dashboard')}
              className={`menu-item w-full text-left flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer ${
                currentTab === 'dashboard'
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground text-muted-foreground'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" /> Dashboard
            </button>
            <button
              onClick={() => setCurrentTab('projects')}
              className={`menu-item w-full text-left flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer ${
                currentTab === 'projects'
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground text-muted-foreground'
              }`}
            >
              <Folder className="w-4 h-4" /> Projects
            </button>
          </nav>
        </div>

        {/* Engine Stats Widget */}
        <div>
          <div className="bg-muted border border-border rounded-xl p-4 mt-auto">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Engine Status</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex flex-col">
                <span className="text-muted-foreground">CPU Load</span>
                <span className="font-mono font-medium text-foreground">{(stats.cpuLoad * 100).toFixed(1)}%</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Free RAM</span>
                <span className="font-mono font-medium text-foreground">{stats.freeMem}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Active Jobs</span>
                <span className="font-mono font-medium text-foreground">{stats.queueActive}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Waiting Jobs</span>
                <span className="font-mono font-medium text-foreground">{stats.queueWaiting}</span>
              </div>
            </div>
          </div>

          {/* Copyright footer */}
          <div className="mt-4 pt-3 border-t border-border text-center">
            <p className="text-[10px] text-muted-foreground font-mono">Copyright &copy; 2026 Perdafos. All rights reserved.</p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto max-h-screen">
        {/* Top Bar */}
        <header className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight">
            {currentTab === 'dashboard' && 'PaaS Deployment Dashboard'}
            {currentTab === 'projects' && 'Registered Projects'}
          </h1>
          
          <div className="flex items-center gap-3">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 border border-border bg-card text-muted-foreground hover:text-foreground rounded-lg cursor-pointer"
              title="Toggle Theme"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            {/* Create Project Button */}
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-primary text-primary-foreground hover:bg-primary px-4 py-2 rounded-lg font-medium text-sm inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Create Project
            </button>
          </div>
        </header>

        {/* Tab content: Dashboard */}
        {currentTab === 'dashboard' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Deployments list */}
            <div className="xl:col-span-7 bg-card border border-border rounded-xl p-6 shadow-sm">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-border">
                <h3 className="font-semibold text-base flex items-center gap-2 text-foreground">
                  <ListFilter className="w-4 h-4 text-muted-foreground" /> Recent Deployments
                </h3>
                <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full font-medium">
                  {deployments.length} total
                </span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="pb-3 pl-3">Commit</th>
                      <th className="pb-3">Project</th>
                      <th className="pb-3">State</th>
                      <th className="pb-3">Duration</th>
                      <th className="pb-3">Created</th>
                      <th className="pb-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {deployments.length === 0 ? (
                      <tr className="text-muted-foreground text-center">
                        <td colSpan={6} className="py-12 text-sm">
                          No deployments found. Trigger a webhook or create a project!
                        </td>
                      </tr>
                    ) : (
                      deployments.map(d => {
                        const proj = projects.find(p => p.id === d.project_id);
                        return (
                          <tr
                            key={d.id}
                            onClick={() => setSelectedDeploymentId(d.id)}
                            className={`cursor-pointer text-sm text-foreground ${
                              selectedDeploymentId === d.id ? 'bg-muted hover:bg-muted' : 'hover:bg-muted'
                            }`}
                          >
                            <td className="py-3.5 pl-3">
                              <span className="font-mono bg-muted border border-border px-1.5 py-0.5 rounded text-[11px]">
                                {d.commit_sha.substring(0, 7)}
                              </span>
                            </td>
                            <td className="py-3.5 font-medium text-foreground">{proj ? proj.name : 'Unknown'}</td>
                            <td className="py-3.5">
                              <span className={`pill ${getStatusPillClass(d.status)}`}>{d.status}</span>
                            </td>
                            <td className="py-3.5 text-xs text-muted-foreground">
                              {d.duration_ms ? `${(d.duration_ms / 1000).toFixed(1)}s` : '--'}
                            </td>
                            <td className="py-3.5 text-xs text-muted-foreground">
                              {new Date(d.created_at).toLocaleTimeString()} ({new Date(d.created_at).toLocaleDateString()})
                            </td>
                            <td className="py-3.5">
                              {d.live_url ? (
                                <a
                                  href={d.live_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="bg-secondary text-secondary-foreground hover:bg-secondary px-2.5 py-1 border border-border rounded-md text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                                >
                                  Open <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : '--'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Live Terminal logs */}
            <div className="xl:col-span-5 bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col h-[520px]">
              <div className="mb-4 pb-2 border-b border-border">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-base flex items-center gap-2 text-foreground">
                    <Terminal className="w-4 h-4 text-muted-foreground" /> Live Log Console
                  </h3>
                  <span className={getStatusBannerClass(terminalStatus)}>
                    {terminalStatus.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">{terminalMeta}</div>
              </div>
              
              <div className="terminal-console rounded-lg flex-1 p-4 overflow-y-auto text-xs whitespace-pre-wrap relative">
                {terminalLogs.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col justify-center items-center text-muted-foreground p-4 text-center">
                    <Monitor className="w-8 h-8 mb-2" />
                    <p className="text-sm">Logs will stream here in real-time once a deployment starts.</p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {terminalLogs.map((line, idx) => (
                      <div key={idx} className={getLogLineClass(line)}>{line}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab content: Projects */}
        {currentTab === 'projects' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center col-span-full">
                <Folder className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-60" />
                <h3 className="font-medium text-foreground">No projects registered</h3>
                <p className="text-xs text-muted-foreground mt-1">Configure your first application repository to start deploying.</p>
              </div>
            ) : (
              projects.map(p => (
                <div key={p.id} className="bg-card border border-border rounded-xl p-5 flex flex-col justify-between h-[210px] shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-sm text-foreground">{p.name}</h3>
                      <span className="text-xs text-muted-foreground font-mono block mt-0.5 truncate max-w-[170px]" title={p.repo_full_name}>
                        {p.repo_full_name}
                      </span>
                    </div>
                    <span className="text-[10px] bg-muted border border-border text-muted-foreground px-2 py-0.5 rounded font-medium inline-flex items-center gap-1">
                      {p.is_private ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                      {p.is_private ? 'Private' : 'Public'}
                    </span>
                  </div>
                  <div className="space-y-1.5 my-3 text-xs">
                    <div className="flex justify-between border-b border-border pb-1">
                      <span className="text-muted-foreground">Branch</span>
                      <span className="text-foreground font-medium">{p.branch}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-1">
                      <span className="text-muted-foreground">Created</span>
                      <span className="text-foreground font-medium">{new Date(p.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => triggerManualDeploy(p.id)}
                      className="bg-secondary text-secondary-foreground hover:bg-secondary flex-1 justify-center py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer border border-border"
                    >
                      <Play className="w-3 h-3" /> Deploy Now
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}


      </main>

      {/* Create Project Modal */}
      {isModalOpen && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-background/95">
          <div className="modal bg-card border border-border rounded-xl max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="modal-header flex justify-between items-center px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-base text-foreground flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-muted-foreground" /> Create New Project
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="modal-close text-muted-foreground hover:text-foreground cursor-pointer text-xl">&times;</button>
            </div>
            
            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Project Name</label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. my-laravel-app"
                  className="w-full bg-transparent border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Repository Full Name</label>
                <input
                  type="text"
                  value={newProject.repo_full_name}
                  onChange={(e) => setNewProject(prev => ({ ...prev, repo_full_name: e.target.value }))}
                  placeholder="e.g. username/repo-name"
                  className="w-full bg-transparent border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Clone URL</label>
                <input
                  type="text"
                  value={newProject.clone_url}
                  onChange={(e) => setNewProject(prev => ({ ...prev, clone_url: e.target.value }))}
                  placeholder="e.g. https://github.com/username/repo-name.git"
                  className="w-full bg-transparent border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
              
              <div className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  id="proj-private-react"
                  checked={newProject.is_private}
                  onChange={(e) => setNewProject(prev => ({ ...prev, is_private: e.target.checked }))}
                  className="rounded border-input text-primary focus:ring-primary w-4 h-4"
                />
                <label htmlFor="proj-private-react" className="text-sm font-medium text-foreground">Private Repository</label>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Deployment Branch</label>
                <input
                  type="text"
                  value={newProject.branch}
                  onChange={(e) => setNewProject(prev => ({ ...prev, branch: e.target.value }))}
                  className="w-full bg-transparent border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
              
              {/* Environment Variables Editor */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Environment Variables</label>
                <div className="space-y-2">
                  {envRows.map((row, idx) => (
                    <div key={idx} className="env-row flex gap-2">
                      <input
                        type="text"
                        value={row.key}
                        onChange={(e) => updateEnvRow(idx, 'key', e.target.value)}
                        className="env-key w-1/3 bg-transparent border border-input rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                        placeholder="KEY"
                      />
                      <input
                        type="text"
                        value={row.value}
                        onChange={(e) => updateEnvRow(idx, 'value', e.target.value)}
                        className="env-val flex-1 bg-transparent border border-input rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                        placeholder="VALUE"
                      />
                      <button
                        type="button"
                        onClick={() => removeEnvRow(idx)}
                        className="btn-remove-env px-2.5 text-destructive hover:bg-destructive hover:text-destructive-foreground border border-transparent rounded-lg text-sm cursor-pointer"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addEnvRow}
                  className="border border-border bg-card text-muted-foreground hover:text-foreground text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Add Variable
                </button>
              </div>

              <div className="modal-footer flex justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="border border-border bg-card hover:bg-accent text-foreground px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground hover:bg-primary px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
