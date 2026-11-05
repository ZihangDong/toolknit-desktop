// Selected Material Icon Theme assets, pinned source and MIT license in icons/.
const urls = Object.fromEntries(Object.entries(import.meta.glob('./icons/*.svg', { eager: true, query: '?url', import: 'default' }))
  .map(([path, url]) => [path.split('/').pop().replace(/\.svg$/, ''), url]));
const groups = {
  pdf: ['pdf'], word: ['doc','docx','odt','rtf'], table: ['xls','xlsx','xlsm','ods','csv','tsv'],
  powerpoint: ['ppt','pptx','pps','ppsx','odp'], image: ['png','jpg','jpeg','gif','webp','bmp','tif','tiff','svg','heic','avif','ico','psd','ai'],
  video: ['mp4','mkv','mov','avi','webm','wmv','flv','m4v'], audio: ['mp3','wav','flac','aac','m4a','ogg','opus','wma'],
  zip: ['zip','rar','7z','tar','gz','bz2','xz','tgz'], font: ['ttf','otf','woff','woff2'],
  exe: ['exe','msi','msix','appx','bat','cmd','ps1'], database: ['db','sqlite','sqlite3','sql'],
  settings: ['json','yaml','yml','toml','ini','xml','conf','config'], markdown: ['md','mdx','markdown'],
  javascript: ['js','ts','jsx','tsx','html','css','scss','vue','svelte'], python: ['py','pyw','ipynb']
};
const types = new Map(Object.entries(groups).flatMap(([name, extensions]) => extensions.map(ext => [ext, name])));
export function fileIcon(extension = '') {
  const ext = String(extension).toLowerCase().replace(/^\./, '').split('.').pop();
  const kind = types.get(ext) || 'document';
  return { kind, url: urls[kind] || urls.document };
}
