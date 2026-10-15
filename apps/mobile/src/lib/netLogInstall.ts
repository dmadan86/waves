// Wraps `fetch` for the on-device network log. A side-effect module imported
// first by the root layout: the Supabase client keeps hold of whatever `fetch`
// is when it is created, so this has to run before `@/lib/supabase` loads.
import { installNetLog } from '@/lib/netLog';

installNetLog();
