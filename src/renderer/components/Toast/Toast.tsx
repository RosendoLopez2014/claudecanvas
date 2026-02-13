import { AnimatePresence, motion } from 'framer-motion'
import { useToastStore } from '@/stores/toast'
import { X, Info, CheckCircle, AlertCircle } from 'lucide-react'

const icons = {
  info: Info,
  success: CheckCircle,
  error: AlertCircle
}

const colors = {
  info: 'border-blue-400/30 text-blue-300',
  success: 'border-green-400/30 text-green-300',
  error: 'border-red-400/30 text-red-300'
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = icons[toast.type]
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-[var(--bg-secondary)] shadow-lg ${colors[toast.type]}`}
            >
              <Icon size={14} />
              <span className="text-sm text-white/80">{toast.message}</span>
              <button onClick={() => removeToast(toast.id)} className="ml-2 text-white/30 hover:text-white/60">
                <X size={12} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
