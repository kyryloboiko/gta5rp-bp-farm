import { useState, useEffect, useMemo, useRef } from 'react';
import WebApp from '@twa-dev/sdk';
import { Check, Minus, Trophy, Star, Zap, Trash2, ListTodo, CheckCircle2, Flame, History, X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { tasks } from './data';
import type { Task } from './data';

const tgApp = (WebApp as any).default || WebApp;

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

const STORAGE_KEYS = {
  PROGRESS: 'gta5rp_bp_progress',
  VIP: 'gta5rp_bp_vip',
  X2: 'gta5rp_bp_x2',
  HISTORY: 'gta5rp_bp_history',
  LOGS: 'gta5rp_bp_logs',
  GAMEDAY: 'gta5rp_bp_gameday'
};

// --- Interfaces for History & Logging ---
interface TaskLog {
  id: string; // Unique ID for React mapping
  taskId: number | null; // null represents a manual Reset
  type: 'add' | 'remove' | 'reset';
  bp: number; // The amount of BP gained or lost
  timestamp: number;
}

interface DailyHistory {
  bp: number;
  completedCount: number;
  logs: TaskLog[];
}

// --- Time Helper ---
const getCurrentGameDay = (): string => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const mskTime = new Date(utc + (3 * 3600000));
  mskTime.setHours(mskTime.getHours() - 7); 
  return mskTime.toISOString().split('T')[0];
};

