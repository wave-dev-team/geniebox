/** Rough "OS · browser" label for a session; good enough to tell devices apart. */
export function describeUserAgent(userAgent: string | null): { os: string; browser: string } {
  const ua = userAgent ?? '';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /YaBrowser/.test(ua)
      ? 'Яндекс Браузер'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  return { os, browser };
}
