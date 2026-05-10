import { useState, useEffect, useMemo, useRef } from 'react';
import WebApp from '@twa-dev/sdk';
import { Check, Minus, Trophy, Star, Zap, Trash2, ListTodo, CheckCircle2, Flame, History, X, RefreshCw, ChevronDown, ChevronUp, Cloud, Search, ArrowUpDown, Settings, Bell, BellOff } from 'lucide-react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { tasks } from './data';
import type { Task } from './data';

const tgApp = (WebApp as any).default || WebApp;

// --- Interfaces ---
interface TaskLog {
  id: string;
  taskId: number | null;
  type: 'add' | 'remove' | 'reset';
  bp: number;
  timestamp: number;
}

interface DailyHistory {
  bp: number;
  completedCount: number;
  logs: TaskLog[];
}

interface TaskCardProps {
  task: Task;
  globalProgress: number;
  onProgressUpdate: (id: number, amount: number, max: number) => void;
  onToggleStatus: (id: number) => void;
  hasVip: boolean;
  isX2Server: boolean;
  hapticsEnabled: boolean;
}

// --- Cloud Storage Helper ---
const isCloudSupported = tgApp?.isVersionAtLeast?.('6.9');

const cloud = {
  set: (key: string, value: any) => new Promise((res) => {
    const val = JSON.stringify(value);
    if (isCloudSupported) tgApp.CloudStorage.setItem(key, val, () => res(true));
    else { localStorage.setItem(key, val); res(true); }
  }),
  get: (key: string) => new Promise<any>((res) => {
    if (isCloudSupported) {
      tgApp.CloudStorage.getItem(key, (_: any, v: string) => {
        try { res(v ? JSON.parse(v) : null); } catch { res(null); }
      });
    } else {
      const v = localStorage.getItem(key);
      try { res(v ? JSON.parse(v) : null); } catch { res(null); }
    }
  }),
  getKeys: () => new Promise<string[]>((res) => {
    if (isCloudSupported) tgApp.CloudStorage.getKeys((_: any, k: string[]) => res(k || []));
    else res(Object.keys(localStorage));
  }),
  remove: (keys: string[]) => new Promise((res) => {
    if (isCloudSupported) tgApp.CloudStorage.removeItems(keys, () => res(true));
    else { keys.forEach(k => localStorage.removeItem(k)); res(true); }
  })
};

export const triggerHaptic = (type: 'click' | 'tick' | 'success', enabled: boolean) => {
  if (!tgApp?.HapticFeedback || !enabled) return;
  try {
    if (type === 'click') tgApp.HapticFeedback.impactOccurred('light');
    if (type === 'tick') tgApp.HapticFeedback.selectionChanged();
    if (type === 'success') tgApp.HapticFeedback.notificationOccurred('success');
  } catch (e) {
    console.warn('Haptic API not available');
  }
};

