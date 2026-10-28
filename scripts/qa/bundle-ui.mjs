import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
await build({entryPoints:[resolve(root,'src/main.jsx')],bundle:true,jsx:'automatic',format:'iife',platform:'browser',outfile:resolve(root,'tmp/qa/ui-test.js'),define:{__APP_VERSION__:'"test"',__GIT_COMMIT__:'"offline-fixture"',__BUILD_TIME__:'"test"','process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-fixture',setup(b){b.onResolve({filter:/\/lib\/supabase$/},()=>({path:resolve(here,'mock-supabase.js')}));}}]});
