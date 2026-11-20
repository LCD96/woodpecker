import { useObservable } from "dexie-react-hooks";
import { CLOUD_URL, db } from "./db";

const never = { subscribe: () => ({ unsubscribe() {} }) };

/** Estado de Dexie Cloud; `enabled` es false si la app se compiló sin VITE_DEXIE_CLOUD_URL */
export function useSync() {
  const user = useObservable(CLOUD_URL ? db.cloud.currentUser : never);
  const state = useObservable(CLOUD_URL ? db.cloud.syncState : never);
  const loggedIn = !!user?.isLoggedIn;
  return {
    enabled: !!CLOUD_URL,
    user: loggedIn ? user : undefined,
    state,
    /** Con sesión iniciada pero aún sin la primera descarga: no crear nada que pueda chocar con lo de la nube */
    waitingFirstSync: loggedIn && !!state && (state.phase === "initial" || (state.phase === "pulling" && !state.progress)),
  };
}

export const login = () => db.cloud.login();
export const logout = () => db.cloud.logout();
export const syncNow = () => db.cloud.sync({ purpose: "pull", wait: true });
