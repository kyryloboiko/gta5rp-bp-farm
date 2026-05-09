import { useState, useEffect, useMemo, useRef } from 'react';
import WebApp from '@twa-dev/sdk';
import { Check, Minus, Trophy, Star, Zap, Trash2, ListTodo, CheckCircle2, Flame, History, X, RefreshCw, ChevronDown, ChevronUp, Cloud } from 'lucide-react';
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
}

// --- Enhanced Cloud Storage Helper ---
const isCloudSupported = tgApp?.isVersionAtLeast?.('6.9');

const cloud = {
  set: (key: string, value: any) => new Promise((res) => {
    const val = JSON.stringify(value);
    if (isCloudSupported) {
      tgApp.CloudStorage.setItem(key, val, () => res(true));
    } else {
      localStorage.setItem(key, val);
      res(true);
    }
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
    if (isCloudSupported) {
      tgApp.CloudStorage.getKeys((_: any, k: string[]) => res(k || []));
    } else {
      res(Object.keys(localStorage));
    }
  }),
  remove: (keys: string[]) => new Promise((res) => {
    if (isCloudSupported) {
      tgApp.CloudStorage.removeItems(keys, () => res(true));
    } else {
      keys.forEach(k => localStorage.removeItem(k));
      res(true);
    }
  })
};

