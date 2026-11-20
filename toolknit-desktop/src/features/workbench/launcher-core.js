export function toolsForFilename(value) {
  const name = String(value).trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (/\.pdf$/.test(name)) return ['document-compare','content-search','pdf-merge','pdf-to-word','pdf-compress','pdf-text-markdown'];
  if (/\.docx?$/.test(name)) return ['word-to-pdf','document-compare','content-search'];
  if (/\.(png|jpe?g|webp|bmp|gif|tiff?)$/.test(name)) return ['image-compress','image-convert','image-to-pdf','tool-workflows','bg-removal'];
  if (/\.(srt|vtt)$/.test(name)) return ['subtitle-workbench'];
  if (/\.(mp3|wav|flac|m4a|mp4|mkv|webm|mov|avi)$/.test(name)) return ['subtitle-workbench','transcription','audio-convert','video-convert'];
  return [];
}
export function rankLauncherTools(tools, query = '', recent = []) {
  const value = query.trim().toLocaleLowerCase(), suggestions = toolsForFilename(query);
  if (suggestions.length) return suggestions.map(id => tools.find(tool => tool.id === id)).filter(Boolean);
  return tools.map(tool => {
    const name = tool.name.toLocaleLowerCase(), source = `${tool.name} ${tool.description} ${tool.id}`.toLocaleLowerCase();
    const score = value ? (name === value ? 100 : name.startsWith(value) ? 80 : source.includes(value) ? 50 : 0) : Math.max(1, 20 - recent.indexOf(tool.id)) + (recent.includes(tool.id) ? 30 : 0);
    return { tool, score };
  }).filter(item => item.score > 0).sort((a,b) => b.score - a.score).slice(0, 12).map(item => item.tool);
}
