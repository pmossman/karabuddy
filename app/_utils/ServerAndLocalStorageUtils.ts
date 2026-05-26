// TODO(karabuddy): re-enable when replay-driver is wired up.
// Slimmed down for the read-only renderer lift. The original file in
// forceteki-client talks to the karabast backend (next-auth + many fetch
// endpoints). For replay viewing we only need:
//   - getUserFromServer (stubbed: throws so consumers fall back)
//   - loadPreferencesFromLocalStorage (still useful for sound prefs)
// All the deck/server/auth helpers were removed; restore from
// ~/code/karabast-dev/forceteki-client/src/app/_utils/ServerAndLocalStorageUtils.ts
// when wiring real persistence.

import { IPreferences, IGetUser } from '@/app/_contexts/UserTypes';

export const getUserFromServer = async (): Promise<IGetUser> => {
    throw new Error('getUserFromServer not implemented in karabuddy');
};

export const loadPreferencesFromLocalStorage = (): IPreferences => {
    try {
        const preferencesJSON =
            typeof window !== 'undefined' ? window.localStorage.getItem('swu_preferences') : null;
        if (preferencesJSON) {
            const preferences = JSON.parse(preferencesJSON) as IPreferences;
            return {
                sound: {
                    muteAllSound: preferences.sound?.muteAllSound ?? false,
                    muteCardAndButtonClickSound: preferences.sound?.muteCardAndButtonClickSound ?? false,
                    muteYourTurn: preferences.sound?.muteYourTurn ?? false,
                    muteChatSound: preferences.sound?.muteChatSound ?? false,
                    muteOpponentFoundSound: preferences.sound?.muteOpponentFoundSound ?? false,
                },
                cosmetics: {
                    cardback: preferences.cosmetics?.cardback,
                    background: preferences.cosmetics?.background,
                },
            };
        }
    } catch (error) {
        console.error('Error loading preferences from localStorage:', error);
    }

    return {
        sound: {
            muteAllSound: false,
            muteCardAndButtonClickSound: false,
            muteYourTurn: false,
            muteChatSound: false,
            muteOpponentFoundSound: false,
        },
        cosmetics: {
            cardback: undefined,
            background: undefined,
        },
    };
};
