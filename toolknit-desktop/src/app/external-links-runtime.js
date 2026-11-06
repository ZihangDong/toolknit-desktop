import { createLifecycleScope } from './tool-lifecycle.js';

const HOME_LINKS = Object.freeze({
  website: 'https://toolknit.com',
  github: 'https://github.com/ZihangDong/toolknit-desktop',
  ffmpegSource: 'https://github.com/ZihangDong/toolknit-ffmpeg-sources',
  feedback: 'https://github.com/ZihangDong/toolknit-desktop/issues',
  malian: 'https://www.mlai.online/register?aff=5Q2VVMD7YJVB',
  doufu: 'https://doufuapi.com/register?aff=TWKCBH9RGLN3'
});
const GITHUB_REPOSITORY = 'ZihangDong/toolknit-desktop';
const GITHUB_STATS_CACHE_KEY = 'toolknit_github_home_stats';
const GITHUB_CONTRIBUTORS_URL = `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/main/toolknit-desktop/public/contributors.json`;
const GITHUB_FIXED_ACTIVITY_POINTS = '0,62 248,62 280,8';
const DEFAULT_GITHUB_STAR_COUNT = 435;
const DEFAULT_DONATION_TOTAL = 83.88;
const GITHUB_REQUEST_TIMEOUT_MS = 8_000;
const GITHUB_RESPONSE_MAX_BYTES = 512 * 1024;

