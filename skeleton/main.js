// This site's bootstrap, made by corpus tools/build-page.mjs. Change config/ and run it
// again, rather than editing this file. It loads the corpus core at the version it pins,
// and hands the site's config to it.
import { start } from '{{core}}/js/app.js';
import site from './config/site.js';

start(site);