function App() {
  const [gameDay, setGameDay] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.GAMEDAY) || getCurrentGameDay());
  
  const [taskProgress, setTaskProgress] = useState<Record<number, number>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROGRESS) || '{}'); } catch { return {}; }
  });
  
  const [completedIds, setCompletedIds] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PROGRESS);
      if (saved) {
        const parsed = JSON.parse(saved);
        const ids = new Set<number>();
        tasks.forEach(t => {
          const val = parsed[t.id] || 0;
          if (t.type === 'progress' ? val >= t.max : val > 0) ids.add(t.id);
        });
        return ids;
      }
    } catch {}
    return new Set();
  });

  const [todayLogs, setTodayLogs] = useState<TaskLog[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGS) || '[]'); } catch { return []; }
  });

  const [history, setHistory] = useState<Record<string, DailyHistory>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '{}'); } catch { return {}; }
  });
  
  const [hasVip, setHasVip] = useState<boolean>(() => localStorage.getItem(STORAGE_KEYS.VIP) === 'true');
  const [isX2Server, setIsX2Server] = useState<boolean>(() => localStorage.getItem(STORAGE_KEYS.X2) === 'true');
  
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

  // --- Auto-Reset at 7:00 MSK ---
  useEffect(() => {
    if (tgApp && typeof tgApp.ready === 'function') {
      tgApp.ready();
      tgApp.expand();
    }

    const currentRealGameDay = getCurrentGameDay();
    if (gameDay !== currentRealGameDay) {
      let finalBP = 0;
      tasks.forEach(task => {
        const isFinished = task.type === 'progress' ? (taskProgress[task.id] || 0) >= task.max : (taskProgress[task.id] || 0) > 0;
        if (isFinished) {
          let reward = hasVip ? task.vipBP : task.baseBP;
          if (isX2Server) reward *= 2;
          if (task.type === 'repeatable') reward *= (taskProgress[task.id] || 0);
          finalBP += reward;
        }
      });

      setHistory(prev => ({
        ...prev,
        [gameDay]: { bp: finalBP, completedCount: completedIds.size, logs: todayLogs }
      }));

      setTaskProgress({});
      setCompletedIds(new Set());
      setTodayLogs([]);
      setGameDay(currentRealGameDay);
      triggerHaptic('success');
    }
  }, [gameDay, taskProgress, todayLogs, completedIds.size, hasVip, isX2Server]);

  // --- Persistence Hooks ---
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(taskProgress)); }, [taskProgress]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(todayLogs)); }, [todayLogs]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history)); }, [history]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.GAMEDAY, gameDay); }, [gameDay]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.VIP, String(hasVip)); }, [hasVip]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.X2, String(isX2Server)); }, [isX2Server]);

  // --- Core Functions ---
  const logAction = (taskId: number | null, type: 'add' | 'remove' | 'reset', bp: number) => {
    setTodayLogs(prev => [...prev, {
      id: Math.random().toString(36).substring(2, 9),
      taskId,
      type,
      bp,
      timestamp: Date.now()
    }]);
  };

  const updateProgress = (taskId: number, amount: number, maxAmount: number) => {
    const currentVal = taskProgress[taskId] || 0;
    const nextVal = Math.max(0, Math.min(maxAmount, currentVal + amount));
    if (currentVal === nextVal) return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const isNowCompleted = task.type === 'progress' ? nextVal >= task.max : nextVal > 0;
    const wasCompleted = task.type === 'progress' ? currentVal >= task.max : currentVal > 0;

    let reward = hasVip ? task.vipBP : task.baseBP;
    if (isX2Server) reward *= 2;

    // Handle Logic & Logging OUTSIDE of setTaskProgress to avoid Strict Mode duplication
    if (isNowCompleted && !wasCompleted) {
      logAction(taskId, 'add', reward);
      timeoutsRef.current[taskId] = setTimeout(() => setCompletedIds(prev => new Set(prev).add(taskId)), 400);
    } else if (!isNowCompleted && wasCompleted) {
      logAction(taskId, 'remove', reward);
      if (timeoutsRef.current[taskId]) clearTimeout(timeoutsRef.current[taskId]);
      setCompletedIds(prev => { const next = new Set(prev); next.delete(taskId); return next; });
    } else if (task.type === 'repeatable') {
      const bpDelta = reward * Math.abs(amount);
      if (amount > 0) logAction(taskId, 'add', bpDelta);
      if (amount < 0) logAction(taskId, 'remove', bpDelta);
    }

    setTaskProgress(prev => ({ ...prev, [taskId]: nextVal }));
  };

  const toggleTaskStatus = (taskId: number) => {
    const currentVal = taskProgress[taskId] || 0;
    const nextVal = currentVal ? 0 : 1;
    
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    let reward = hasVip ? task.vipBP : task.baseBP;
    if (isX2Server) reward *= 2;

    if (nextVal > 0) {
      logAction(taskId, 'add', reward);
      timeoutsRef.current[taskId] = setTimeout(() => setCompletedIds(prev => new Set(prev).add(taskId)), 400);
    } else {
      logAction(taskId, 'remove', reward);
      if (timeoutsRef.current[taskId]) clearTimeout(timeoutsRef.current[taskId]);
      setCompletedIds(prev => { const next = new Set(prev); next.delete(taskId); return next; });
    }

    setTaskProgress(prev => ({ ...prev, [taskId]: nextVal }));
  };

  const resetAllProgress = () => {
    triggerHaptic('success');
    Object.values(timeoutsRef.current).forEach(clearTimeout);
    timeoutsRef.current = {};
    
    logAction(null, 'reset', 0);
    
    setTaskProgress({});
    setCompletedIds(new Set());
    setIsResetModalOpen(false);
  };

  const calculateTotalBP = () => {
    let totalBP = 0;
    tasks.forEach(task => {
      const isFinished = task.type === 'progress' ? (taskProgress[task.id] || 0) >= task.max : (taskProgress[task.id] || 0) > 0;
      if (isFinished) {
        let reward = hasVip ? task.vipBP : task.baseBP;
        if (isX2Server) reward *= 2;
        if (task.type === 'repeatable') reward *= (taskProgress[task.id] || 0);
        totalBP += reward;
      }
    });
    return totalBP;
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

  const scrollToSection = (ref: React.RefObject<HTMLDivElement | null>) => {
    triggerHaptic('click');
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const last7Days = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
      const mskTime = new Date(utc + (3 * 3600000));
      mskTime.setHours(mskTime.getHours() - 7);
      days.push(mskTime.toISOString().split('T')[0]);
    }
    return days;
  }, [gameDay, isHistoryModalOpen]);

  const formatDateString = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };

  return (
    <div className="min-h-screen bg-rpDark pb-24 font-sans select-none">
      {/* FIXED HEADER */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-rpDark/85 backdrop-blur-xl border-b border-gray-800 p-4 shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-xl font-bold text-transparent bg-clip-text bg-rp-gradient flex items-center gap-2">
            <Trophy size={20} className="text-yellow-400" />
            BP Tracker
          </h1>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { triggerHaptic('click'); setIsHistoryModalOpen(true); }}
              className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 hover:text-white transition-colors border border-gray-700"
            >
              <History size={18} />
            </button>
            <div className="text-right">
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Заработано</div>
              <div className="text-2xl leading-none font-black text-white transition-all">
                {calculateTotalBP()} <span className="text-orange-400 text-sm">BP</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => { setHasVip(!hasVip); triggerHaptic('click'); }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-bold transition-all duration-300 ${hasVip ? 'bg-rp-gradient text-rpDark shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-gray-800 text-gray-400'}`}
          >
            <Star size={14} className="inline mr-1" /> VIP
          </button>
          <button 
            onClick={() => { setIsX2Server(!isX2Server); triggerHaptic('click'); }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-bold transition-all duration-300 ${isX2Server ? 'bg-rp-gradient text-rpDark shadow-[0_0_10px_rgba(249,115,22,0.3)]' : 'bg-gray-800 text-gray-400'}`}
          >
            <Zap size={14} className="inline mr-1" /> Сервер x2
          </button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="p-4 pt-36 space-y-8">
        
        {/* Recommendations Section */}
        {recommendedTasks.length > 0 && (
          <div ref={recommendedRef} className="scroll-mt-36">
            <div className="flex justify-between items-center mb-3 px-1">
              <h2 className="text-sm font-bold uppercase tracking-widest text-orange-400 flex items-center gap-2">
                <Flame size={16} /> Рекомендуем
              </h2>
              <button 
                onClick={() => { triggerHaptic('click'); setRecommendationSeed(prev => prev + 1); }}
                className="text-gray-400 hover:text-white p-1.5 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div ref={recListRef} className="space-y-2">
              {recommendedTasks.map(task => (
                <TaskCard 
                  key={`rec-${task.id}`} 
                  task={task} 
                  globalProgress={taskProgress[task.id] || 0} 
                  onProgressUpdate={updateProgress} 
                  onToggleStatus={toggleTaskStatus}
                  hasVip={hasVip}
                  isX2Server={isX2Server}
                />
              ))}
            </div>
          </div>
        )}

        {/* Pending Tasks Section */}
        <div ref={pendingRef} className="scroll-mt-36">
          <h2 className="text-sm font-bold uppercase tracking-widest mb-3 text-white flex items-center gap-2 px-1">
            <ListTodo size={16} className="text-gray-400" /> Текущие ({pendingTasks.length})
          </h2>
          <div ref={pendingListRef} className="space-y-2">
            {pendingTasks.map(task => (
              <TaskCard 
                key={task.id} 
                task={task} 
                globalProgress={taskProgress[task.id] || 0} 
                onProgressUpdate={updateProgress} 
                onToggleStatus={toggleTaskStatus}
                hasVip={hasVip}
                isX2Server={isX2Server}
              />
            ))}
          </div>
        </div>

        {/* Completed Tasks Section */}
        {completedTasks.length > 0 && (
          <div ref={completedRef} className="scroll-mt-36">
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3 text-green-500 flex items-center gap-2 px-1">
              <CheckCircle2 size={16} /> Выполнено ({completedTasks.length})
            </h2>
            <div ref={completedListRef} className="space-y-2 opacity-75">
              {completedTasks.map(task => (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  globalProgress={taskProgress[task.id] || 0} 
                  onProgressUpdate={updateProgress} 
                  onToggleStatus={toggleTaskStatus}
                  hasVip={hasVip}
                  isX2Server={isX2Server}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM NAVIGATION BAR */}
      <div className="fixed bottom-0 left-0 right-0 bg-rpPanel border-t border-gray-800 flex justify-around items-center p-2 z-50 pb-safe shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
        <button onClick={() => scrollToSection(recommendedRef)} className="flex flex-col items-center p-2 text-gray-400 hover:text-orange-400 transition-colors">
          <Flame size={20} />
          <span className="text-[10px] mt-1 font-semibold">Топ</span>
        </button>
        <button onClick={() => scrollToSection(pendingRef)} className="flex flex-col items-center p-2 text-gray-400 hover:text-white transition-colors">
          <ListTodo size={20} />
          <span className="text-[10px] mt-1 font-semibold">Задания</span>
        </button>
        <button onClick={() => scrollToSection(completedRef)} className="flex flex-col items-center p-2 text-gray-400 hover:text-green-500 transition-colors">
          <CheckCircle2 size={20} />
          <span className="text-[10px] mt-1 font-semibold">Готово</span>
        </button>
        <div className="w-px h-8 bg-gray-700 mx-1"></div>
        <button onClick={() => { triggerHaptic('click'); setIsResetModalOpen(true); }} className="flex flex-col items-center p-2 text-gray-500 hover:text-red-400 transition-colors">
          <Trash2 size={20} />
          <span className="text-[10px] mt-1 font-semibold">Сброс</span>
        </button>
      </div>

      {/* HISTORY MODAL FULLSCREEN */}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 z-[100] bg-rpDark flex flex-col overflow-hidden animate-in slide-in-from-bottom-full duration-300">
          <div className="p-4 bg-rpPanel border-b border-gray-800 flex justify-between items-center shrink-0 pt-safe">
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><History size={20} className="text-orange-400"/> История BP</h2>
            <button onClick={() => { triggerHaptic('click'); setIsHistoryModalOpen(false); }} className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-white"><X size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 pb-32" ref={historyListRef}>
            {last7Days.map((dateStr, idx) => {
              const isToday = dateStr === gameDay;
              const dayData = isToday ? { bp: calculateTotalBP(), completedCount: completedTasks.length, logs: todayLogs } : history[dateStr];
              const hasActivity = dayData && dayData.logs.length > 0;
              const isExpanded = expandedHistoryDay === dateStr;

              let cardClass = "";
              if (isToday) cardClass = "bg-rpPanel border-gray-700";
              else if (hasActivity) cardClass = "bg-orange-500/10 border-orange-500/50 shadow-[0_0_15px_rgba(249,115,22,0.05)]";
              else cardClass = "bg-gray-900 border-gray-800 opacity-60";

              return (
                <div key={dateStr} className={`mb-3 rounded-xl border overflow-hidden transition-all ${cardClass}`}>
                  <div 
                    onClick={() => {
                      if (!hasActivity) return;
                      triggerHaptic('click');
                      setExpandedHistoryDay(isExpanded ? null : dateStr);
                    }}
                    className={`p-4 flex items-center justify-between ${hasActivity ? 'cursor-pointer active:bg-white/5' : ''}`}
                  >
                    <div>
                      <h3 className={`font-bold ${isToday ? 'text-white' : hasActivity ? 'text-orange-400' : 'text-gray-500'}`}>
                        {idx === 0 ? 'Сегодня' : idx === 1 ? 'Вчера' : formatDateString(dateStr)}
                      </h3>
                      <p className="text-xs text-gray-400 mt-1">
                        {hasActivity ? `Выполнено заданий: ${dayData.completedCount ?? dayData.logs.filter(l=>l.type==='add').length}` : 'Нет активности'}
                      </p>
                    </div>
                    {hasActivity && (
                      <div className="flex items-center gap-4">
                        <span className={`text-xl font-black ${isToday ? 'text-white' : 'text-orange-400'}`}>
                          {dayData.bp} <span className="text-sm">BP</span>
                        </span>
                        {isExpanded ? <ChevronUp size={20} className="text-gray-500"/> : <ChevronDown size={20} className="text-gray-500"/>}
                      </div>
                    )}
                  </div>

                  {/* Accordion List with Reset Logs & BP Diffs */}
                  {isExpanded && hasActivity && (
                    <div className="bg-black/30 p-3 border-t border-gray-800/50 space-y-2">
                      {dayData.logs.sort((a, b) => a.timestamp - b.timestamp).map((log) => {
                        const time = new Date(log.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                        
                        // Rendering a Manual Reset block
                        if (log.type === 'reset') {
                          return (
                            <div key={log.id} className="flex gap-3 items-center text-sm bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                              <span className="text-red-400/70 font-mono text-xs w-10 shrink-0">{time}</span>
                              <span className="text-red-400 flex-1 font-semibold tracking-wide uppercase text-[10px]">Сброс прогресса</span>
                              <span className="text-red-500 shrink-0 font-mono font-bold text-xs">-</span>
                            </div>
                          );
                        }

                        // Rendering Add/Remove Task blocks
                        const taskName = tasks.find(t => t.id === log.taskId)?.title || "Неизвестное задание";
                        const isAdd = log.type === 'add';

                        return (
                          <div key={log.id} className={`flex gap-3 items-center text-sm px-1 py-0.5 ${!isAdd ? 'opacity-60' : ''}`}>
                            <span className="text-gray-500 font-mono text-xs w-10 shrink-0">{time}</span>
                            <span className={`flex-1 leading-tight ${isAdd ? 'text-gray-200' : 'text-gray-500 line-through decoration-gray-500'}`}>
                              {!isAdd && <span className="text-red-400/80 mr-1 text-xs">Отмена:</span>}
                              {taskName}
                            </span>
                            <span className={`shrink-0 font-mono font-bold text-xs ${isAdd ? 'text-green-400' : 'text-red-400'}`}>
                              {isAdd ? '+' : '-'}{log.bp} BP
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* RESET CONFIRMATION MODAL */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-rpPanel border border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Сбросить прогресс?</h3>
            <p className="text-gray-400 text-sm mb-6">
              Вы уверены? Прогресс будет обнулен, но действие будет записано в историю дня. Автоматический сброс происходит каждый день в 7:00 МСК.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => { triggerHaptic('click'); setIsResetModalOpen(false); }}
                className="flex-1 py-3 rounded-xl font-bold bg-gray-800 text-white active:bg-gray-700 transition-colors"
              >
                Отмена
              </button>
              <button 
                onClick={resetAllProgress}
                className="flex-1 py-3 rounded-xl font-bold bg-red-500/20 text-red-500 border border-red-500/50 active:bg-red-500 active:text-white transition-colors"
              >
                Да, сбросить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  globalProgress: number;
  onProgressUpdate: (id: number, amount: number, max: number) => void;
  onToggleStatus: (id: number) => void;
  hasVip: boolean;
  isX2Server: boolean;
}

function TaskCard({ task, globalProgress, onProgressUpdate, onToggleStatus, hasVip, isX2Server }: TaskCardProps) {
  const [localProgress, setLocalProgress] = useState(globalProgress);
  const [isDragging, setIsDragging] = useState(false);
  
  const isFinishedGlobal = task.type === 'progress' ? globalProgress >= task.max : globalProgress > 0;
  const displayProgress = isDragging ? localProgress : globalProgress;

  useEffect(() => {
    if (!isDragging) setLocalProgress(globalProgress);
  }, [globalProgress, isDragging]);

  let dynamicReward = hasVip ? task.vipBP : task.baseBP;
  if (isX2Server) dynamicReward *= 2;

  const progressPercent = task.type === 'progress' 
    ? Math.min(100, (displayProgress / task.max) * 100) 
    : (isFinishedGlobal ? 100 : 0);

  const dragStartX = useRef<number | null>(null);
  const startProgress = useRef<number>(0);
  const isDragMove = useRef<boolean>(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartX.current = e.clientX;
    startProgress.current = displayProgress;
    isDragMove.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null || task.type === 'boolean') return;
    const deltaX = e.clientX - dragStartX.current;
    
    if (!isDragMove.current && Math.abs(deltaX) > 10) {
      isDragMove.current = true;
      setIsDragging(true);
    }

    if (isDragMove.current) {
      const cardWidth = e.currentTarget.getBoundingClientRect().width;
      const progressDelta = Math.floor((deltaX / cardWidth) * (task.type === 'repeatable' ? 10 : task.max));
      let newProgress = startProgress.current + progressDelta;
      newProgress = Math.max(0, Math.min(task.type === 'repeatable' ? 999 : task.max, newProgress));

      if (newProgress !== localProgress) {
        setLocalProgress(newProgress);
        triggerHaptic('tick');
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    dragStartX.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (isDragMove.current) {
      setIsDragging(false);
      isDragMove.current = false;
      const amountToAdd = localProgress - globalProgress;
      
      if (amountToAdd !== 0) {
        onProgressUpdate(task.id, amountToAdd, task.type === 'repeatable' ? 999 : task.max);
        if (localProgress >= task.max && globalProgress < task.max) triggerHaptic('success');
      }
    } else {
      triggerHaptic('click');
      if (task.type === 'boolean') {
        onToggleStatus(task.id);
        if (!isFinishedGlobal) triggerHaptic('success');
      } else {
        onProgressUpdate(task.id, 1, task.type === 'repeatable' ? 999 : task.max);
        if (globalProgress + 1 === task.max) triggerHaptic('success');
      }
    }
  };

  return (
    <div 
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`relative overflow-hidden bg-rpPanel rounded-xl border cursor-pointer touch-pan-y transition-all duration-300 ease-out active:scale-[0.98] ${isFinishedGlobal && task.type !== 'repeatable' ? 'border-orange-500/50 bg-orange-500/10 shadow-[0_0_15px_rgba(249,115,22,0.1)]' : 'border-gray-800'}`}
    >
      {(task.type === 'progress' || task.type === 'repeatable') && displayProgress > 0 && (
        <div 
          className="absolute left-0 top-0 bottom-0 bg-rp-gradient opacity-20 transition-all duration-100 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      )}
      
      <div className="relative z-10 p-3 flex justify-between items-center min-h-[72px] pointer-events-none">
        <div className="flex-1 pr-3">
          <h3 className={`font-semibold text-sm leading-tight mb-1 transition-colors duration-300 ${isFinishedGlobal && task.type !== 'repeatable' ? 'text-orange-400' : 'text-gray-200'}`}>
            {task.title}
          </h3>
          <span className="text-xs text-gray-500 font-medium">
            +{dynamicReward} BP {task.type === 'repeatable' && '(за раз)'}
          </span>
        </div>

        <div className="flex items-center gap-3 pointer-events-auto">
          {(task.type === 'progress' || task.type === 'repeatable') && globalProgress > 0 && (
            <button 
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('click');
                onProgressUpdate(task.id, -1, task.max);
              }}
              className="w-9 h-9 rounded-lg bg-black/40 text-gray-400 flex items-center justify-center active:bg-black/80 active:text-white transition-colors border border-gray-700/50"
            >
              <Minus size={18} />
            </button>
          )}

          <div className="min-w-[44px] flex justify-end items-center h-full">
            {task.type === 'boolean' ? (
              <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${isFinishedGlobal ? 'bg-rp-gradient text-rpDark shadow-[0_0_10px_rgba(249,115,22,0.4)]' : 'bg-gray-800 border border-gray-700'}`}>
                {isFinishedGlobal ? <Check size={16} strokeWidth={3} /> : null}
              </div>
            ) : (
              <div className="flex flex-col items-end justify-center h-full pt-0.5">
                <span className={`text-xl leading-none font-black font-mono tracking-tighter transition-colors duration-300 ${isFinishedGlobal && task.type !== 'repeatable' ? 'text-orange-400' : 'text-white'}`}>
                  {displayProgress}
                </span>
                {task.type === 'progress' && (
                  <span className="text-[10px] leading-none text-gray-500 font-mono font-bold mt-1">
                    / {task.max}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;