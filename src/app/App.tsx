import { NavLink, Route, Routes } from 'react-router'
import TodayScreen from './screens/TodayScreen'
import PlayerScreen from './screens/PlayerScreen'
import HistoryScreen from './screens/HistoryScreen'
import StatsScreen from './screens/StatsScreen'
import SettingsScreen from './screens/SettingsScreen'
import CatalogScreen from './screens/CatalogScreen'

const NAV = [
  { to: '/', label: 'Today', emoji: '🏠' },
  { to: '/history', label: 'History', emoji: '📅' },
  { to: '/stats', label: 'Stats', emoji: '📊' },
  { to: '/settings', label: 'Settings', emoji: '⚙️' },
] as const

export default function App() {
  return (
    <div className="flex h-full flex-col sm:flex-row">
      <nav className="order-last flex shrink-0 justify-around border-t border-slate-200 bg-white p-2 sm:order-first sm:w-48 sm:flex-col sm:justify-start sm:gap-1 sm:border-t-0 sm:border-r sm:p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="hidden items-center gap-2 px-3 pb-6 text-xl font-extrabold tracking-tight sm:flex">
          <span>💪</span>
          <span>FitDuo</span>
        </div>
        {NAV.map(({ to, label, emoji }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`
            }
          >
            <span aria-hidden>{emoji}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/workout" element={<PlayerScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/stats" element={<StatsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/catalog" element={<CatalogScreen />} />
        </Routes>
      </main>
    </div>
  )
}
