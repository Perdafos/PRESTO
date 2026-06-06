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
  Terminal,
  Monitor,
  PlusCircle,
  Settings,
  History,
  Activity,
  Cpu,
  HardDrive,
  Search,
  User,
  ArrowLeft,
  CloudSun,
  Cloud,
  CloudRain,
  CloudLightning,
  CheckCircle2,
  XCircle,
  Clock
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
  framework?: string;
  domain?: string;
  port?: number;
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
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'build-history' | 'system-status'>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [terminalStatus, setTerminalStatus] = useState<string>('IDLE');
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
    branch: 'main',
    framework: 'AUTO',
    domain: '',
    port: ''
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

    // Set terminal details
    const dep = deployments.find(d => d.id === selectedDeploymentId);
    const proj = dep ? projects.find(p => p.id === dep.project_id) : null;
    if (dep && proj) {
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
        setNewProject({
          name: '',
          repo_full_name: '',
          clone_url: '',
          is_private: false,
          branch: 'main',
          framework: 'AUTO',
          domain: '',
          port: ''
        });
        setEnvRows([{ key: '', value: '' }]);
        setCurrentTab('dashboard');
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

  // Helper: Get project deployments
  const getProjectDeployments = (projectId: string) => {
    return deployments.filter(d => d.project_id === projectId);
  };

  // Helper: Calculate Status Ball for a project
  const getProjectStatus = (projectId: string) => {
    const projDeps = getProjectDeployments(projectId);
    if (projDeps.length === 0) return 'idle';

    const sorted = [...projDeps].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latest = sorted[0];

    if (['queued', 'cloning', 'detecting', 'building', 'starting', 'health_checking', 'updating_routing'].includes(latest.status)) {
      return 'building';
    }
    if (latest.status === 'live') {
      return 'success';
    }
    if (latest.status.endsWith('_failed')) {
      return 'failed';
    }
    return 'idle';
  };

  // Helper: Get Weather Icon & Description
  const getProjectWeather = (projectId: string) => {
    const projDeps = getProjectDeployments(projectId);
    if (projDeps.length === 0) return { icon: <Sun className="w-5 h-5 text-amber-500" />, desc: 'No builds yet' };

    const completed = projDeps
      .filter(d => !['queued', 'cloning', 'detecting', 'building', 'starting', 'health_checking', 'updating_routing'].includes(d.status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);

    if (completed.length === 0) {
      return { icon: <Sun className="w-5 h-5 text-amber-500" />, desc: 'No completed builds yet' };
    }

    const successes = completed.filter(d => d.status === 'live').length;
    const ratio = successes / completed.length;

    if (ratio === 1.0) {
      return { icon: <Sun className="w-5 h-5 text-amber-500" />, desc: 'All recent builds successful' };
    } else if (ratio >= 0.8) {
      return { icon: <CloudSun className="w-5 h-5 text-zinc-400" />, desc: 'Most recent builds successful' };
    } else if (ratio >= 0.5) {
      return { icon: <Cloud className="w-5 h-5 text-zinc-400" />, desc: 'Some recent builds failed' };
    } else if (ratio >= 0.2) {
      return { icon: <CloudRain className="w-5 h-5 text-slate-400" />, desc: 'Many recent builds failed' };
    } else {
      return { icon: <CloudLightning className="w-5 h-5 text-red-500" />, desc: 'All recent builds failed' };
    }
  };

  const getRelativeTime = (dateStr: string) => {
    const elapsed = Date.now() - new Date(dateStr).getTime();
    const sec = Math.floor(elapsed / 1000);
    if (sec < 60) return 'Just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return 'N/A';
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s`;
  };

  const getStageStatus = (stage: string, currentStatus: string) => {
    const isFailed = currentStatus.endsWith('_failed');
    const failedStage = isFailed ? currentStatus.replace('_failed', '') : '';

    const stageMapping: Record<string, string[]> = {
      'Checkout': ['cloning'],
      'Detect': ['detecting'],
      'Build': ['building'],
      'Deploy': ['starting'],
      'Health': ['health_checking'],
      'Route': ['updating_routing']
    };

    const stageOrder = ['Checkout', 'Detect', 'Build', 'Deploy', 'Health', 'Route'];
    const currentStageIdx = stageOrder.indexOf(stage);

    let activeIdx = -1;
    for (let i = 0; i < stageOrder.length; i++) {
      const activePhases = stageMapping[stageOrder[i]];
      if (activePhases.includes(currentStatus)) {
        activeIdx = i;
        break;
      }
    }

    if (currentStatus === 'queued') {
      return 'pending';
    }

    if (currentStatus === 'live') {
      return 'success';
    }

    if (isFailed) {
      const failedMap: Record<string, string> = {
        'clone': 'Checkout',
        'detect': 'Detect',
        'build': 'Build',
        'start': 'Deploy',
        'health': 'Health',
        'route': 'Route'
      };
      const failedStageName = failedMap[failedStage] || '';
      const failedStageIdx = stageOrder.indexOf(failedStageName);

      if (stage === failedStageName) {
        return 'failed';
      }
      if (currentStageIdx < failedStageIdx) {
        return 'success';
      }
      return 'pending';
    }

    if (activeIdx === -1) {
      return 'success';
    }

    if (currentStageIdx < activeIdx) {
      return 'success';
    }
    if (currentStageIdx === activeIdx) {
      return 'running';
    }
    return 'pending';
  };

  const renderPipelineStages = (status: string) => {
    const stages = ['Checkout', 'Detect', 'Build', 'Deploy', 'Health', 'Route'];
    
    return (
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-1.5 font-mono">
          <Activity className="w-3.5 h-3.5 text-blue-500" /> Pipeline Stage View
        </h4>
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 md:gap-2 relative">
          {stages.map((stage, idx) => {
            const stageStatus = getStageStatus(stage, status);
            return (
              <React.Fragment key={stage}>
                <div className="flex-1 flex flex-col items-center text-center p-3 rounded-lg border border-border/40 bg-muted/20 relative z-10 min-w-[100px]">
                  <span className="text-[10px] text-muted-foreground font-mono font-bold uppercase tracking-wider mb-2">{stage}</span>
                  
                  <div className="relative flex items-center justify-center">
                    {stageStatus === 'success' && (
                      <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-500 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    )}
                    {stageStatus === 'failed' && (
                      <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-950/50 border border-red-500 flex items-center justify-center text-red-600 dark:text-red-400 animate-pulse">
                        <XCircle className="w-4 h-4" />
                      </div>
                    )}
                    {stageStatus === 'running' && (
                      <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950/50 border border-blue-500 flex items-center justify-center text-blue-600 dark:text-blue-400">
                        <Clock className="w-4 h-4 animate-spin" />
                      </div>
                    )}
                    {stageStatus === 'pending' && (
                      <div className="w-7 h-7 rounded-full bg-secondary border border-border flex items-center justify-center text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/30"></span>
                      </div>
                    )}
                  </div>
                  
                  <span className="text-[11px] font-semibold text-foreground mt-2">
                    {stageStatus === 'success' && 'Completed'}
                    {stageStatus === 'failed' && 'Failed'}
                    {stageStatus === 'running' && 'In Progress'}
                    {stageStatus === 'pending' && 'Pending'}
                  </span>
                </div>
                
                {idx < stages.length - 1 && (
                  <div className="hidden md:block h-[1px] bg-border flex-1 mx-2"></div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full min-h-screen bg-background text-foreground">
      {/* Top Bar / Header */}
      <header className="flex justify-between items-center bg-card border-b border-border px-6 py-3 shrink-0 shadow-sm">
        {/* Logo & Brand */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-600 dark:bg-blue-700 text-white rounded">
            <Server className="w-5 h-5 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-foreground flex items-center gap-1.5">
              Jenkins <span className="text-xs bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 font-normal px-1.5 py-0.5 rounded border border-blue-300 dark:border-blue-900">Presto CI/CD</span>
            </span>
            {/* Breadcrumbs */}
            <div className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
              <span>Dashboard</span>
              {currentTab !== 'dashboard' && (
                <>
                  <span>&rsaquo;</span>
                  <span className="capitalize">{currentTab.replace('-', ' ')}</span>
                </>
              )}
              {selectedDeploymentId && (
                <>
                  <span>&rsaquo;</span>
                  <span>Build #{selectedDeploymentId.substring(0, 8)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Search bar & Admin Menu */}
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search jobs..."
              className="w-48 bg-muted border border-border rounded-lg pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-1.5 border border-border bg-card text-muted-foreground hover:text-foreground rounded cursor-pointer"
            title="Toggle Theme"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <div className="flex items-center gap-2 pl-2 border-l border-border">
            <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <span className="text-xs font-medium text-foreground hidden sm:inline">admin</span>
          </div>
        </div>
      </header>

      {/* Sub-header content wrapper */}
      <div className="flex flex-1 w-full overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-card border-r border-border p-6 flex flex-col justify-between shrink-0 overflow-y-auto">
          <div className="space-y-6">
            {/* Navigation Menu */}
            <nav className="flex flex-col gap-1">
              <button
                onClick={() => { setCurrentTab('dashboard'); setSelectedDeploymentId(null); }}
                className={`menu-item w-full text-left flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer ${
                  currentTab === 'dashboard' && !selectedDeploymentId
                    ? 'bg-accent text-accent-foreground border-l-4 border-blue-500 pl-2'
                    : 'hover:bg-accent hover:text-accent-foreground text-muted-foreground'
                }`}
              >
                <LayoutDashboard className="w-4 h-4 text-blue-500" /> Dashboard
              </button>
              <button
                onClick={() => setIsModalOpen(true)}
                className="menu-item w-full text-left flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer hover:bg-accent hover:text-accent-foreground text-muted-foreground"
              >
                <PlusCircle className="w-4 h-4 text-emerald-500" /> New Item
              </button>
              <button
                onClick={() => { setCurrentTab('build-history'); setSelectedDeploymentId(null); }}
                className={`menu-item w-full text-left flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer ${
                  currentTab === 'build-history' && !selectedDeploymentId
                    ? 'bg-accent text-accent-foreground border-l-4 border-blue-500 pl-2'
                    : 'hover:bg-accent hover:text-accent-foreground text-muted-foreground'
                }`}
              >
                <History className="w-4 h-4 text-amber-500" /> Build History
              </button>
              <button
                onClick={() => { setCurrentTab('system-status'); setSelectedDeploymentId(null); }}
                className={`menu-item w-full text-left flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer ${
                  currentTab === 'system-status' && !selectedDeploymentId
                    ? 'bg-accent text-accent-foreground border-l-4 border-blue-500 pl-2'
                    : 'hover:bg-accent hover:text-accent-foreground text-muted-foreground'
                }`}
              >
                <Settings className="w-4 h-4 text-zinc-500" /> Manage Jenkins
              </button>
            </nav>
          </div>

          {/* Build Queue & Executor Widget */}
          <div className="space-y-4 pt-4 border-t border-border mt-6">
            <div className="bg-muted border border-border rounded-lg p-3">
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Build Queue</span>
                <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[9px] font-mono font-bold">{stats.queueWaiting}</span>
              </h4>
              {stats.queueWaiting === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">No jobs in queue.</p>
              ) : (
                <div className="space-y-1">
                  {Array.from({ length: stats.queueWaiting }).map((_, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] text-foreground font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                      <span>Pending build #{i + 1}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-muted border border-border rounded-lg p-3">
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Build Executor Status</span>
              </h4>
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between border-b border-border/50 pb-1">
                  <span className="text-muted-foreground font-mono">1. Master Host</span>
                  {stats.queueActive > 0 ? (
                    <span className="text-blue-500 dark:text-blue-400 font-medium animate-pulse inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Building...
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">Idle</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground font-mono">2. Agent Host</span>
                  <span className="text-muted-foreground italic">Idle</span>
                </div>
              </div>
            </div>
            
            <div className="text-[10px] text-muted-foreground font-mono space-y-0.5 border-t border-border pt-2">
              <div>CPU Load: {(stats.cpuLoad * 100).toFixed(1)}%</div>
              <div>Free RAM: {stats.freeMem}</div>
            </div>
            
            <div className="text-center pt-2 border-t border-border/50">
              <p className="text-[9px] text-muted-foreground font-mono">Copyright &copy; 2026 Perdafos. All rights reserved.</p>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-8 overflow-y-auto max-h-[calc(100vh-53px)] bg-muted/20">
          
          {/* Dedicated selected deployment logs screen */}
          {selectedDeploymentId && (() => {
            const dep = deployments.find(d => d.id === selectedDeploymentId);
            const proj = dep ? projects.find(p => p.id === dep.project_id) : null;
            if (!dep) return <div className="p-6">Deployment not found.</div>;
            
            return (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
                {/* Build Sidebar Options */}
                <div className="md:col-span-1 space-y-2">
                  <button
                    onClick={() => setSelectedDeploymentId(null)}
                    className="w-full bg-secondary hover:bg-secondary/80 text-secondary-foreground px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 border border-border cursor-pointer justify-center"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
                  </button>
                  
                  <div className="bg-card border border-border rounded-xl p-4 space-y-1 shadow-sm">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 px-1">Build Menu</div>
                    <button className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-accent-foreground flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-blue-500" /> Console Output
                    </button>
                    {dep.live_url && (
                      <a
                        href={dep.live_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 text-emerald-600 dark:text-emerald-400 hover:bg-accent"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open Application
                      </a>
                    )}
                  </div>
                </div>

                {/* Build Console Logs Main Area */}
                <div className="md:col-span-3 space-y-6">
                  {renderPipelineStages(dep.status)}

                  <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                    <div className="flex justify-between items-start pb-4 border-b border-border mb-4">
                      <div>
                        <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                          {proj ? proj.name : 'Unknown Project'} &raquo; Build #{dep.id.substring(0, 8)}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1 font-mono">
                          Started: {new Date(dep.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className={`pill ${getStatusPillClass(dep.status)}`}>{dep.status}</span>
                    </div>

                    {/* Metadata fields */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mb-6 bg-muted/50 p-4 border border-border rounded-lg">
                      <div>
                        <div className="text-muted-foreground">Triggered By</div>
                        <div className="font-semibold text-foreground">{dep.triggered_by}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Commit SHA</div>
                        <div className="font-semibold text-foreground font-mono">{dep.commit_sha.substring(0, 7)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Duration</div>
                        <div className="font-semibold text-foreground">{formatDuration(dep.duration_ms)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Target Branch</div>
                        <div className="font-semibold text-foreground font-mono">{proj?.branch || 'main'}</div>
                      </div>
                    </div>

                    {/* Console Terminal */}
                    <div className="flex flex-col h-[400px]">
                      <div className="flex justify-between items-center mb-2 px-1">
                        <span className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5" /> Console Output Log
                        </span>
                        <span className={getStatusBannerClass(terminalStatus)}>
                          {terminalStatus.toUpperCase()}
                        </span>
                      </div>
                      <div className="terminal-console rounded-lg flex-1 p-4 overflow-y-auto text-[11px] font-mono whitespace-pre-wrap relative bg-zinc-950 text-zinc-200 border border-zinc-800">
                        {terminalLogs.length === 0 ? (
                          <div className="absolute inset-0 flex flex-col justify-center items-center text-zinc-400 p-4 text-center">
                            <Monitor className="w-8 h-8 mb-2" />
                            <p className="text-sm">Loading logs...</p>
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
                </div>
              </div>
            );
          })()}

          {/* Tab content: Dashboard (Jobs Table) */}
          {currentTab === 'dashboard' && !selectedDeploymentId && (
            <div className="space-y-6">
              {/* Welcome Banner */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1 z-10">
                  <h2 className="text-lg font-bold text-foreground">Welcome to Jenkins Presto CI/CD!</h2>
                  <p className="text-xs text-muted-foreground max-w-xl">
                    This deployment controller monitors repository commits, triggers automatic container builds, and routes traffic on custom domains.
                  </p>
                </div>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold text-xs inline-flex items-center gap-2 cursor-pointer z-10 shrink-0 border border-blue-500 shadow-sm"
                >
                  <Plus className="w-4 h-4" /> Create New Item
                </button>
              </div>

              {/* Jobs Table */}
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-border">
                  <h3 className="font-semibold text-base flex items-center gap-2 text-foreground">
                    <Folder className="w-4 h-4 text-blue-500" /> Jobs List
                  </h3>
                  <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full font-medium">
                    {projects.length} jobs
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <th className="pb-3 pl-3 w-10 text-center">S</th>
                        <th className="pb-3 w-10 text-center">W</th>
                        <th className="pb-3">Job Name</th>
                        <th className="pb-3">Last Success</th>
                        <th className="pb-3">Last Failure</th>
                        <th className="pb-3">Last Duration</th>
                        <th className="pb-3 text-center w-20">Build</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {projects.length === 0 ? (
                        <tr className="text-muted-foreground text-center">
                          <td colSpan={7} className="py-12 text-sm">
                            No jobs configured yet. Create a new item to get started!
                          </td>
                        </tr>
                      ) : (
                        projects.map(p => {
                          const status = getProjectStatus(p.id);
                          const weather = getProjectWeather(p.id);
                          const projDeps = getProjectDeployments(p.id);

                          const successes = projDeps
                            .filter(d => d.status === 'live')
                            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                          const failures = projDeps
                            .filter(d => d.status.endsWith('_failed'))
                            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                          const completed = projDeps
                            .filter(d => !['queued', 'cloning', 'detecting', 'building', 'starting', 'health_checking', 'updating_routing'].includes(d.status))
                            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

                          const lastSuccess = successes[0] ? getRelativeTime(successes[0].created_at) : 'N/A';
                          const lastFailure = failures[0] ? getRelativeTime(failures[0].created_at) : 'N/A';
                          const lastDuration = completed[0] ? formatDuration(completed[0].duration_ms) : 'N/A';

                          return (
                            <tr
                              key={p.id}
                              className="hover:bg-muted/50 text-sm text-foreground"
                            >
                              <td className="py-4 pl-3 text-center">
                                <div className="flex justify-center">
                                  {status === 'success' && (
                                    <span
                                      className="w-3.5 h-3.5 rounded-full bg-blue-500 dark:bg-blue-600 block shadow-[0_0_6px_rgba(59,130,246,0.6)]"
                                      title="Stable (Success)"
                                    ></span>
                                  )}
                                  {status === 'failed' && (
                                    <span
                                      className="w-3.5 h-3.5 rounded-full bg-red-500 block shadow-[0_0_6px_rgba(239,68,68,0.6)] animate-pulse"
                                      title="Failed"
                                    ></span>
                                  )}
                                  {status === 'building' && (
                                    <span
                                      className="w-3.5 h-3.5 rounded-full bg-amber-400 block shadow-[0_0_6px_rgba(245,158,11,0.6)] animate-pulse"
                                      title="Building"
                                    ></span>
                                  )}
                                  {status === 'idle' && (
                                    <span
                                      className="w-3.5 h-3.5 rounded-full bg-zinc-400 block"
                                      title="No builds executed"
                                    ></span>
                                  )}
                                </div>
                              </td>
                              
                              <td className="py-4 text-center">
                                <div className="flex justify-center" title={weather.desc}>
                                  {weather.icon}
                                </div>
                              </td>
                              
                              <td className="py-4 font-medium">
                                <div className="flex flex-col">
                                  <span className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                                    {p.name}
                                    <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-normal font-mono">
                                      {p.framework === 'REACT' && 'React'}
                                      {p.framework === 'LARAVEL' && 'Laravel'}
                                      {p.framework === 'NEXTJS' && 'Next.js'}
                                      {p.framework === 'LARAVEL_INERTIA' && 'Inertia'}
                                      {(!p.framework || p.framework === 'AUTO') && 'Auto'}
                                    </span>
                                  </span>
                                  <span className="text-xs font-mono text-muted-foreground mt-0.5">
                                    {p.repo_full_name} ({p.branch})
                                  </span>
                                  {p.domain && (
                                    <span className="text-[10px] text-muted-foreground font-mono mt-0.5 block truncate max-w-[200px]" title={`${p.domain}:${p.port || 'Auto'}`}>
                                      Target: {p.domain}{p.port ? `:${p.port}` : ''}
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-4 text-xs font-medium text-muted-foreground">
                                {successes[0] ? (
                                  <button
                                    onClick={() => setSelectedDeploymentId(successes[0].id)}
                                    className="text-blue-500 hover:underline inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    {lastSuccess}
                                  </button>
                                ) : (
                                  <span>N/A</span>
                                )}
                              </td>

                              <td className="py-4 text-xs font-medium text-muted-foreground">
                                {failures[0] ? (
                                  <button
                                    onClick={() => setSelectedDeploymentId(failures[0].id)}
                                    className="text-red-500 hover:underline inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    {lastFailure}
                                  </button>
                                ) : (
                                  <span>N/A</span>
                                )}
                              </td>

                              <td className="py-4 text-xs text-muted-foreground">{lastDuration}</td>

                              <td className="py-4 text-center">
                                <div className="flex justify-center">
                                  <button
                                    onClick={() => triggerManualDeploy(p.id)}
                                    className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md cursor-pointer border border-emerald-400 shadow-sm"
                                    title="Build Now"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab content: Build History */}
          {currentTab === 'build-history' && !selectedDeploymentId && (
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-border">
                <h3 className="font-semibold text-base flex items-center gap-2 text-foreground">
                  <History className="w-4 h-4 text-amber-500" /> Build History
                </h3>
                <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full font-medium">
                  {deployments.length} total builds
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="pb-3 pl-3">Build</th>
                      <th className="pb-3">Project</th>
                      <th className="pb-3">Commit</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Duration</th>
                      <th className="pb-3">Completed</th>
                      <th className="pb-3 text-right pr-3">Console</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {deployments.length === 0 ? (
                      <tr className="text-muted-foreground text-center">
                        <td colSpan={7} className="py-12 text-sm">
                          No build runs found.
                        </td>
                      </tr>
                    ) : (
                      deployments.map(d => {
                        const proj = projects.find(p => p.id === d.project_id);
                        return (
                          <tr
                            key={d.id}
                            onClick={() => setSelectedDeploymentId(d.id)}
                            className="cursor-pointer text-sm text-foreground hover:bg-muted/50"
                          >
                            <td className="py-3.5 pl-3 font-semibold text-blue-500">
                              #{d.id.substring(0, 8)}
                            </td>
                            <td className="py-3.5 font-medium text-foreground">{proj ? proj.name : 'Unknown'}</td>
                            <td className="py-3.5 text-xs font-mono max-w-[150px] truncate" title={d.commit_message}>
                              <span className="bg-muted border border-border px-1.5 py-0.5 rounded text-[11px]">
                                {d.commit_sha.substring(0, 7)}
                              </span>
                              <span className="ml-2 text-muted-foreground truncate">{d.commit_message}</span>
                            </td>
                            <td className="py-3.5">
                              <span className={`pill ${getStatusPillClass(d.status)}`}>{d.status}</span>
                            </td>
                            <td className="py-3.5 text-xs text-muted-foreground">
                              {formatDuration(d.duration_ms)}
                            </td>
                            <td className="py-3.5 text-xs text-muted-foreground">
                              {d.completed_at ? getRelativeTime(d.completed_at) : getRelativeTime(d.created_at)}
                            </td>
                            <td className="py-3.5 text-right pr-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDeploymentId(d.id);
                                }}
                                className="bg-secondary text-secondary-foreground hover:bg-secondary px-2.5 py-1 border border-border rounded-md text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Terminal className="w-3 h-3 text-blue-500" /> Console
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab content: System Status (Manage Jenkins) */}
          {currentTab === 'system-status' && !selectedDeploymentId && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">CPU Resource</span>
                    <Cpu className="w-5 h-5 text-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-2xl font-bold text-foreground">{(stats.cpuLoad * 100).toFixed(1)}%</div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div className="bg-blue-500 h-full rounded-full" style={{ width: `${stats.cpuLoad * 100}%` }}></div>
                    </div>
                    <p className="text-[10px] text-muted-foreground italic">Host machine processor capacity in use.</p>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Memory Allocation</span>
                    <HardDrive className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-2xl font-bold text-foreground">{stats.freeMem} / {stats.totalMem}</div>
                    <p className="text-xs text-muted-foreground">Free physical memory available.</p>
                    <p className="text-[10px] text-muted-foreground italic">Virtual & container memory are handled dynamically.</p>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Automation Engine</span>
                    <Activity className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between border-b border-border pb-1">
                      <span className="text-muted-foreground">Running Builds</span>
                      <span className="font-semibold text-foreground">{stats.queueActive}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Queued Builds</span>
                      <span className="font-semibold text-foreground">{stats.queueWaiting}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
                <h3 className="font-semibold text-base text-foreground pb-2 border-b border-border">
                  Manage Jenkins &rsaquo; System Configuration
                </h3>
                
                <div className="space-y-4 text-sm max-w-2xl">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground block">Webhook Endpoint URL</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.protocol}//${window.location.host}/api/webhooks/github`}
                        className="flex-1 bg-muted border border-input rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.protocol}//${window.location.host}/api/webhooks/github`);
                          alert('Webhook URL copied!');
                        }}
                        className="bg-secondary text-secondary-foreground border border-border hover:bg-secondary px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Copy URL
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Configure this URL in your GitHub repository webhooks settings (Content type: application/json).</p>
                  </div>

                  <div className="space-y-1 pt-2">
                    <label className="text-xs font-semibold text-muted-foreground block">Webhook Secret Signature</label>
                    <input
                      type="password"
                      readOnly
                      value="••••••••••••••••••••••••••••••••"
                      className="w-full bg-muted border border-input rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground focus:outline-none"
                    />
                    <p className="text-[11px] text-muted-foreground">Secret signature configuration used to verify GitHub payload signatures.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* Create Project Modal */}
      {isModalOpen && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-background/95">
          <div className="modal bg-card border border-border rounded-xl max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="modal-header flex justify-between items-center px-6 py-4 border-b border-border">
              <h3 className="font-semibold text-base text-foreground flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-muted-foreground" /> Create New Item
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="modal-close text-muted-foreground hover:text-foreground cursor-pointer text-xl">&times;</button>
            </div>
            
            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Item Name</label>
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

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Framework Selection</label>
                <select
                  value={newProject.framework}
                  onChange={(e) => setNewProject(prev => ({ ...prev, framework: e.target.value }))}
                  className="w-full bg-card text-foreground border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="AUTO">Auto Detect</option>
                  <option value="REACT">React SPA</option>
                  <option value="LARAVEL">Pure Laravel</option>
                  <option value="NEXTJS">Next.js</option>
                  <option value="LARAVEL_INERTIA">Laravel Inertia</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Domain / Host</label>
                  <input
                    type="text"
                    value={newProject.domain}
                    onChange={(e) => setNewProject(prev => ({ ...prev, domain: e.target.value }))}
                    placeholder="e.g. localhost"
                    className="w-full bg-transparent border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Custom Port</label>
                  <input
                    type="number"
                    value={newProject.port}
                    onChange={(e) => setNewProject(prev => ({ ...prev, port: e.target.value }))}
                    placeholder="e.g. 3000"
                    className="w-full bg-transparent border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
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
                  Create Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
