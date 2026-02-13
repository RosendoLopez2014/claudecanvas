import { useGalleryStore, GalleryVariant } from '@/stores/gallery'
import { motion } from 'framer-motion'

export function Gallery() {
  const { variants, selectedId, setSelectedId } = useGalleryStore()

  if (variants.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <div className="text-center space-y-2">
          <p>No component variants yet</p>
          <p className="text-xs text-white/20">
            Variants will appear here when components are rendered
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid grid-cols-2 gap-4">
        {variants.map((variant) => (
          <GalleryCard
            key={variant.id}
            variant={variant}
            isSelected={selectedId === variant.id}
            onSelect={() => setSelectedId(variant.id)}
          />
        ))}
      </div>
    </div>
  )
}

function GalleryCard({
  variant,
  isSelected,
  onSelect
}: {
  variant: GalleryVariant
  isSelected: boolean
  onSelect: () => void
}) {
  const srcdoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: white; }
          ${variant.css || ''}
        </style>
      </head>
      <body>${variant.html}</body>
    </html>
  `

  return (
    <motion.div
      onClick={onSelect}
      whileHover={{ scale: 1.02 }}
      className={`rounded-lg border overflow-hidden cursor-pointer transition-colors ${
        isSelected
          ? 'border-[var(--accent-cyan)] shadow-[0_0_0_1px_var(--accent-cyan)]'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      <div className="h-40 bg-white">
        <iframe
          srcDoc={srcdoc}
          className="w-full h-full border-0 pointer-events-none"
          title={variant.label}
          sandbox="allow-same-origin"
        />
      </div>
      <div className="px-3 py-2 bg-[var(--bg-tertiary)]">
        <span className="text-xs text-white/60">{variant.label}</span>
      </div>
    </motion.div>
  )
}