const getCurrentGameDay = (): string => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const mskTime = new Date(utc + (3 * 3600000));
  mskTime.setHours(mskTime.getHours() - 7); 
  return mskTime.toISOString().split('T')[0];
};

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [gameDay, setGameDay] = useState<string>(getCurrentGameDay());
  const [taskProgress, setTaskProgress] = useState<Record<number, number>>({});
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [todayLogs, setTodayLogs] = useState<TaskLog[]>([]);
  const [history, setHistory] = useState<Record<string, DailyHistory>>({});
  const [hasVip, setHasVip] = useState(false);
  const [isX2Server, setIsX2Server] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  
  const [lastLocalUpdate, setLastLocalUpdate] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'high' | 'low'>('default');
  
  const [activeTab, setActiveTab] = useState<'tasks' | 'settings'>('tasks');
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [expandedHistoryDay, setExpandedHistoryDay] = useState<string | null>(null);
  const [recommendationSeed, setRecommendationSeed] = useState(0); 

  const [parent] = useAutoAnimate();
  const [historyListRef] = useAutoAnimate<HTMLDivElement>();
  const timeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const recommendedRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      if (tgApp && typeof tgApp.ready === 'function') {
        tgApp.ready();
        tgApp.expand();
      }
      await refreshDataFromCloud();
      setIsLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const interval = setInterval(async () => {
      const cloudTS = await cloud.get('last_update_ts') || 0;
      if (cloudTS > lastLocalUpdate) {
        setIsSyncing(true);
        await refreshDataFromCloud();
        setIsSyncing(false);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isLoading, lastLocalUpdate]);

  const refreshDataFromCloud = async () => {
    const currentDay = getCurrentGameDay();
    const [p, l, d, v, x2, hapt, ts, allKeys] = await Promise.all([
      cloud.get('progress'), cloud.get('logs'), cloud.get('gameday'),
      cloud.get('vip'), cloud.get('x2'), cloud.get('haptics'), 
      cloud.get('last_update_ts'), cloud.getKeys()
    ]);

    setHasVip(!!v);
    setIsX2Server(!!x2);
    setHapticsEnabled(hapt !== null ? !!hapt : true);
    if (ts) setLastLocalUpdate(ts);

    if (d && d !== currentDay) {
      const prevProgress: Record<number, number> = p || {};
      const prevLogs: TaskLog[] = l || [];
      let finalBP = 0;
      let cCount = 0;
      
      tasks.forEach(t => {
        const val = prevProgress[t.id] || 0;
        const isDone = t.type === 'progress' ? val >= t.max : val > 0;
        if (isDone) {
          cCount++;
          let reward = !!v ? t.vipBP : t.baseBP;
          if (!!x2) reward *= 2;
          finalBP += (t.type === 'repeatable' ? reward * val : reward);
        }
      });

      await cloud.set(`hist_${d}`, { bp: finalBP, completedCount: cCount, logs: prevLogs });
      setTaskProgress({}); setTodayLogs([]); setCompletedIds(new Set());
      const nowTs = Date.now();
      setLastLocalUpdate(nowTs);
      await Promise.all([cloud.set('progress', {}), cloud.set('logs', []), cloud.set('gameday', currentDay), cloud.set('last_update_ts', nowTs)]);
    } else {
      const loadedProgress: Record<number, number> = p || {};
      setTaskProgress(loadedProgress);
      setTodayLogs(l || []);
      const ids = new Set<number>();
      tasks.forEach(t => {
        const val = loadedProgress[t.id] || 0;
        if (t.type === 'progress' ? val >= t.max : val > 0) ids.add(t.id);
      });
      setCompletedIds(ids);
    }

    const hist: Record<string, DailyHistory> = {};
    const histKeys = allKeys.filter(k => k.startsWith('hist_')).sort().reverse();
    for (const k of histKeys) {
      const data = await cloud.get(k);
      if (data) hist[k.replace('hist_', '')] = data as DailyHistory;
    }
    setHistory(hist);
    setGameDay(currentDay);
  };

  const calculateTotalBP = () => {
    let total = 0;
    tasks.forEach(task => {
      const val = taskProgress[task.id] || 0;
      const isFinished = task.type === 'progress' ? val >= task.max : val > 0;
      if (isFinished) {
        let reward = hasVip ? task.vipBP : task.baseBP;
        if (isX2Server) reward *= 2;
        total += (task.type === 'repeatable' ? reward * val : reward);
      }
    });
    return total;
  };

  const sync = async (p: any, l: any) => {
    const nowTs = Date.now();
    setLastLocalUpdate(nowTs);
    await Promise.all([
      cloud.set('progress', p), cloud.set('logs', l), 
      cloud.set('gameday', gameDay), cloud.set('last_update_ts', nowTs)
    ]);
  };

  const updateProgress = async (taskId: number, amount: number, maxAmount: number) => {
    const currentVal = taskProgress[taskId] || 0;
    const nextVal = Math.max(0, Math.min(maxAmount, currentVal + amount));
    if (currentVal === nextVal) return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    let reward = hasVip ? task.vipBP : task.baseBP;
    if (isX2Server) reward *= 2;

    const newLog: TaskLog = {
      id: Math.random().toString(36).substring(2, 9),
      taskId, type: amount > 0 ? 'add' : 'remove', bp: task.type === 'repeatable' ? reward * Math.abs(amount) : reward, timestamp: Date.now()
    };

    const isNowCompleted = task.type === 'progress' ? nextVal >= task.max : nextVal > 0;
    const wasCompleted = task.type === 'progress' ? currentVal >= task.max : currentVal > 0;

    if (isNowCompleted && !wasCompleted) {
      timeoutsRef.current[taskId] = setTimeout(() => setCompletedIds(prev => new Set(prev).add(taskId)), 400);
    } else if (!isNowCompleted && wasCompleted) {
      if (timeoutsRef.current[taskId]) clearTimeout(timeoutsRef.current[taskId]);
      setCompletedIds(prev => { const next = new Set(prev); next.delete(taskId); return next; });
    }

    const nextLogs = [...todayLogs, newLog];
    const nextProgress = { ...taskProgress, [taskId]: nextVal };
    setTodayLogs(nextLogs);
    setTaskProgress(nextProgress);
    await sync(nextProgress, nextLogs);
  };

  const toggleTaskStatus = async (taskId: number) => {
    const isDone = (taskProgress[taskId] || 0) > 0;
    await updateProgress(taskId, isDone ? -1 : 1, 1);
  };

  const resetAllProgress = async () => {
    triggerHaptic('success', hapticsEnabled);
    const resetLog: TaskLog = { id: 'reset-' + Date.now(), taskId: null, type: 'reset', bp: 0, timestamp: Date.now() };
    const nextLogs = [...todayLogs, resetLog];
    setTaskProgress({});
    setCompletedIds(new Set());
    setTodayLogs(nextLogs);
    await sync({}, nextLogs);
    setIsResetModalOpen(false);
  };

  const processTasks = (taskList: Task[]) => {
    let filtered = taskList.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()));
    if (sortBy === 'high') filtered.sort((a, b) => (hasVip ? b.vipBP : b.baseBP) - (hasVip ? a.vipBP : a.baseBP));
    else if (sortBy === 'low') filtered.sort((a, b) => (hasVip ? a.vipBP : a.baseBP) - (hasVip ? b.vipBP : b.baseBP));
    return filtered;
  };

  const { pendingTasks, completedTasks } = useMemo(() => {
    const pending: Task[] = [];
    const completed: Task[] = [];
    tasks.forEach(task => {
      if (completedIds.has(task.id)) completed.push(task);
      else pending.push(task);
    });
    return { pendingTasks: processTasks(pending), completedTasks: processTasks(completed) };
  }, [completedIds, searchQuery, sortBy, hasVip]);

  const recommendedTasks = useMemo(() => {
    const activeCategories = new Set<string>();
    completedTasks.forEach(t => { if (t.category) activeCategories.add(t.category); });
    let pool = [...pendingTasks].sort(() => Math.random() - 0.5);
    return [...pool.filter(t => activeCategories.has(t.category)), ...pool.filter(t => !activeCategories.has(t.category))].slice(0, 3);
  }, [pendingTasks, completedTasks, recommendationSeed]);

  if (isLoading) return (
    <div className="min-h-screen bg-rpDark flex flex-col items-center justify-center text-orange-400 font-bold gap-4">
      <RefreshCw className="animate-spin" size={32} />
      <span>ЗАГРУЗКА...</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-rpDark pb-24 font-sans select-none overflow-x-hidden">
      <div className="fixed top-0 left-0 right-0 z-40 bg-rpDark/85 backdrop-blur-xl border-b border-gray-800 p-4 shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-xl font-bold text-transparent bg-clip-text bg-rp-gradient flex items-center gap-2">
            <Trophy size={20} className="text-yellow-400" />
            BP Tracker <Cloud size={14} className={`${isSyncing ? 'text-blue-400 animate-bounce' : 'text-blue-400 opacity-50'}`} />
          </h1>
          <div className="flex items-center gap-3">
            <button onClick={() => { triggerHaptic('click', hapticsEnabled); setIsHistoryModalOpen(true); }} className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 border border-gray-700 active:scale-90 transition-transform"><History size={18} /></button>
            <div className="text-right">
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Заработано</div>
              <div className="text-2xl leading-none font-black text-white">{calculateTotalBP()} <span className="text-orange-400 text-sm">BP</span></div>
            </div>
          </div>
        </div>

        {activeTab === 'tasks' && (
          <div className="animate-in fade-in duration-300">
            <div className="flex gap-2 mb-3">
              <button onClick={async () => { triggerHaptic('click', hapticsEnabled); const v = !hasVip; setHasVip(v); await cloud.set('vip', v); setLastLocalUpdate(Date.now()); }} className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-bold transition-all duration-300 ${hasVip ? 'bg-rp-gradient text-rpDark shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-gray-800 text-gray-400'}`}><Star size={14} className="inline mr-1" /> VIP</button>
              <button onClick={async () => { triggerHaptic('click', hapticsEnabled); const x = !isX2Server; setIsX2Server(x); await cloud.set('x2', x); setLastLocalUpdate(Date.now()); }} className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-bold transition-all duration-300 ${isX2Server ? 'bg-rp-gradient text-rpDark shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-gray-800 text-gray-400'}`}><Zap size={14} className="inline mr-1" /> Сервер x2</button>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input type="text" placeholder="Поиск..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-orange-500/50" />
              </div>
              <button onClick={() => { triggerHaptic('click', hapticsEnabled); setSortBy(prev => prev === 'default' ? 'high' : prev === 'high' ? 'low' : 'default'); }} className={`px-3 rounded-lg border flex items-center gap-2 text-xs font-bold transition-all ${sortBy !== 'default' ? 'bg-orange-500/10 border-orange-500/50 text-orange-400' : 'bg-gray-900 border-gray-800 text-gray-400'}`}><ArrowUpDown size={14} /></button>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="py-2 animate-in slide-in-from-right-4 duration-300">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Настройки</h2>
          </div>
        )}
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="p-4 pt-[180px]" ref={parent}>
        {activeTab === 'tasks' ? (
          <div className="space-y-8">
            {recommendedTasks.length > 0 && !searchQuery && (
              <div ref={recommendedRef} className="scroll-mt-48">
                <div className="flex justify-between items-center mb-3 px-1">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-orange-400 flex items-center gap-2"><Flame size={16} /> Рекомендуем</h2>
                  <button onClick={() => { triggerHaptic('click', hapticsEnabled); setRecommendationSeed(s => s + 1); }} className="text-gray-400 p-1.5 rounded-full bg-gray-800 active:scale-90 transition-transform"><RefreshCw size={14} /></button>
                </div>
                <div className="space-y-2">
                  {recommendedTasks.map(t => <TaskCard key={`rec-${t.id}`} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={toggleTaskStatus} hasVip={hasVip} isX2Server={isX2Server} hapticsEnabled={hapticsEnabled} />)}
                </div>
              </div>
            )}
            <div ref={pendingRef} className="scroll-mt-48">
              <h2 className="text-sm font-bold uppercase mb-3 text-white flex items-center gap-2 px-1"><ListTodo size={16} className="text-gray-400" /> {searchQuery ? 'Результаты' : 'Задания'} ({pendingTasks.length})</h2>
              <div className="space-y-2">
                {pendingTasks.map(t => <TaskCard key={t.id} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={toggleTaskStatus} hasVip={hasVip} isX2Server={isX2Server} hapticsEnabled={hapticsEnabled} />)}
              </div>
            </div>
            {completedTasks.length > 0 && (
              <div ref={completedRef} className="scroll-mt-48">
                <h2 className="text-sm font-bold uppercase mb-3 text-green-500 flex items-center gap-2 px-1"><CheckCircle2 size={16} /> Выполнено ({completedTasks.length})</h2>
                <div className="space-y-2 opacity-75 transition-opacity hover:opacity-100">
                  {completedTasks.map(t => <TaskCard key={t.id} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={toggleTaskStatus} hasVip={hasVip} isX2Server={isX2Server} hapticsEnabled={hapticsEnabled} />)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-rpPanel rounded-2xl p-4 border border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${hapticsEnabled ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-800 text-gray-500'}`}>
                  {hapticsEnabled ? <Bell size={20} /> : <BellOff size={20} />}
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Вибрация</h3>
                  <p className="text-xs text-gray-500">Тактильный отклик при кликах</p>
                </div>
              </div>
              <button 
                onClick={async () => {
                  const newState = !hapticsEnabled;
                  setHapticsEnabled(newState);
                  if (newState) triggerHaptic('click', true);
                  await cloud.set('haptics', newState);
                }}
                className={`w-12 h-6 rounded-full transition-colors relative ${hapticsEnabled ? 'bg-orange-500' : 'bg-gray-700'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${hapticsEnabled ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            <div className="bg-rpPanel rounded-2xl p-4 border border-gray-800">
              <h3 className="font-bold text-white text-sm mb-1">Опасная зона</h3>
              <p className="text-xs text-gray-500 mb-4">Сброс обнулит текущий прогресс без сохранения в историю.</p>
              <button 
                onClick={() => { triggerHaptic('click', hapticsEnabled); setIsResetModalOpen(true); }}
                className="w-full py-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:bg-red-500 active:text-white transition-all"
              >
                <Trash2 size={16} /> Сбросить прогресс дня
              </button>
            </div>

            <div className="text-center space-y-1 pt-4">
              <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">GTA5RP BP Tracker v2.2</p>
              <p className="text-[10px] text-gray-700 flex items-center justify-center gap-1">
                <Cloud size={10} /> {isCloudSupported ? 'Cloud Storage Active' : 'Local Backup Active'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER NAV */}
      <div className="fixed bottom-0 left-0 right-0 bg-rpPanel border-t border-gray-800 flex justify-around p-2 pb-safe z-50 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
        <button onClick={() => { triggerHaptic('click', hapticsEnabled); setActiveTab('tasks'); }} className={`flex-1 flex flex-col items-center p-2 transition-colors ${activeTab === 'tasks' ? 'text-orange-400' : 'text-gray-500'}`}>
          <ListTodo size={22} />
          <span className="text-[10px] mt-1 font-bold">Задания</span>
        </button>
        <button onClick={() => { triggerHaptic('click', hapticsEnabled); setActiveTab('settings'); }} className={`flex-1 flex flex-col items-center p-2 transition-colors ${activeTab === 'settings' ? 'text-orange-400' : 'text-gray-500'}`}>
          <Settings size={22} />
          <span className="text-[10px] mt-1 font-bold">Настройки</span>
        </button>
      </div>

      {/* MODALS */}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 z-[100] bg-rpDark flex flex-col overflow-hidden animate-in slide-in-from-bottom-full duration-300">
          <div className="p-4 bg-rpPanel border-b border-gray-800 flex justify-between items-center shrink-0 pt-safe">
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><History size={20} className="text-orange-400"/> История BP</h2>
            <button onClick={() => setIsHistoryModalOpen(false)} className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-white"><X size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 pb-32" ref={historyListRef}>
            {Object.keys({ [gameDay]: { logs: todayLogs, bp: calculateTotalBP() }, ...history }).map((dateStr, idx) => {
              const isToday = dateStr === gameDay;
              const dayData = isToday ? { bp: calculateTotalBP(), logs: todayLogs, completedCount: completedTasks.length } : history[dateStr];
              const hasActivity = dayData && dayData.logs.length > 0;
              const isExpanded = expandedHistoryDay === dateStr;
              return (
                <div key={dateStr} className={`mb-3 rounded-xl border transition-all ${isToday ? 'bg-rpPanel border-gray-700' : hasActivity ? 'bg-orange-500/10 border-orange-500/50' : 'bg-gray-900 border-gray-800 opacity-60'}`}>
                  <div onClick={() => hasActivity && setExpandedHistoryDay(isExpanded ? null : dateStr)} className={`p-4 flex items-center justify-between ${hasActivity ? 'cursor-pointer' : ''}`}>
                    <div><h3 className="font-bold text-white">{idx === 0 ? 'Сегодня' : idx === 1 ? 'Вчера' : dateStr}</h3><p className="text-xs text-gray-400 mt-1">{hasActivity ? `Событий: ${dayData.logs.length}` : 'Нет активности'}</p></div>
                    {hasActivity && <div className="flex items-center gap-4"><span className="text-xl font-black text-orange-400">{dayData.bp} BP</span>{isExpanded ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}</div>}
                  </div>
                  {isExpanded && hasActivity && (
                    <div className="bg-black/30 p-3 border-t border-gray-800/50 space-y-2">
                      {dayData.logs.slice().reverse().map((log: any) => (
                        <div key={log.id} className={`flex justify-between text-xs ${log.type === 'reset' ? 'bg-red-500/10 p-1 rounded text-red-400 text-center block w-full' : log.type === 'add' ? 'text-gray-200' : 'text-gray-500 line-through'}`}>
                          {log.type === 'reset' ? 'СБРОС ПРОГРЕССА' : (
                            <><span>{tasks.find(t => t.id === log.taskId)?.title}</span><span className={log.type === 'add' ? 'text-green-400' : 'text-red-400'}>{log.type === 'add' ? '+' : '-'}{log.bp} BP</span></>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isResetModalOpen && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-rpPanel border border-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-xl font-bold text-white mb-2">Сбросить всё?</h3>
            <p className="text-xs text-gray-400 mb-6">Это действие обнулит текущий день. Оно будет записано в историю як сброс.</p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setIsResetModalOpen(false)} className="flex-1 py-3 rounded-xl bg-gray-800 text-white font-bold">Отмена</button>
              <button onClick={resetAllProgress} className="flex-1 py-3 rounded-xl bg-red-500/20 text-red-500 border border-red-500/50 font-bold">Да, сбросить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, globalProgress, onProgressUpdate, onToggleStatus, hasVip, isX2Server, hapticsEnabled }: TaskCardProps) {
  const [localProgress, setLocalProgress] = useState(globalProgress);
  const [isDragging, setIsDragging] = useState(false);
  const displayProgress = isDragging ? localProgress : globalProgress;
  const isFinishedGlobal = task.type === 'progress' ? globalProgress >= task.max : globalProgress > 0;

  useEffect(() => { if (!isDragging) setLocalProgress(globalProgress); }, [globalProgress, isDragging]);

  let dynamicReward = hasVip ? task.vipBP : task.baseBP;
  if (isX2Server) dynamicReward *= 2;
  const progressPercent = task.type === 'progress' ? Math.min(100, (displayProgress / task.max) * 100) : (isFinishedGlobal ? 100 : 0);

  const dragStartX = useRef<number | null>(null);
  const startProgress = useRef<number>(0);
  const isDragMove = useRef<boolean>(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartX.current = e.clientX; startProgress.current = displayProgress;
    isDragMove.current = false; e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null || task.type === 'boolean') return;
    const deltaX = e.clientX - dragStartX.current;
    if (!isDragMove.current && Math.abs(deltaX) > 10) { isDragMove.current = true; setIsDragging(true); }
    if (isDragMove.current) {
      const cardWidth = e.currentTarget.getBoundingClientRect().width;
      const progressDelta = Math.floor((deltaX / cardWidth) * (task.type === 'repeatable' ? 10 : task.max));
      let newProgress = Math.max(0, Math.min(task.type === 'repeatable' ? 999 : task.max, startProgress.current + progressDelta));
      if (newProgress !== localProgress) { setLocalProgress(newProgress); triggerHaptic('tick', hapticsEnabled); }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    dragStartX.current = null; e.currentTarget.releasePointerCapture(e.pointerId);
    if (isDragMove.current) {
      setIsDragging(false); const amountToAdd = localProgress - globalProgress;
      if (amountToAdd !== 0) {
        onProgressUpdate(task.id, amountToAdd, task.type === 'repeatable' ? 999 : task.max);
        if (localProgress >= task.max && globalProgress < task.max) triggerHaptic('success', hapticsEnabled);
      }
    } else {
      triggerHaptic('click', hapticsEnabled);
      if (task.type === 'boolean') onToggleStatus(task.id);
      else onProgressUpdate(task.id, 1, task.type === 'repeatable' ? 999 : task.max);
    }
  };

  return (
    <div onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} className={`relative overflow-hidden bg-rpPanel rounded-xl border cursor-pointer touch-pan-y transition-all duration-300 active:scale-[0.98] ${isFinishedGlobal && task.type !== 'repeatable' ? 'border-orange-500/50 bg-orange-500/10 shadow-[0_0_15px_rgba(249,115,22,0.1)]' : 'border-gray-800'}`}>
      {(task.type === 'progress' || task.type === 'repeatable') && displayProgress > 0 && (
        <div className="absolute left-0 top-0 bottom-0 bg-rp-gradient opacity-20 transition-all duration-100" style={{ width: `${progressPercent}%` }} />
      )}
      <div className="relative z-10 p-3 flex justify-between items-center min-h-[72px] pointer-events-none">
        <div className="flex-1 pr-3">
          <h3 className={`font-semibold text-sm leading-tight mb-1 transition-colors ${isFinishedGlobal && task.type !== 'repeatable' ? 'text-orange-400' : 'text-gray-200'}`}>{task.title}</h3>
          <span className="text-xs text-gray-500 font-medium">+{dynamicReward} BP {task.type === 'repeatable' && '(за раз)'}</span>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          {(task.type === 'progress' || task.type === 'repeatable') && globalProgress > 0 && (
            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); triggerHaptic('click', hapticsEnabled); onProgressUpdate(task.id, -1, task.max); }} className="w-9 h-9 rounded-lg bg-black/40 text-gray-400 flex items-center justify-center border border-gray-700/50"><Minus size={18} /></button>
          )}
          <div className="min-w-[44px] flex justify-end items-center">
            {task.type === 'boolean' ? (
              <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${isFinishedGlobal ? 'bg-rp-gradient text-rpDark shadow-[0_0_10px_rgba(249,115,22,0.4)]' : 'bg-gray-800 border border-gray-700'}`}>{isFinishedGlobal && <Check size={16} strokeWidth={3} />}</div>
            ) : (
              <div className="flex flex-col items-end"><span className={`text-xl font-black font-mono tracking-tighter ${isFinishedGlobal && task.type !== 'repeatable' ? 'text-orange-400' : 'text-white'}`}>{displayProgress}</span>{task.type === 'progress' && <span className="text-[10px] text-gray-500 font-mono font-bold mt-1">/ {task.max}</span>}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;