// The landing page's visitor counts. They go to the PostHog project the app's counts go to,
// whose token the site's deploy is given (POSTHOG_KEY), and the page keeps nothing in the
// browser for them: no cookie and no storage. PostHog tells one visitor from the next by a hash
// it makes anew every day. docs/analytics.md says what is counted.
import { POSTHOG_HOST } from '../src/shared/analytics.js';
import { scriptJson } from './site-seo.js';

// PostHog's own loader, as https://posthog.com/docs/libraries/js gives it. It fetches the
// library from PostHog, and keeps what is asked of `posthog` until that has arrived.
const LOADER =
  '!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);';

/**
 * How the page counts.
 * @param {string} host  where PostHog takes counts
 */
export const pageConfig = (host) => ({
  api_host: host,
  defaults: '2026-05-30',
  // Nothing is kept in the browser, so there is nothing to ask a visitor's consent for.
  // The project needs "Cookieless server hash mode" turned on, or PostHog drops the counts.
  cookieless_mode: 'always',
  // Nobody is ever known by more than that day's hash.
  person_profiles: 'never',
  disable_session_recording: true,
});

/**
 * What starts the counting, for inside a <script> element. Built without a project to count
 * in, as anyone's but the site's deploy is, the page has no `posthog` at all and reaches nobody.
 * @param {{ key?: string, host?: string }} [project]
 */
export function analyticsScript({ key = process.env.POSTHOG_KEY ?? '', host = POSTHOG_HOST } = {}) {
  if (!key) return '';
  return `${LOADER}posthog.init(${scriptJson(key)},${scriptJson(pageConfig(host))})`;
}
