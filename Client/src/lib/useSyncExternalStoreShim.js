// Vite alias target for `use-sync-external-store[/shim]/with-selector`.
// React 19 includes useSyncExternalStore natively; only the with-selector
// wrapper is needed. Re-export from the package's main entry which
// includes with-selector (Vite's dep optimizer handles CJS named exports).

import * as useSyncExternalStore from 'use-sync-external-store';

export const useSyncExternalStoreWithSelector = useSyncExternalStore.useSyncExternalStoreWithSelector;