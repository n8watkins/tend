/**
 * An inline script in the root layout that runs before hydration: it keeps
 * the browser's install prompt on window for lib/pwa-client.ts, and stops
 * Chrome's own mini-infobar, since Tend offers install in its own words.
 */
export const INSTALL_CAPTURE =
  "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__tendInstall=e;dispatchEvent(new Event('tend:install'))});" +
  "addEventListener('appinstalled',function(){window.__tendInstall=null;dispatchEvent(new Event('tend:install'))});"
