export interface IUser extends IGetUser{
    email?: string;
    provider?: string;
    providerId?: string;
    authenticated: boolean,
}

export enum ChatDisabledReason {
    None = 'none',
    NotLoggedIn = 'notLoggedIn',
    AnonymousOpponent = 'anonymousOpponent',
    UserMuted = 'userMuted',
    OpponentDisabledChat = 'opponentDisabledChat',
    UserDisabledChat = 'userDisabledChat'
}

export interface IChatDisabledInfo {
    reason: ChatDisabledReason;
    message: string;
    borderColor: string;
}

export enum ModerationFieldState {
    Enabled = 'enabled',
    EnabledAndSeen = 'enabledAndSeen',
}

export enum ModerationType {
    Mute = 'Mute',
    Ban = 'Ban',
}
export interface IModerationAction {
    daysRemaining?: number;
    endDate?: Date;
    hasSeen?: boolean;
    moderationType?: ModerationType
}

export interface IGetUser {
    id: string;
    username: string;
    showWelcomeMessage: boolean;
    preferences: IPreferences,
    needsUsernameChange: boolean;
    mustRequestUsernameChange?: ModerationFieldState | null;
    reportingDisabled?: ModerationFieldState | null;
    moderation?: IModerationAction | null,
    undoPopupSeenDate?: Date | null
}

export interface ISoundPreferences {
    muteAllSound?: boolean;
    muteCardAndButtonClickSound?: boolean;
    muteYourTurn?: boolean;
    muteChatSound?: boolean;
    muteOpponentFoundSound?: boolean;
}

export interface ICosmeticsPreferences {
    cardback?: string;
    background?: string;
    // playmat?: string;
    // disablePlaymats?: boolean;
}

export interface IGameOptions {
    muteChat?: boolean;
}

export interface IPreferences {
    sound?: ISoundPreferences;
    cosmetics?: ICosmeticsPreferences;
    gameOptions?: IGameOptions;

}

export interface IUserContextType {
    user: IUser | null;
    anonymousUserId: string | null;
    isLoading: boolean;
    isMod: boolean;
    login: (provider: 'google' | 'discord') => void;
    devLogin: (user: 'Order66' | 'ThisIsTheWay') => void;
    logout: () => void;
    updateUsername: (username: string) => void;
    updateWelcomeMessage: () => void;
    updateNeedsUsernameChange: () => void;
    updateMustRequestUsernameChangeSeen: () => void;
    updateReportingDisabledSeen: () => void;
    updateUserPreferences: (preferences: IPreferences) => void;
    updateModerationSeenStatus: (moderation: IModerationAction | null) => void;
    updateUndoPopupSeenDate: () => void;
}

export enum AdminRole {
    SuperUser = 'SuperUser',
    Developer = 'Developer',
    Moderator = 'Moderator',
}

// TODO(karabuddy): re-enable when next-auth is added back.
// In forceteki-client these `declare module` blocks augment next-auth's
// Session/JWT types. karabuddy aliases next-auth to a local shim, so the
// augmentations have nowhere to attach — left commented to preserve intent.
//
// declare module 'next-auth' { ... }
// declare module 'next-auth/jwt' { ... }
