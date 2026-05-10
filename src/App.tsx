import { useState, useEffect, useMemo, useRef } from 'react';
import WebApp from '@twa-dev/sdk';
import { Check, Minus, Trophy, Star, Zap, Trash2, ListTodo, CheckCircle2, Flame, History, X, RefreshCw, ChevronDown, ChevronUp, Cloud, Search, ArrowUpDown, Settings, Bell, Clock, Send } from 'lucide-react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { tasks } from './data';
import type { Task } from './data';

const tgApp = (WebApp as any).default || WebApp;

const BOT_TOKEN = 'ТВОЙ_ТОКЕН_БОТА'; 

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

interface ActiveTimer {
  taskId: number;
  endTime: number;
  taskTitle: string;
}

interface TaskCardProps {
  task: Task;
  globalProgress: number;
  onProgressUpdate: (id: number, amount: number, max: number) => void;
  onToggleStatus: (id: number) => void;
  hasVip: boolean;
  isX2Server: boolean;
  hapticsEnabled: boolean;
  activeTimer: ActiveTimer | null;
}

const isCloudSupported = tgApp?.isVersionAtLeast?.('6.9');
const cloud = {
  set: (key: string, value: any) => new Promise((res) => {
    const val = JSON.stringify(value);
    if (isCloudSupported) tgApp.CloudStorage.setItem(key, val, () => res(true));
    else { localStorage.setItem(key, val); res(true); }
  }),
  get: (key: string) => new Promise<any>((res) => {
    if (isCloudSupported) {
      tgApp.CloudStorage.getItem(key, (_: any, v: string) => { try { res(v ? JSON.parse(v) : null); } catch { res(null); } });
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

const sendBotNotification = async (chatId: string, text: string) => {
  if (!BOT_TOKEN || !chatId || BOT_TOKEN === 'ТВОЙ_ТОКЕН_БОТА') return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
  } catch (e) { console.error('Bot API Error', e); }
};

export const triggerHaptic = (type: 'click' | 'tick' | 'success', enabled: boolean) => {
  if (!tgApp?.HapticFeedback || !enabled) return;
  try {
    if (type === 'click') tgApp.HapticFeedback.impactOccurred('light');
    if (type === 'tick') tgApp.HapticFeedback.selectionChanged();
    if (type === 'success') tgApp.HapticFeedback.notificationOccurred('success');
  } catch (e) { console.warn('Haptic Error'); }
};

const getCurrentGameDay = (): string => {
  const d = new Date();
  d.setHours(d.getHours() - 7); 
  return d.toISOString().split('T')[0];
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
  const [userChatId, setUserChatId] = useState<string>('');

  const [timersSettings, setTimersSettings] = useState({
    pet: { enabled: true, duration: 20 },
    parcels: { enabled: true, duration: 10 }
  });
  const [activeTimers, setActiveTimers] = useState<Record<number, ActiveTimer>>({}); 

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
      if (tgApp) {
        tgApp.ready();
        tgApp.expand();
        const id = tgApp.initDataUnsafe?.user?.id?.toString();
        if (id) setUserChatId(id);
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

      const now = Date.now();
      let timerChanged = false;
      const nextTimers = { ...activeTimers };
      
      for (const [id, timerObj] of Object.entries(nextTimers)) {
        if (now >= timerObj.endTime) {
          delete nextTimers[Number(id)];
          timerChanged = true;
          triggerHaptic('success', hapticsEnabled);
          if (userChatId) {
            sendBotNotification(userChatId, `⏰ <b>Таймер завершен!</b>\nЗадание: <u>${timerObj.taskTitle}</u> доступно.`);
          }
        }
      }
      if (timerChanged) {
        setActiveTimers(nextTimers);
        await cloud.set('active_timers', nextTimers);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isLoading, lastLocalUpdate, activeTimers, hapticsEnabled, userChatId]);

  const refreshDataFromCloud = async () => {
    const currentDay = getCurrentGameDay();
    const [p, l, d, v, x2, hapt, tSet, aTimers, cid, ts, allKeys] = await Promise.all([
      cloud.get('progress'), cloud.get('logs'), cloud.get('gameday'),
      cloud.get('vip'), cloud.get('x2'), cloud.get('haptics'), 
      cloud.get('timers_settings'), cloud.get('active_timers'), cloud.get('user_chat_id'),
      cloud.get('last_update_ts'), cloud.getKeys()
    ]);

    if (v !== null) setHasVip(!!v);
    if (x2 !== null) setIsX2Server(!!x2);
    setHapticsEnabled(hapt !== null ? !!hapt : true);
    if (tSet) setTimersSettings(tSet);
    if (aTimers) setActiveTimers(aTimers);
    if (cid) setUserChatId(cid);
    if (ts) setLastLocalUpdate(ts);

    if (d && d !== currentDay) {
      const prevProgress = p || {};
      const prevLogs = l || [];
      let finalBP = 0;
      tasks.forEach(t => {
        const val = prevProgress[t.id] || 0;
        if (t.type === 'progress' ? val >= t.max : val > 0) {
          let r = (!!v ? t.vipBP : t.baseBP) * (!!x2 ? 2 : 1);
          finalBP += (t.type === 'repeatable' ? r * val : r);
        }
      });
      await cloud.set(`hist_${d}`, { bp: finalBP, completedCount: Object.keys(prevProgress).length, logs: prevLogs });
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const oldKeys = allKeys.filter(k => k.startsWith('hist_') && new Date(k.replace('hist_', '')) < ninetyDaysAgo);
      if (oldKeys.length > 0) await cloud.remove(oldKeys);

      setTaskProgress({}); setTodayLogs([]); setCompletedIds(new Set()); setActiveTimers({});
      const resetTs = Date.now();
      setLastLocalUpdate(resetTs);
      await Promise.all([cloud.set('progress', {}), cloud.set('logs', []), cloud.set('gameday', currentDay), cloud.set('active_timers', {}), cloud.set('last_update_ts', resetTs)]);
    } else {
      const loadedP = p || {};
      setTaskProgress(loadedP);
      setTodayLogs(l || []);
      const ids = new Set<number>();
      tasks.forEach(t => { if (loadedP[t.id] >= (t.type === 'progress' ? t.max : 1)) ids.add(t.id); });
      setCompletedIds(ids);
    }

    const hist: Record<string, DailyHistory> = {};
    const histKeys = allKeys.filter(k => k.startsWith('hist_')).sort().reverse();
    for (const k of histKeys) {
      const data = await cloud.get(k);
      if (data) hist[k.replace('hist_', '')] = data;
    }
    setHistory(hist);
    setGameDay(currentDay);
  };

  const calculateTotalBP = () => {
    let total = 0;
    tasks.forEach(t => {
      const val = taskProgress[t.id] || 0;
      if (t.type === 'progress' ? val >= t.max : val > 0) {
        let r = (hasVip ? t.vipBP : t.baseBP) * (isX2Server ? 2 : 1);
        total += (t.type === 'repeatable' ? r * val : r);
      }
    });
    return total;
  };

  const sync = async (p: any, l: any, t: any) => {
    const nowTs = Date.now();
    setLastLocalUpdate(nowTs);
    await Promise.all([cloud.set('progress', p), cloud.set('logs', l), cloud.set('active_timers', t), cloud.set('last_update_ts', nowTs), cloud.set('gameday', gameDay)]);
  };

  const updateProgress = async (taskId: number, amount: number, maxAmount: number) => {
    const currentVal = taskProgress[taskId] || 0;
    const nextVal = Math.max(0, Math.min(maxAmount, currentVal + amount));
    if (currentVal === nextVal) return;

    const task = tasks.find(t => t.id === taskId)!;
    let reward = (hasVip ? task.vipBP : task.baseBP) * (isX2Server ? 2 : 1);

    const newLog: TaskLog = { id: Math.random().toString(36).substring(2, 9), taskId, type: amount > 0 ? 'add' : 'remove', bp: task.type === 'repeatable' ? reward * Math.abs(amount) : reward, timestamp: Date.now() };
    const nextLogs = [...todayLogs, newLog];
    const nextProgress = { ...taskProgress, [taskId]: nextVal };

    let nextTimers = { ...activeTimers };
    if (amount > 0) {
      if (task.title.includes('Дрессировка') && timersSettings.pet.enabled && nextVal % 4 === 0) {
        nextTimers[taskId] = { taskId, endTime: Date.now() + (timersSettings.pet.duration * 60000), taskTitle: task.title };
      }
      if (task.title.includes('Посылки') && timersSettings.parcels.enabled) {
        nextTimers[taskId] = { taskId, endTime: Date.now() + (timersSettings.parcels.duration * 60000), taskTitle: task.title };
      }
    }

    if (nextVal >= maxAmount && currentVal < maxAmount) {
      timeoutsRef.current[taskId] = setTimeout(() => setCompletedIds(prev => new Set(prev).add(taskId)), 400);
    } else if (nextVal < maxAmount && currentVal >= maxAmount) {
      setCompletedIds(prev => { const n = new Set(prev); n.delete(taskId); return n; });
    }

    setTodayLogs(nextLogs); setTaskProgress(nextProgress); setActiveTimers(nextTimers);
    await sync(nextProgress, nextLogs, nextTimers);
  };

  const resetAllProgress = async () => {
    triggerHaptic('success', hapticsEnabled);
    const resetLog: TaskLog = { id: 'reset-' + Date.now(), taskId: null, type: 'reset', bp: 0, timestamp: Date.now() };
    setTaskProgress({}); setCompletedIds(new Set()); setTodayLogs([...todayLogs, resetLog]); setActiveTimers({});
    await sync({}, [...todayLogs, resetLog], {});
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
    tasks.forEach(task => { if (completedIds.has(task.id)) completed.push(task); else pending.push(task); });
    return { pendingTasks: processTasks(pending), completedTasks: processTasks(completed) };
  }, [completedIds, searchQuery, sortBy, hasVip]);

  const recommendedTasks = useMemo(() => {
    const activeCats = new Set<string>();
    completedTasks.forEach(t => activeCats.add(t.category));
    let pool = [...pendingTasks].sort(() => Math.random() - 0.5);
    return [...pool.filter(t => activeCats.has(t.category)), ...pool.filter(t => !activeCats.has(t.category))].slice(0, 3);
  }, [pendingTasks, completedTasks, recommendationSeed]);

  if (isLoading) return <div className="min-h-screen bg-rpDark flex flex-col items-center justify-center text-orange-400 font-bold gap-4"><RefreshCw className="animate-spin" size={32} /><span>ЗАГРУЗКА...</span></div>;

  return (
    <div className="min-h-screen bg-rpDark pb-24 font-sans select-none overflow-x-hidden">
      <div className="fixed top-0 left-0 right-0 z-40 bg-rpDark/85 backdrop-blur-xl border-b border-gray-800 p-4 shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-xl font-bold text-transparent bg-clip-text bg-rp-gradient flex items-center gap-2">
            <Trophy size={20} className="text-yellow-400" /> BP Tracker <Cloud size={14} className={`${isSyncing ? 'text-blue-400 animate-bounce' : 'text-blue-400 opacity-20'}`} />
          </h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsHistoryModalOpen(true)} className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 border border-gray-700 active:scale-90"><History size={16} /></button>
            <button onClick={() => setActiveTab(activeTab === 'tasks' ? 'settings' : 'tasks')} className={`w-9 h-9 rounded-full flex items-center justify-center border transition-all ${activeTab === 'settings' ? 'bg-orange-500 text-rpDark' : 'bg-gray-800 border-gray-700 text-gray-400'}`}><Settings size={16} /></button>
            <div className="text-right ml-1">
              <div className="text-[10px] text-gray-400 font-semibold uppercase leading-none mb-1">Всего</div>
              <div className="text-xl font-black text-white leading-none">{calculateTotalBP()} <span className="text-orange-400 text-xs">BP</span></div>
            </div>
          </div>
        </div>

        {activeTab === 'tasks' && (
          <div className="animate-in fade-in duration-300">
            <div className="flex gap-2 mb-3">
              <button onClick={async () => { const v = !hasVip; setHasVip(v); await cloud.set('vip', v); setLastLocalUpdate(Date.now()); }} className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-bold transition-all ${hasVip ? 'bg-rp-gradient text-rpDark shadow-lg shadow-orange-500/20' : 'bg-gray-800 text-gray-400'}`}><Star size={14} className="inline mr-1" /> VIP</button>
              <button onClick={async () => { const x = !isX2Server; setIsX2Server(x); await cloud.set('x2', x); setLastLocalUpdate(Date.now()); }} className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-bold transition-all ${isX2Server ? 'bg-rp-gradient text-rpDark shadow-lg shadow-orange-500/20' : 'bg-gray-800 text-gray-400'}`}><Zap size={14} className="inline mr-1" /> Сервер x2</button>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input type="text" placeholder="Поиск..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg py-2 pl-10 text-sm text-white" />
              </div>
              <button onClick={() => setSortBy(prev => prev === 'default' ? 'high' : prev === 'high' ? 'low' : 'default')} className={`px-3 rounded-lg border text-xs font-bold ${sortBy !== 'default' ? 'border-orange-500 text-orange-400' : 'border-gray-800 text-gray-400'}`}><ArrowUpDown size={14} /></button>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 pt-[180px]" ref={parent}>
        {activeTab === 'tasks' ? (
          <div className="space-y-8">
            {recommendedTasks.length > 0 && !searchQuery && (
              <div ref={recommendedRef}>
                <h2 className="text-sm font-bold uppercase tracking-widest text-orange-400 flex items-center justify-between mb-3 px-1">
                  <span className="flex items-center gap-2"><Flame size={16} /> Рекомендуем</span>
                  <button onClick={() => setRecommendationSeed(s => s + 1)} className="text-gray-500 p-1 bg-gray-800 rounded-full active:rotate-180 transition-transform duration-500"><RefreshCw size={14} /></button>
                </h2>
                <div className="space-y-2">
                  {recommendedTasks.map(t => <TaskCard key={`rec-${t.id}`} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={(id) => updateProgress(id, (taskProgress[id]||0)>0?-1:1, 1)} hasVip={hasVip} isX2Server={isX2Server} hapticsEnabled={hapticsEnabled} activeTimer={activeTimers[t.id] || null} />)}
                </div>
              </div>
            )}
            <div ref={pendingRef}>
              <h2 className="text-sm font-bold uppercase mb-3 text-white px-1 flex items-center gap-2"><ListTodo size={16} className="text-gray-500"/> Задания ({pendingTasks.length})</h2>
              <div className="space-y-2">
                {pendingTasks.map(t => <TaskCard key={t.id} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={(id) => updateProgress(id, (taskProgress[id]||0)>0?-1:1, 1)} hasVip={hasVip} isX2Server={isX2Server} hapticsEnabled={hapticsEnabled} activeTimer={activeTimers[t.id] || null} />)}
              </div>
            </div>
            {completedTasks.length > 0 && (
              <div ref={completedRef}>
                <h2 className="text-sm font-bold uppercase mb-3 text-green-500 px-1 flex items-center gap-2"><CheckCircle2 size={16} /> Готово ({completedTasks.length})</h2>
                <div className="space-y-2 opacity-75">
                  {completedTasks.map(t => <TaskCard key={t.id} task={t} globalProgress={taskProgress[t.id] || 0} onProgressUpdate={updateProgress} onToggleStatus={(id) => updateProgress(id, (taskProgress[id]||0)>0?-1:1, 1)} hasVip={hasVip} isX2Server={isX2Server} hapticsEnabled={hapticsEnabled} activeTimer={activeTimers[t.id] || null} />)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6 animate-in slide-in-from-bottom-4">
            <div className="bg-rpPanel rounded-2xl p-4 border border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${hapticsEnabled ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-800 text-gray-500'}`}><Bell size={20} /></div>
                <div><h3 className="font-bold text-white text-sm">Вибрация</h3><p className="text-xs text-gray-500">Тактильный отклик</p></div>
              </div>
              <button onClick={async () => { const s = !hapticsEnabled; setHapticsEnabled(s); await cloud.set('haptics', s); }} className={`w-12 h-6 rounded-full relative transition-colors ${hapticsEnabled ? 'bg-orange-500' : 'bg-gray-700'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${hapticsEnabled ? 'left-7' : 'left-1'}`} /></button>
            </div>

            <div className="bg-rpPanel rounded-2xl p-4 border border-gray-800 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center"><Send size={20} /></div>
                <div><h3 className="font-bold text-white text-sm">Уведомления бота</h3><p className="text-[10px] text-gray-500">Бот напишет, когда таймер истечет</p></div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-gray-800/50">
                <input type="text" value={userChatId} onChange={async (e) => { setUserChatId(e.target.value); await cloud.set('user_chat_id', e.target.value); }} className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white font-mono" placeholder="Chat ID" />
                <button onClick={() => sendBotNotification(userChatId, "✅ Тестовое сповіщення!")} className="bg-gray-800 p-2 rounded-lg text-gray-400 active:scale-95"><Send size={18} /></button>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest px-1">Таймеры</h3>
              <div className="bg-rpPanel rounded-2xl p-4 border border-gray-800 space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><span className="text-sm font-bold text-white">Дресировка (мин)</span><button onClick={async () => { const n = {...timersSettings, pet: {...timersSettings.pet, enabled: !timersSettings.pet.enabled}}; setTimersSettings(n); await cloud.set('timers_settings', n); }} className={`w-10 h-5 rounded-full relative ${timersSettings.pet.enabled ? 'bg-orange-500' : 'bg-gray-700'}`}><div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${timersSettings.pet.enabled ? 'left-6' : 'left-1'}`} /></button></div>
                  <input type="range" min="1" max="60" value={timersSettings.pet.duration} onChange={async (e) => { const n = {...timersSettings, pet: {...timersSettings.pet, duration: parseInt(e.target.value)}}; setTimersSettings(n); await cloud.set('timers_settings', n); }} className="w-full accent-orange-500" />
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center"><span className="text-sm font-bold text-white">Посилки (мин)</span><button onClick={async () => { const n = {...timersSettings, parcels: {...timersSettings.parcels, enabled: !timersSettings.parcels.enabled}}; setTimersSettings(n); await cloud.set('timers_settings', n); }} className={`w-10 h-5 rounded-full relative ${timersSettings.parcels.enabled ? 'bg-orange-500' : 'bg-gray-700'}`}><div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${timersSettings.parcels.enabled ? 'left-6' : 'left-1'}`} /></button></div>
                  <input type="range" min="1" max="30" value={timersSettings.parcels.duration} onChange={async (e) => { const n = {...timersSettings, parcels: {...timersSettings.parcels, duration: parseInt(e.target.value)}}; setTimersSettings(n); await cloud.set('timers_settings', n); }} className="w-full accent-orange-500" />
                </div>
              </div>
            </div>

            <button onClick={() => setIsResetModalOpen(true)} className="w-full py-4 bg-red-500/10 text-red-500 rounded-2xl font-bold border border-red-500/20 active:scale-95 transition-all"><Trash2 size={16} className="inline mr-2" /> Сброс прогресса</button>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-rpPanel/90 backdrop-blur-lg border-t border-gray-800 flex justify-around p-2 pb-safe z-50">
        <button onClick={() => { recommendedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); triggerHaptic('click', hapticsEnabled); }} className="flex flex-col items-center p-2 text-gray-500 active:text-orange-400"><Flame size={20} /><span className="text-[10px] mt-1 font-bold">Топ</span></button>
        <button onClick={() => { pendingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); triggerHaptic('click', hapticsEnabled); }} className="flex flex-col items-center p-2 text-gray-500 active:text-white"><ListTodo size={20} /><span className="text-[10px] mt-1 font-bold">Задания</span></button>
        <button onClick={() => { completedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); triggerHaptic('click', hapticsEnabled); }} className="flex flex-col items-center p-2 text-gray-500 active:text-green-500"><CheckCircle2 size={20} /><span className="text-[10px] mt-1 font-bold">Готово</span></button>
        <div className="w-px h-8 bg-gray-700 self-center" />
        <button onClick={() => { triggerHaptic('click', hapticsEnabled); setActiveTab('settings'); }} className={`flex flex-col items-center p-2 transition-colors ${activeTab === 'settings' ? 'text-orange-400' : 'text-gray-500'}`}><Settings size={20} /><span className="text-[10px] mt-1 font-bold">Настройки</span></button>
      </div>

      {isHistoryModalOpen && (
        <div className="fixed inset-0 z-[100] bg-rpDark flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
           <div className="p-4 bg-rpPanel border-b border-gray-800 flex justify-between items-center shrink-0 pt-safe shadow-lg">
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><History size={20} className="text-orange-400"/> История BP</h2>
            <button onClick={() => setIsHistoryModalOpen(false)} className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-white"><X size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 pb-32" ref={historyListRef}>
            {Object.keys({ [gameDay]: {}, ...history }).map((dateStr, idx) => {
              const dayData = dateStr === gameDay ? { bp: calculateTotalBP(), logs: todayLogs } : history[dateStr];
              const hasActivity = dayData && dayData.logs?.length > 0;
              const isExpanded = expandedHistoryDay === dateStr;
              return (
                <div key={dateStr} className={`mb-3 rounded-xl border transition-all ${dateStr === gameDay ? 'bg-rpPanel border-gray-700' : hasActivity ? 'bg-orange-500/10 border-orange-500/50' : 'bg-gray-900 border-gray-800 opacity-60'}`}>
                  <div onClick={() => hasActivity && setExpandedHistoryDay(isExpanded ? null : dateStr)} className={`p-4 flex items-center justify-between ${hasActivity ? 'cursor-pointer' : ''}`}>
                    <div><h3 className="font-bold text-white">{idx === 0 ? 'Сегодня' : dateStr}</h3><p className="text-xs text-gray-500">{hasActivity ? dayData.bp + ' BP' : 'Нет записей'}</p></div>
                    {hasActivity && (isExpanded ? <ChevronUp size={20}/> : <ChevronDown size={20}/>)}
                  </div>
                  {isExpanded && hasActivity && (
                    <div className="bg-black/30 p-3 border-t border-gray-800/50 space-y-2">
                      {dayData.logs.slice().reverse().map((log: any) => (
                        <div key={log.id} className={`flex justify-between text-xs ${log.type === 'reset' ? 'text-red-400 font-bold' : log.type === 'add' ? 'text-gray-200' : 'text-gray-500 line-through'}`}>
                          <span>{log.type === 'reset' ? 'СБРОС' : tasks.find(t => t.id === log.taskId)?.title}</span>
                          <span className={log.type === 'add' ? 'text-green-400' : 'text-red-400'}>{log.type === 'reset' ? '-' : (log.type === 'add' ? '+' : '-') + log.bp + ' BP'}</span>
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
          <div className="bg-rpPanel border border-gray-800 rounded-3xl p-6 w-full max-w-sm"><h3 className="text-xl font-bold text-white mb-6">Сбросить всё?</h3><div className="flex gap-3"><button onClick={() => setIsResetModalOpen(false)} className="flex-1 py-3 rounded-2xl bg-gray-800 text-white font-bold">Отмена</button><button onClick={resetAllProgress} className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-bold">Да</button></div></div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, globalProgress, onProgressUpdate, onToggleStatus, hasVip, isX2Server, hapticsEnabled, activeTimer }: TaskCardProps) {
  const [localProgress, setLocalProgress] = useState(globalProgress);
  const [isDragging, setIsDragging] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  useEffect(() => { if (!isDragging) setLocalProgress(globalProgress); }, [globalProgress, isDragging]);

  useEffect(() => {
    if (!activeTimer) { setTimeLeft(null); return; }
    const int = setInterval(() => {
      const diff = activeTimer.endTime - Date.now();
      if (diff <= 0) { setTimeLeft(null); clearInterval(int); return; }
      const m = Math.floor(diff / 60000), s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${m}:${s < 10 ? '0' : ''}${s}`);
    }, 1000);
    return () => clearInterval(int);
  }, [activeTimer]);

  const dragStartX = useRef<number | null>(null);
  const startProgress = useRef<number>(0);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartX.current = e.clientX; startProgress.current = localProgress;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null || task.type === 'boolean') return;
    const deltaX = e.clientX - dragStartX.current;
    if (Math.abs(deltaX) > 10) setIsDragging(true);
    if (isDragging) {
      const cardWidth = e.currentTarget.getBoundingClientRect().width;
      const progressDelta = Math.floor((deltaX / cardWidth) * (task.type === 'repeatable' ? 10 : task.max));
      let newP = Math.max(0, Math.min(task.type === 'repeatable' ? 999 : task.max, startProgress.current + progressDelta));
      if (newP !== localProgress) { setLocalProgress(newP); triggerHaptic('tick', hapticsEnabled); }
    }
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    dragStartX.current = null; e.currentTarget.releasePointerCapture(e.pointerId);
    if (isDragging) {
      setIsDragging(false); const diff = localProgress - globalProgress;
      if (diff !== 0) onProgressUpdate(task.id, diff, task.type === 'repeatable' ? 999 : task.max);
    } else {
      triggerHaptic('click', hapticsEnabled);
      if (task.type === 'boolean') onToggleStatus(task.id);
      else onProgressUpdate(task.id, 1, task.type === 'repeatable' ? 999 : task.max);
    }
  };

  const isFinished = globalProgress >= (task.type === 'progress' ? task.max : 1);
  const progressPercent = task.type === 'progress' ? Math.min(100, (localProgress / task.max) * 100) : (globalProgress > 0 ? 100 : 0);

  return (
    <div onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} className={`relative overflow-hidden bg-rpPanel rounded-xl border p-3 min-h-[72px] flex justify-between items-center transition-all ${isFinished && task.type !== 'repeatable' ? 'border-orange-500/30 bg-orange-500/5 shadow-[0_0_15px_rgba(249,115,22,0.05)]' : 'border-gray-800'}`}>
      {(task.type === 'progress' || task.type === 'repeatable') && localProgress > 0 && (
        <div className="absolute left-0 top-0 bottom-0 bg-rp-gradient opacity-10 transition-all duration-300" style={{ width: `${progressPercent}%` }} />
      )}
      <div className="relative z-10 flex-1">
        <h3 className={`font-semibold text-sm leading-tight mb-1 transition-colors ${isFinished && task.type !== 'repeatable' ? 'text-orange-400' : 'text-gray-200'}`}>{task.title}</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 font-bold">+{(hasVip ? task.vipBP : task.baseBP) * (isX2Server ? 2 : 1)} BP</span>
          {timeLeft && <div className="flex items-center gap-1 bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded text-[10px] font-black animate-pulse"><Clock size={10} /> {timeLeft}</div>}
        </div>
      </div>
      <div className="relative z-10 flex items-center gap-3">
        {task.type === 'repeatable' && globalProgress > 0 && <button onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onProgressUpdate(task.id, -1, task.max); }} className="w-8 h-8 rounded-lg bg-gray-800 text-gray-400 flex items-center justify-center active:bg-gray-700"><Minus size={16} /></button>}
        <div className="text-right min-w-[34px]">
          {task.type === 'boolean' ? (
            <div className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all ${isFinished ? 'bg-rp-gradient text-rpDark border-transparent' : 'bg-gray-800 border border-gray-700'}`}>{isFinished && <Check size={16} strokeWidth={3} />}</div>
          ) : (
            <>
              <div className={`text-lg font-black leading-none ${isFinished && task.type !== 'repeatable' ? 'text-orange-400' : 'text-white'}`}>{localProgress}</div>
              {task.type === 'progress' && <div className="text-[9px] text-gray-500 font-bold">/ {task.max}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;