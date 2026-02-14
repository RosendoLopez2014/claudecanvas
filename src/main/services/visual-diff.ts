import { ipcMain, BrowserWindow } from 'electron'

/**
 * Lightweight visual diff service.
 * Compares two base64 PNG screenshots and returns a diff percentage.
 *
 * Uses Electron's offscreen rendering + Canvas API (via executeJavaScript
 * in a hidden context) to avoid adding native dependencies like pixelmatch.
 */
export function setupVisualDiffHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    'visual-diff:compare',
    async (_event, imageA: string, imageB: string): Promise<{ diffPercent: number } | null> => {
      const win = getWindow()
      if (!win) return null

      // Run pixel comparison in the renderer's JS context
      // This avoids needing a Canvas polyfill in Node.js
      try {
        const result = await win.webContents.executeJavaScript(`
          (async function() {
            function loadImage(src) {
              return new Promise(function(resolve, reject) {
                var img = new Image();
                img.onload = function() { resolve(img); };
                img.onerror = reject;
                img.src = src;
              });
            }

            var imgA = await loadImage('data:image/png;base64,${imageA}');
            var imgB = await loadImage('data:image/png;base64,${imageB}');

            var w = Math.min(imgA.width, imgB.width);
            var h = Math.min(imgA.height, imgB.height);
            if (w === 0 || h === 0) return { diffPercent: 0 };

            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');

            ctx.drawImage(imgA, 0, 0);
            var dataA = ctx.getImageData(0, 0, w, h).data;

            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(imgB, 0, 0);
            var dataB = ctx.getImageData(0, 0, w, h).data;

            var diffPixels = 0;
            var totalPixels = w * h;
            var threshold = 25; // per-channel tolerance

            for (var i = 0; i < dataA.length; i += 4) {
              var dr = Math.abs(dataA[i] - dataB[i]);
              var dg = Math.abs(dataA[i+1] - dataB[i+1]);
              var db = Math.abs(dataA[i+2] - dataB[i+2]);
              if (dr > threshold || dg > threshold || db > threshold) {
                diffPixels++;
              }
            }

            return { diffPercent: Math.round((diffPixels / totalPixels) * 10000) / 100 };
          })()
        `)
        return result
      } catch {
        return null
      }
    }
  )
}
