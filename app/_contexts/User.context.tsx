// TODO(karabuddy): re-enable when auth is wired up.
// Original at ~/code/karabast-dev/forceteki-client/src/app/_contexts/User.context.tsx
// We replaced session-driven user sync (next-auth + server fetch + mod-status
// lookup + anonymous-id minting + dev login) with a static null/anonymous
// context. Replay viewing doesn't need a logged-in user. Restore the full
// implementation when adding login (Discord/Google) for tag attribution.
'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { IUserContextType } from './UserTypes';

const UserContext = createContext<IUserContextType>({
    user: null,
    anonymousUserId: null,
    isLoading: false,
    isMod: false,
    login: () => {},
    devLogin: () => {},
    logout: () => {},
    updateUsername: () => {},
    updateWelcomeMessage: () => {},
    updateNeedsUsernameChange: () => {},
    updateMustRequestUsernameChangeSeen: () => {},
    updateReportingDisabledSeen: () => {},
    updateUserPreferences: () => {},
    updateModerationSeenStatus: () => {},
    updateUndoPopupSeenDate: () => {}
});

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    return (
        <UserContext.Provider value={{
            user: null,
            anonymousUserId: 'karabuddy-anon',
            isLoading: false,
            isMod: false,
            login: () => {},
            devLogin: () => {},
            logout: () => {},
            updateUsername: () => {},
            updateWelcomeMessage: () => {},
            updateNeedsUsernameChange: () => {},
            updateMustRequestUsernameChangeSeen: () => {},
            updateReportingDisabledSeen: () => {},
            updateUserPreferences: () => {},
            updateModerationSeenStatus: () => {},
            updateUndoPopupSeenDate: () => {},
        }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => useContext(UserContext);