/** Owns validated external navigation and non-blocking homepage GitHub metrics. */
export function createExternalLinksRuntime({
  root = globalThis.document,
  storage = globalThis.localStorage,
  windowRef = globalThis.window,
  isTauri = false,
  tauriCorePromise,
  readResponseTextLimited,
  translate = key => key,
  onOpenHelp = () => {},
  onError = error => console.warn('External links runtime:', error)
} = {}) {
  const scope = createLifecycleScope({ onError });
  const bindEvent = (target, type, listener, options) => target?.addEventListener
    ? scope.event(target, type, listener, options)
    : () => {};
  const openExternalUrl = async url => {
    let parsedUrl;
    try {
      if (typeof url !== 'string' || url.length > 2048 || /[\u0000-\u001f\u007f]/.test(url)) throw new Error('invalid');
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) throw new Error('unsupported');
    } catch {
      onError(new Error('Blocked an invalid external URL.'));
      return false;
    }
    if (isTauri) {
      try {
        const { invoke } = await tauriCorePromise;
        await invoke('open_url', { url: parsedUrl.href });
        return true;
      } catch (error) {
        onError(error);
        windowRef?.showToast?.(translate('common.openLinkFailed'));
        return false;
      }
    }
    windowRef?.open?.(parsedUrl.href, '_blank', 'noopener,noreferrer');
    return true;
  };

  root?.querySelectorAll?.('[data-home-link]').forEach(link => {
      bindEvent(link, 'click', event => {
      const url = HOME_LINKS[link.dataset.homeLink];
      if (!url) return;
      event.preventDefault();
      void openExternalUrl(url);
    });
  });
  bindEvent(root?.getElementById?.('homeLatestUpdates'), 'click', () => onOpenHelp('update'));
  bindEvent(root?.getElementById?.('homeAboutAuthor'), 'click', () => void openExternalUrl('https://github.com/ZihangDong'));

  const fetchGithubJson = async (url, options = {}) => {
    const controller = new AbortController();
    const timeoutId = windowRef?.setTimeout?.(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
    try {
      const response = await (windowRef?.fetch || fetch)(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
      return JSON.parse(await readResponseTextLimited(response, GITHUB_RESPONSE_MAX_BYTES));
    } finally {
      if (timeoutId !== undefined) windowRef?.clearTimeout?.(timeoutId);
    }
  };
  const normalizeGithubStarCount = value => {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
  };
  const normalizeDonationTotal = data => {
    const contributors = Array.isArray(data?.contributors) ? data.contributors : [];
    const total = contributors.reduce((sum, contributor) => {
      const amount = Number(contributor?.amount_cny);
      return Number.isFinite(amount) && amount >= 0 && amount <= 100_000_000 ? sum + amount : sum;
    }, 0);
    return Math.round(total * 100) / 100;
  };
  const formatDonationTotal = value => {
    const total = Number.isFinite(value) && value >= 0 ? value : DEFAULT_DONATION_TOTAL;
    return total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const getCachedGithubStats = () => {
    try {
      const cached = JSON.parse(storage?.getItem(GITHUB_STATS_CACHE_KEY) || 'null');
      if (!cached || typeof cached !== 'object' || !cached.data) return null;
      return {
        stars: normalizeGithubStarCount(cached.data.stars) ?? DEFAULT_GITHUB_STAR_COUNT,
        donationTotal: Number.isFinite(Number(cached.data.donationTotal)) ? Math.max(0, Number(cached.data.donationTotal)) : DEFAULT_DONATION_TOTAL
      };
    } catch { return null; }
  };
  const saveGithubStats = data => {
    try { storage?.setItem(GITHUB_STATS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data })); } catch { /* optional storage */ }
  };
  const renderGithubActivity = (data, { repoSynced = false, donationsSynced = false } = {}) => {
    const starValue = data?.stars === null || data?.stars === undefined ? '--' : String(data.stars);
    const starCount = root?.getElementById?.('githubStarCount');
    const stars = root?.getElementById?.('githubStars');
    const donationStars = root?.getElementById?.('donationGithubStars');
    const starStat = stars?.closest?.('.github-stat');
    const donationTotal = root?.getElementById?.('githubDonationTotal');
    const chartLine = root?.getElementById?.('githubActivityLine');
    if (starCount) starCount.textContent = starValue;
    if (stars) stars.textContent = starValue;
    if (donationStars) donationStars.textContent = starValue === '--' ? '400+' : `${starValue}+`;
    starStat?.classList.toggle('is-synced', Boolean(repoSynced && Number.isFinite(Number(data?.stars))));
    if (donationTotal) donationTotal.textContent = formatDonationTotal(Number(data?.donationTotal));
    chartLine?.setAttribute('points', GITHUB_FIXED_ACTIVITY_POINTS);
    const status = root?.getElementById?.('githubActivityStatus');
    if (status) status.textContent = repoSynced && donationsSynced ? 'Star 与贡献名单已同步' : repoSynced ? 'Star 已同步，贡献名单使用本地数据' : '离线显示最近可用数据';
  };
  const loadDonationTotal = async () => {
    const sources = [{ url: GITHUB_CONTRIBUTORS_URL, isLive: true }];
    try {
      const localBase = root?.baseURI || windowRef?.location?.href || 'http://localhost/';
      sources.unshift({ url: new URL('contributors.json', localBase).href, isLive: false });
    } catch (error) {
      onError(error);
    }
    let lastError = null;
    for (const source of sources) {
      try { return { total: normalizeDonationTotal(await fetchGithubJson(source.url, { cache: 'no-store', headers: { Accept: 'application/json' } })), isLive: source.isLive }; }
      catch (error) { lastError = error; }
    }
    throw lastError || new Error('Contributor list request failed');
  };
  const loadGithubActivity = async () => {
    const cached = getCachedGithubStats();
    renderGithubActivity(cached || { stars: DEFAULT_GITHUB_STAR_COUNT, donationTotal: DEFAULT_DONATION_TOTAL });
    const [repoResult, donationResult] = await Promise.allSettled([
      fetchGithubJson(`https://api.github.com/repos/${GITHUB_REPOSITORY}`, { headers: { Accept: 'application/vnd.github+json' } }),
      loadDonationTotal()
    ]);
    const repoSynced = repoResult.status === 'fulfilled';
    const donationsAvailable = donationResult.status === 'fulfilled';
    const data = {
      stars: repoSynced ? normalizeGithubStarCount(repoResult.value?.stargazers_count) : cached?.stars ?? DEFAULT_GITHUB_STAR_COUNT,
      donationTotal: donationsAvailable ? donationResult.value.total : cached?.donationTotal ?? DEFAULT_DONATION_TOTAL
    };
    if (!repoSynced) onError(repoResult.reason);
    if (!donationsAvailable) onError(donationResult.reason);
    saveGithubStats(data);
    renderGithubActivity(data, { repoSynced, donationsSynced: donationsAvailable && donationResult.value.isLive });
    return data;
  };

  return Object.freeze({ dispose: scope.dispose, loadGithubActivity, openExternalUrl });
}
