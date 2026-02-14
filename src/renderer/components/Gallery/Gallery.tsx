import { useGalleryStore, GalleryVariant } from '@/stores/gallery'
import { motion } from 'framer-motion'
import { X, Pencil, Copy, Download, Check } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

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

function exportVariantHtml(variant: GalleryVariant) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${variant.label}</title>
  <style>
    body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; }
    ${variant.css || ''}
  </style>
</head>
<body>
${variant.html}
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${variant.label.replace(/[^a-zA-Z0-9-_]/g, '-')}.html`
  a.click()
  URL.revokeObjectURL(url)
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
  const { removeVariant, renameVariant, duplicateVariant } = useGalleryStore()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(variant.label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  const commitRename = () => {
    if (renameValue.trim()) {
      renameVariant(variant.id, renameValue.trim())
    }
    setRenaming(false)
  }

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
      className={`group rounded-lg border overflow-hidden cursor-pointer transition-colors ${
        isSelected
          ? 'border-[var(--accent-cyan)] shadow-[0_0_0_1px_var(--accent-cyan)]'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      <div className="h-40 bg-white relative">
        <iframe
          srcDoc={srcdoc}
          className="w-full h-full border-0 pointer-events-none"
          title={variant.label}
          sandbox="allow-same-origin"
        />
        {/* Action buttons (visible on hover) */}
        <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); duplicateVariant(variant.id) }}
            className="p-1 bg-black/60 hover:bg-black/80 rounded text-white/60 hover:text-white transition-colors"
            title="Duplicate"
          >
            <Copy size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); exportVariantHtml(variant) }}
            className="p-1 bg-black/60 hover:bg-black/80 rounded text-white/60 hover:text-white transition-colors"
            title="Export HTML"
          >
            <Download size={10} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); removeVariant(variant.id) }}
            className="p-1 bg-black/60 hover:bg-red-500/80 rounded text-white/60 hover:text-white transition-colors"
            title="Delete"
          >
            <X size={10} />
          </button>
        </div>
      </div>
      <div className="px-3 py-2 bg-[var(--bg-tertiary)] flex items-center justify-between">
        {renaming ? (
          <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
              className="flex-1 bg-transparent text-xs text-white border-b border-[var(--accent-cyan)] outline-none px-0 py-0"
            />
            <button onClick={commitRename} className="text-cyan-400 hover:text-cyan-300">
              <Check size={10} />
            </button>
          </div>
        ) : (
          <>
            <span className="text-xs text-white/60">{variant.label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); setRenameValue(variant.label); setRenaming(true) }}
              className="p-0.5 opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/60 transition-all"
              title="Rename"
            >
              <Pencil size={10} />
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}
