// TODO(karabuddy): re-enable when backend endpoints are wired up.
// Original at ~/code/karabast-dev/forceteki-client/src/app/_services/ServerApiService.ts
// karabuddy doesn't ship a karabast-style backend — we stub the only method
// CosmeticsContext currently needs (getCosmeticsAsync) to return empty data
// so default cosmetics are used (no custom backgrounds or cardbacks).

import { IRegisteredCosmeticOption } from '@/app/_components/_sharedcomponents/Preferences/Preferences.types';

export class ServerApiService {
    public static async getCosmeticsAsync(): Promise<{
        cosmetics: IRegisteredCosmeticOption[];
        isContributor: boolean;
    }> {
        return { cosmetics: [], isContributor: false };
    }

    public static async userIsModAsync(): Promise<boolean> {
        return false;
    }
}
