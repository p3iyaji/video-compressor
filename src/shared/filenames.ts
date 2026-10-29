const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

function replaceForbidden(value: string): string {
  let result = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 32 || '<>:"/\\|?*'.includes(char)) result += '_'
    else result += char
  }
  return result
}

export function sanitizeFileName(name: string): string {
  const leaf = name.split(/[/\\]/).pop() ?? name
  const withoutControls = replaceForbidden(leaf).replace(/\s+/g, ' ').trim()
  const noTraversal = withoutControls.replace(/^\.+/, '').replace(/[. ]+$/g, '')
  let base = noTraversal
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`
  if (!base || base === '_') base = 'compressed'
  if (!base.toLowerCase().endsWith('.mp4')) base = `${base}.mp4`
  if (base.length > 180) {
    const extension = '.mp4'
    base = `${base.slice(0, 180 - extension.length).replace(/[. ]+$/g, '')}${extension}`
  }
  return base
}

export function stemFromFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName
  return base.replace(/\.mp4$/i, '') || 'video'
}

export function defaultOutputFileName(sourceFileName: string, presetId: string): string {
  const stem = stemFromFileName(sourceFileName)
  const suffix = presetId === 'facebook' ? 'facebook' : 'compressed'
  return sanitizeFileName(`${stem}.${suffix}.mp4`)
}
