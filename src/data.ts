// Define categories for the recommendation algorithm
export type TaskCategory = 'passive' | 'casino' | 'work' | 'entertainment' | 'business' | 'sport' | 'world' | 'faction' | 'phone' | 'pets';

// Define task completion types
export type TaskType = 'progress' | 'boolean' | 'repeatable';

export interface Task {
  id: number;
  title: string;       // Russian title for the UI
  baseBP: number;      // Standard BP reward
  vipBP: number;       // Gold/Platinum VIP BP reward
  type: TaskType;
  max: number;         // Max progress (1 for boolean, N for progress)
  category: TaskCategory;
}

// Complete list of all GTA5RP BP farm tasks
export const tasks: Task[] = [
  // Passive & Basic
  { id: 1, title: '3 часа в онлайне', baseBP: 2, vipBP: 4, type: 'repeatable', max: 1, category: 'passive' },
  
  // Work & General Activities
  { id: 2, title: '25 действий на стройке', baseBP: 2, vipBP: 4, type: 'progress', max: 25, category: 'work' },
  { id: 3, title: '25 действий в порту', baseBP: 2, vipBP: 4, type: 'progress', max: 25, category: 'work' },
  { id: 4, title: '25 действий в шахте', baseBP: 2, vipBP: 4, type: 'progress', max: 25, category: 'work' },
  { id: 5, title: '10 посылок на почте', baseBP: 1, vipBP: 2, type: 'progress', max: 10, category: 'work' },
  { id: 6, title: '10 действий на ферме', baseBP: 1, vipBP: 2, type: 'progress', max: 10, category: 'work' },
  { id: 7, title: 'Потушить 25 "огоньков" пожарным', baseBP: 1, vipBP: 2, type: 'progress', max: 25, category: 'work' },
  { id: 8, title: 'Выполнить 3 заказа дальнобойщиком', baseBP: 2, vipBP: 4, type: 'progress', max: 3, category: 'work' },
  { id: 9, title: '2 круга на любом маршруте автобусника', baseBP: 2, vipBP: 4, type: 'progress', max: 2, category: 'work' },
  { id: 10, title: 'Починить чужой автомобиль в автосервисе (<90%)', baseBP: 2, vipBP: 4, type: 'boolean', max: 1, category: 'work' },
  { id: 11, title: 'Починить деталь в автосервисе', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'work' },
  
  // Entertainment & Sport
  { id: 12, title: '3 победы в Дэнс Баттлах', baseBP: 2, vipBP: 4, type: 'progress', max: 3, category: 'entertainment' },
  { id: 13, title: 'Арендовать киностудию', baseBP: 2, vipBP: 4, type: 'boolean', max: 1, category: 'entertainment' },
  { id: 14, title: 'Выиграть гонку в картинге', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'entertainment' },
  { id: 15, title: 'Проехать 1 уличную гонку (через телефон)', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'entertainment' },
  { id: 16, title: 'Добавить 5 видео в кинотеатре', baseBP: 1, vipBP: 2, type: 'progress', max: 5, category: 'entertainment' },
  { id: 17, title: 'Победить в дартс', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'entertainment' },
  { id: 18, title: '20 подходов в тренажерном зале', baseBP: 1, vipBP: 2, type: 'progress', max: 20, category: 'sport' },
  { id: 19, title: 'Успешная тренировка в тире', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'sport' },
  { id: 20, title: '5 игр в тренировочном комплексе (от 100$)', baseBP: 1, vipBP: 2, type: 'progress', max: 5, category: 'sport' },
  { id: 21, title: 'Выиграть 3 любых игры на арене (от 100$)', baseBP: 1, vipBP: 2, type: 'progress', max: 3, category: 'sport' },
  { id: 22, title: 'Забросить 2 мяча в баскетболе', baseBP: 1, vipBP: 2, type: 'progress', max: 2, category: 'sport' },
  { id: 23, title: 'Забить 2 гола в футболе', baseBP: 1, vipBP: 2, type: 'progress', max: 2, category: 'sport' },
  { id: 24, title: 'Победить в армрестлинге', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'sport' },
  { id: 25, title: 'Поиграть 1 минуту в волейбол', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'sport' },
  { id: 26, title: 'Поиграть 1 минуту в настольный теннис', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'sport' },
  { id: 27, title: 'Поиграть 1 минуту в большой теннис', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'sport' },

  // Casino
  { id: 28, title: 'Нули в казино', baseBP: 2, vipBP: 4, type: 'boolean', max: 1, category: 'casino' },
  { id: 29, title: 'Купить лотерейный билет', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'casino' },
  { id: 30, title: 'Ставка в колесе удачи (межсерверное)', baseBP: 3, vipBP: 6, type: 'boolean', max: 1, category: 'casino' },
  { id: 31, title: 'Сыграть в мафию в казино', baseBP: 3, vipBP: 6, type: 'boolean', max: 1, category: 'casino' },
  { id: 32, title: 'Прокрутить за DP серебрянный, золотой или driver кейс', baseBP: 10, vipBP: 20, type: 'boolean', max: 1, category: 'casino' },

  // World & Business
  { id: 33, title: 'Заказ материалов для бизнеса вручную', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'business' },
  { id: 34, title: 'Сделать платеж по лизингу', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'business' },
  { id: 35, title: 'Выкопать 1 сокровище (не мусор)', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'world' },
  { id: 36, title: 'Два раза оплатить смену внешности', baseBP: 2, vipBP: 4, type: 'progress', max: 2, category: 'world' },
  { id: 37, title: '5 раз снять 100% шкуру с животных', baseBP: 2, vipBP: 4, type: 'progress', max: 5, category: 'world' },
  { id: 38, title: 'Проехать 1 станцию на метро', baseBP: 2, vipBP: 4, type: 'boolean', max: 1, category: 'world' },
  { id: 39, title: 'Поймать 20 рыб', baseBP: 4, vipBP: 8, type: 'progress', max: 20, category: 'world' },

  // Phone Apps
  { id: 40, title: 'Посетить любой сайт в браузере', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'phone' },
  { id: 41, title: 'Зайти в любой канал в Brawl', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'phone' },
  { id: 42, title: 'Поставить лайк любой анкете в Match', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'phone' },

  // Pets
  { id: 43, title: 'Кинуть мяч питомцу 15 раз', baseBP: 2, vipBP: 4, type: 'progress', max: 15, category: 'pets' },
  { id: 44, title: '15 выполненных питомцем команд', baseBP: 2, vipBP: 4, type: 'progress', max: 15, category: 'pets' },

  // Factions (Crime & State)
  { id: 45, title: '7 закрашенных граффити', baseBP: 1, vipBP: 2, type: 'progress', max: 7, category: 'faction' },
  { id: 46, title: 'Сдать 5 контрабанды', baseBP: 2, vipBP: 4, type: 'progress', max: 5, category: 'faction' },
  { id: 47, title: 'Участие в каптах/бизварах', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'faction' },
  { id: 48, title: 'Сдать Хаммер с ВЗХ', baseBP: 3, vipBP: 6, type: 'boolean', max: 1, category: 'faction' },
  { id: 49, title: 'Взломать 15 замков (дома/автоугоны)', baseBP: 2, vipBP: 4, type: 'progress', max: 15, category: 'faction' },
  { id: 50, title: 'Посадить траву в теплице', baseBP: 4, vipBP: 8, type: 'boolean', max: 1, category: 'faction' },
  { id: 51, title: 'Запустить переработку обезболивающих', baseBP: 4, vipBP: 8, type: 'boolean', max: 1, category: 'faction' },
  { id: 52, title: 'Принять участие в двух аирдропах', baseBP: 4, vipBP: 8, type: 'progress', max: 2, category: 'faction' },
  { id: 53, title: 'Выполнить 2 квеста любых клубов', baseBP: 4, vipBP: 8, type: 'progress', max: 2, category: 'faction' },
  { id: 54, title: '5 выданных медкарт в EMS', baseBP: 2, vipBP: 4, type: 'progress', max: 5, category: 'faction' },
  { id: 55, title: 'Закрыть 15 вызовов в EMS', baseBP: 2, vipBP: 4, type: 'progress', max: 15, category: 'faction' },
  { id: 56, title: 'Отредактировать 40 объявлений в WN', baseBP: 2, vipBP: 4, type: 'progress', max: 40, category: 'faction' },
  { id: 57, title: 'Закрыть 5 кодов в силовых структурах', baseBP: 2, vipBP: 4, type: 'progress', max: 5, category: 'faction' },
  { id: 58, title: 'Поставить на учет 2 автомобиля (LSPD)', baseBP: 1, vipBP: 2, type: 'progress', max: 2, category: 'faction' },
  { id: 59, title: 'Произвести 1 арест в КПЗ', baseBP: 1, vipBP: 2, type: 'boolean', max: 1, category: 'faction' },
  { id: 60, title: 'Выкупить двух человек из КПЗ', baseBP: 2, vipBP: 4, type: 'progress', max: 2, category: 'faction' }
];