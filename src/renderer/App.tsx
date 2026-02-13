export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col">
      <div className="h-10 flex items-center px-4 border-b border-white/10 drag-region">
        <span className="text-sm text-white/60 no-drag">Claude Canvas</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-white/40">
        Terminal will appear here
      </div>
    </div>
  )
}