export const triggerHaptic = (type: 'click' | 'tick' | 'success') => {
  if (!tgApp?.HapticFeedback) return;
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
  
  // Real-time synchronization state
  const [lastLocalUpdate, setLastLocalUpdate] = useState<number>(0);
  
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [expandedHistoryDay, setExpandedHistoryDay] = useState<string | null>(null);
  const [recommendationSeed, setRecommendationSeed] = useState(0); 

  const timeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [pendingListRef] = useAutoAnimate<HTMLDivElement>({ duration: 300, easing: 'ease-out' });
  const [completedListRef] = useAutoAnimate<HTMLDivElement>({ duration: 300, easing: 'ease-out' });
  const [recListRef] = useAutoAnimate<HTMLDivElement>({ duration: 300, easing: 'ease-out' });
  const [historyListRef] = useAutoAnimate<HTMLDivElement>({ duration: 250, easing: 'ease-out' });

  const recommendedRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef<HTMLDivElement>(null);

  // --- Initial Data Load & Rolling Check ---
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

  // --- Real-time Polling Hook (every 5 seconds) ---
  useEffect(() => {
    if (isLoading) return;

    const interval = setInterval(async () => {
      // Check cloud timestamp to see if another device updated data
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
    const [p, l, d, v, x2, ts, allKeys] = await Promise.all([
      cloud.get('progress'), cloud.get('logs'), cloud.get('gameday'),
      cloud.get('vip'), cloud.get('x2'), cloud.get('last_update_ts'), cloud.getKeys()
    ]);

    setHasVip(!!v);
    setIsX2Server(!!x2);
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
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const oldKeys = allKeys.filter(k => k.startsWith('hist_') && new Date(k.replace('hist_', '')) < ninetyDaysAgo);
      if (oldKeys.length > 0) await cloud.remove(oldKeys);

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
      cloud.set('progress', p), 
      cloud.set('logs', l), 
      cloud.set('gameday', gameDay),
      cloud.set('last_update_ts', nowTs)
    ]);
  };

  const logAction = (taskId: number | null, type: 'add' | 'remove' | 'reset', bp: number) => {
    const newLog: TaskLog = {
      id: Math.random().toString(36).substring(2, 9),
      taskId, type, bp, timestamp: Date.now()
    };
    const nextLogs = [...todayLogs, newLog];
    setTodayLogs(nextLogs);
    return nextLogs;
  };

  const updateProgress = async (taskId: number, amount: number, maxAmount: number) => {
    const currentVal = taskProgress[taskId] || 0;
    const nextVal = Math.max(0, Math.min(maxAmount, currentVal + amount));
    if (currentVal === nextVal) return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const isNowCompleted = task.type === 'progress' ? nextVal >= task.max : nextVal > 0;
    const wasCompleted = task.type === 'progress' ? currentVal >= task.max : currentVal > 0;

    let reward = hasVip ? task.vipBP : task.baseBP;
    if (isX2Server) reward *= 2;

    let updatedLogs = todayLogs;
    if (isNowCompleted && !wasCompleted) {
      updatedLogs = logAction(taskId, 'add', reward);
      timeoutsRef.current[taskId] = setTimeout(() => setCompletedIds(prev => new Set(prev).add(taskId)), 400);
    } else if (!isNowCompleted && wasCompleted) {
      updatedLogs = logAction(taskId, 'remove', reward);
      if (timeoutsRef.current[taskId]) clearTimeout(timeoutsRef.current[taskId]);
      setCompletedIds(prev => { const next = new Set(prev); next.delete(taskId); return next; });
    } else if (task.type === 'repeatable') {
      const bpDelta = reward * Math.abs(amount);
      updatedLogs = logAction(taskId, amount > 0 ? 'add' : 'remove', bpDelta);
    }

    const nextProgress = { ...taskProgress, [taskId]: nextVal };
    setTaskProgress(nextProgress);
    await sync(nextProgress, updatedLogs);
  };

  const toggleTaskStatus = async (taskId: number) => {
    const isDone = (taskProgress[taskId] || 0) > 0;
    await updateProgress(taskId, isDone ? -1 : 1, 1);
  };

  const resetAllProgress = async () => {
    triggerHaptic('success');
    Object.values(timeoutsRef.current).forEach(clearTimeout);
    timeoutsRef.current = {};
    const updatedLogs = logAction(null, 'reset', 0);
    setTaskProgress({});
    setCompletedIds(new Set());
    await sync({}, updatedLogs);
    setIsResetModalOpen(false);
  };

  const { pendingTasks, completedTasks } = useMemo(() => {
    const pending: Task[] = [];
    const completed: Task[] = [];
    tasks.forEach(task => {
      if (completedIds.has(task.id)) completed.push(task);
      else pending.push(task);
    });
    return { pendingTasks: pending, completedTasks: completed };
  }, [completedIds]);

  const recommendedTasks = useMemo(() => {
    const activeCategories = new Set<string>();
    completedTasks.forEach(t => { if (t.category) activeCategories.add(t.category); });
    let pool = [...pendingTasks].sort(() => Math.random() - 0.5);
    const contextMatched = pool.filter(t => activeCategories.has(t.category));
    const unrelated = pool.filter(t => !activeCategories.has(t.category));
    return [...contextMatched, ...unrelated].slice(0, 3);
  }, [pendingTasks, completedTasks, recommendationSeed]);

  if (isLoading) return (
    <div className="min-h-screen bg-rpDark flex flex-col items-center justify-center text-orange-400 font-bold gap-4">
      <RefreshCw className="animate-spin" size={32} />
      <span>ЗАГРУЗКА...</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-rpDark pb-24 font-sans select-none">
      <div className="fixed top-0 left-0 right-0 z-40 bg-rpDark/85 backdrop-blur-xl border-b border-gray-800 p-4 shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-xl font-bold text-transparent bg-clip-text bg-rp-gradient flex items-center gap-2">
            <Trophy size={20} className="text-yellow-400" />
            BP Tracker <Cloud size={14} className={`${isSyncing ? 'text-blue-400 animate-bounce' : 'text-blue-400 opacity-50'}`} />
          </h1>
          <div className="flex items-center gap-3">
            <button onClick={() => { triggerHaptic('click'); setIsHistoryModalOpen(true); }} className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 border border-gray-700"><History size={18} /></button>
            <div className="text-right">
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Заработано</div>
              <div className="text-2xl leading-none font-black text-white">{calculateTotalBP()} <span className="text-orange-400 text-sm">BP</span></div>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={async () => { triggerHaptic('click'); const v = !hasVip; setHasVip(v); await cloud.set('vip', v); await cloud.set('last_update_ts', Date.now()); setLastLocalUpdate(Date.now()); }} className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-bold transition-all duration-300 ${hasVip ? 'bg-rp-gradient text-rpDark shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-gray-800 text-gray-400'}`}><Star size={14} className="inline mr-1" /> VIP</button>
          <button onClick={async () => { triggerHaptic('click'); const x = !isX2Server; setIsX2Server(x); await cloud.set('x2', x); await cloud.set('last_update_ts', Date.now()); setLastLocalUpdate(Date.now()); }} className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-bold transition-all duration-300 ${isX2Server ? 'bg-rp-gradient text-rpDark shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-gray-800 text-gray-400'}`}><Zap size={14} className="inline mr-1" /> Сервер x2</button>
        </div>
      </div>

      <div className="p-4 pt-36 space-y-8">
        {recommendedTasks.length > 0 && (
          <div ref={recommendedRef} className="scroll-mt-36">
            <div className="flex justify-between items-center mb-3 px-1">
              <h2 className="text-sm font-bold uppercase tracking-widest text-orange-400 flex items-center gap-2"><Flame size={16} /> Рекомендуем</h2>
              <button onClick={() => { triggerHaptic('click'); setRecommendationSeed(s => s + 1); }} className="text-gray-400 hover:text-white p-1.5 rounded-full bg-gray-800 transition-colors"><RefreshCw size={14} /></button>
            </div>
            <div ref={recListRef} className="space-y-2">
              {recommendedTasks.map(t => <TaskCard key={`rec-${t.id}`} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={toggleTaskStatus} hasVip={hasVip} isX2Server={isX2Server} />)}
            </div>
          </div>
        )}
        <div ref={pendingRef} className="scroll-mt-36">
          <h2 className="text-sm font-bold uppercase mb-3 text-white flex items-center gap-2 px-1"><ListTodo size={16} className="text-gray-400" /> Текущие ({pendingTasks.length})</h2>
          <div ref={pendingListRef} className="space-y-2">
            {pendingTasks.map(t => <TaskCard key={t.id} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={toggleTaskStatus} hasVip={hasVip} isX2Server={isX2Server} />)}
          </div>
        </div>
        {completedTasks.length > 0 && (
          <div ref={completedRef} className="scroll-mt-36">
            <h2 className="text-sm font-bold uppercase mb-3 text-green-500 flex items-center gap-2 px-1"><CheckCircle2 size={16} /> Выполнено ({completedTasks.length})</h2>
            <div ref={completedListRef} className="space-y-2 opacity-75">
              {completedTasks.map(t => <TaskCard key={t.id} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={toggleTaskStatus} hasVip={hasVip} isX2Server={isX2Server} />)}
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-rpPanel border-t border-gray-800 flex justify-around p-2 pb-safe z-50 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
        <button onClick={() => recommendedRef.current?.scrollIntoView({ behavior: 'smooth' })} className="flex flex-col items-center p-2 text-gray-400 active:text-orange-400"><Flame size={20} /><span className="text-[10px] mt-1">Топ</span></button>
        <button onClick={() => pendingRef.current?.scrollIntoView({ behavior: 'smooth' })} className="flex flex-col items-center p-2 text-gray-400 active:text-white"><ListTodo size={20} /><span className="text-[10px] mt-1">Задания</span></button>
        <button onClick={() => completedRef.current?.scrollIntoView({ behavior: 'smooth' })} className="flex flex-col items-center p-2 text-gray-400 active:text-green-500"><CheckCircle2 size={20} /><span className="text-[10px] mt-1">Готово</span></button>
        <div className="w-px h-8 bg-gray-700 self-center" />
        <button onClick={() => setIsResetModalOpen(true)} className="flex flex-col items-center p-2 text-gray-500 active:text-red-400"><Trash2 size={20} /><span className="text-[10px] mt-1">Сброс</span></button>
      </div>

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
                      {dayData.logs.slice().reverse().map((log) => (
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

function TaskCard({ task, globalProgress, onProgressUpdate, onToggleStatus, hasVip, isX2Server }: TaskCardProps) {
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
      if (newProgress !== localProgress) { setLocalProgress(newProgress); triggerHaptic('tick'); }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    dragStartX.current = null; e.currentTarget.releasePointerCapture(e.pointerId);
    if (isDragMove.current) {
      setIsDragging(false); const amountToAdd = localProgress - globalProgress;
      if (amountToAdd !== 0) {
        onProgressUpdate(task.id, amountToAdd, task.type === 'repeatable' ? 999 : task.max);
        if (localProgress >= task.max && globalProgress < task.max) triggerHaptic('success');
      }
    } else {
      triggerHaptic('click');
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
            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); triggerHaptic('click'); onProgressUpdate(task.id, -1, task.max); }} className="w-9 h-9 rounded-lg bg-black/40 text-gray-400 flex items-center justify-center border border-gray-700/50"><Minus size={18} /></button>
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